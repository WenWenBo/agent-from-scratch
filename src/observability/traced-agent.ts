/**
 * TracedAgent -- 自动追踪的 Agent 包装器
 *
 * 将 Tracer 和 MetricsCollector 与 Agent 集成，
 * 自动为每次 run() 创建 Trace，为每个 AgentEvent 创建 Span。
 *
 * 使用者无需修改 Agent 代码，只需用 TracedAgent 包装：
 *
 *   const agent = new Agent({ ... });
 *   const traced = new TracedAgent(agent, tracer, metrics);
 *   const result = await traced.run("Hello");
 *   // Trace 已自动记录并导出
 */

import { Agent } from '../agent.js';
import type { AgentResult, AgentEvent } from '../agent.js';
import { Tracer } from './tracer.js';
import { MetricsCollector } from './metrics.js';
import type { SpanAttributes } from './trace.js';

// ============================================================
// 配置
// ============================================================

export interface TracedAgentOptions {
  agent: Agent;
  tracer: Tracer;
  metrics?: MetricsCollector;
  /** 传入模型名称，用于指标记录 */
  model?: string;
  /** 额外的 Trace 级属性 */
  attributes?: SpanAttributes;
}

// ============================================================
// TracedAgent
// ============================================================

export class TracedAgent {
  private agent: Agent;
  private tracer: Tracer;
  private metrics: MetricsCollector | undefined;
  private model: string;
  private baseAttributes: SpanAttributes;

  constructor(options: TracedAgentOptions) {
    this.agent = options.agent;
    this.tracer = options.tracer;
    this.metrics = options.metrics;
    this.model = options.model ?? 'unknown';
    this.baseAttributes = options.attributes ?? {};
  }

  async run(
    input: string,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentResult> {
    const trace = this.tracer.startTrace('agent.run', {
      'agent.model': this.model,
      'agent.input': input.slice(0, 500),
      ...this.baseAttributes,
    });

    const agentSpan = this.tracer.startSpan('agent.execute', 'agent', {
      'input.length': input.length,
    });

    const runStartTime = Date.now();
    let currentLLMSpan: ReturnType<Tracer['startSpan']> | null = null;

    const tracedOnEvent = (event: AgentEvent) => {
      this.handleEvent(event, runStartTime);
      onEvent?.(event);
    };

    try {
      const result = await this.agent.run(input, tracedOnEvent);

      agentSpan.setAttributes({
        'output.length': result.content.length,
        'agent.steps': result.steps,
        'tokens.prompt': result.usage.promptTokens,
        'tokens.completion': result.usage.completionTokens,
        'tokens.total': result.usage.totalTokens,
      });

      // 记录 token 用量
      if (this.metrics && result.usage.totalTokens > 0) {
        this.metrics.recordTokenUsage(
          result.usage.promptTokens,
          result.usage.completionTokens,
          this.model
        );
      }

      // 记录端到端延迟
      const totalDuration = Date.now() - runStartTime;
      this.metrics?.recordLatency('agent.e2e', totalDuration);
      this.metrics?.recordSuccess('agent.run');

      this.tracer.endSpan('ok');
      await this.tracer.endTrace('ok');

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      agentSpan.setAttribute('error.message', errorMsg);
      this.metrics?.recordFailure('agent.run');
      this.metrics?.recordLatency('agent.e2e', Date.now() - runStartTime);

      this.tracer.endSpan('error', errorMsg);
      await this.tracer.endTrace('error');

      throw err;
    }
  }

  // ============================================================
  // 事件处理 -- 将 AgentEvent 转化为 Span
  // ============================================================

  private handleEvent(event: AgentEvent, runStartTime: number): void {
    switch (event.type) {
      case 'thinking': {
        const span = this.tracer.startSpan(`llm.thinking.step${event.step}`, 'llm', {
          'step': event.step,
          'content.length': event.content?.length ?? 0,
        });
        this.tracer.endSpan('ok');
        break;
      }

      case 'tool_call': {
        this.tracer.startSpan(`tool.${event.toolName}`, 'tool', {
          'tool.name': event.toolName,
          'tool.call_id': event.toolCallId,
          'step': event.step,
        });
        break;
      }

      case 'tool_result': {
        const span = this.tracer.activeSpan;
        if (span && span.name.startsWith('tool.')) {
          const success = event.result.success;
          span.setAttributes({
            'tool.success': success,
            'tool.result_size': JSON.stringify(event.result.result ?? event.result.error ?? '').length,
          });
          if (event.result.durationMs !== undefined) {
            this.metrics?.recordLatency('tool.execute', event.result.durationMs);
          }
          if (success) {
            this.metrics?.recordSuccess('tool.call');
          } else {
            this.metrics?.recordFailure('tool.call');
          }
          this.tracer.endSpan(success ? 'ok' : 'error', success ? undefined : event.result.error);
        }
        break;
      }

      case 'answer': {
        const span = this.tracer.startSpan('agent.answer', 'agent', {
          'step': event.step,
          'answer.length': event.content.length,
        });
        this.tracer.endSpan('ok');
        break;
      }

      case 'error': {
        const span = this.tracer.startSpan('agent.error', 'agent', {
          'step': event.step,
          'error.message': event.error,
        });
        this.tracer.endSpan('error', event.error);
        break;
      }

      case 'max_steps_reached': {
        const span = this.tracer.startSpan('agent.max_steps', 'agent', {
          'step': event.step,
        });
        this.tracer.endSpan('error', 'Max steps reached');
        break;
      }
    }
  }
}
