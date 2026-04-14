/**
 * StreamingAgent -- 支持流式输出的 Agent
 *
 * 与 Agent（Chapter 03）的区别：
 * - LLM 回复通过 AsyncGenerator 逐字输出
 * - 新增 text_delta 事件类型
 * - 工具调用时先流式收集完整响应，再执行工具
 * - 支持对每个 token 实时回调
 */

import type {
  Message,
  StreamChunk,
  TokenUsage,
} from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolExecutionResult } from '../tools/tool.js';
import type { AgentEvent, AgentResult } from '../agent.js';
import { StreamCollector } from './stream-utils.js';

/**
 * StreamingAgentEvent 与 AgentEvent 完全一致
 * 区别在于 StreamingAgent 会产出 text_delta 事件（Agent 不会）
 */
export type StreamingAgentEvent = AgentEvent;

// ============================================================
// StreamingAgent 配置
// ============================================================

export interface StreamingAgentOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  tools?: ToolRegistry;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
}

// ============================================================
// StreamingAgent 类
// ============================================================

export class StreamingAgent {
  private provider: LLMProvider;
  private model: string;
  private systemPrompt: string;
  private tools: ToolRegistry | undefined;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number | undefined;

  constructor(options: StreamingAgentOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.tools = options.tools;
    this.maxSteps = options.maxSteps ?? 10;
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens;
  }

  /**
   * 流式运行 Agent
   * 通过 AsyncGenerator 逐个产出事件
   */
  async *runStream(input: string): AsyncGenerator<StreamingAgentEvent, AgentResult> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: input },
    ];

    const events: StreamingAgentEvent[] = [];
    const totalUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    let step = 0;

    while (step < this.maxSteps) {
      step++;

      // --- 流式调用 LLM ---
      let stream: AsyncIterable<StreamChunk>;
      try {
        stream = this.provider.stream({
          model: this.model,
          messages,
          tools: this.tools?.toDefinitions(),
          temperature: this.temperature,
          maxTokens: this.maxTokens,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const event: StreamingAgentEvent = { type: 'error', step, error: errorMsg };
        events.push(event);
        yield event;
        return this.buildResult(`Error calling LLM: ${errorMsg}`, messages, step, totalUsage, events);
      }

      // --- 流式收集 ---
      const collector = new StreamCollector();
      try {
        for await (const chunk of stream) {
          collector.push(chunk);

          // 实时产出 text_delta
          if (chunk.type === 'text_delta' && chunk.content) {
            const event: StreamingAgentEvent = { type: 'text_delta', step, content: chunk.content };
            events.push(event);
            yield event;
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const event: StreamingAgentEvent = { type: 'error', step, error: errorMsg };
        events.push(event);
        yield event;
        return this.buildResult(`Error streaming LLM: ${errorMsg}`, messages, step, totalUsage, events);
      }

      const response = collector.getResponse();
      this.accumulateUsage(totalUsage, response.usage);

      // --- 终止条件: 直接回复 ---
      if (response.finishReason === 'stop' || !response.toolCalls?.length) {
        const content = response.content ?? '';
        const event: StreamingAgentEvent = { type: 'answer', step, content };
        events.push(event);
        yield event;
        messages.push({ role: 'assistant', content });
        return this.buildResult(content, messages, step, totalUsage, events);
      }

      // --- 终止条件: 上下文超限 ---
      if (response.finishReason === 'length') {
        const content = response.content ?? '[Response truncated]';
        const event: StreamingAgentEvent = { type: 'error', step, error: 'Context length exceeded' };
        events.push(event);
        yield event;
        messages.push({ role: 'assistant', content });
        return this.buildResult(content, messages, step, totalUsage, events);
      }

      // --- Think ---
      if (response.content) {
        const event: StreamingAgentEvent = { type: 'thinking', step, content: response.content };
        events.push(event);
        yield event;
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // --- Act ---
      if (!this.tools) {
        const event: StreamingAgentEvent = {
          type: 'error', step,
          error: 'LLM requested tool calls but no tools are registered',
        };
        events.push(event);
        yield event;
        return this.buildResult('Error: No tools available', messages, step, totalUsage, events);
      }

      for (const toolCall of response.toolCalls!) {
        const tcEvent: StreamingAgentEvent = {
          type: 'tool_call', step,
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments,
          toolCallId: toolCall.id,
        };
        events.push(tcEvent);
        yield tcEvent;

        const execResult = await this.tools.execute(toolCall);

        const trEvent: StreamingAgentEvent = {
          type: 'tool_result', step,
          toolCallId: toolCall.id,
          result: execResult,
        };
        events.push(trEvent);
        yield trEvent;

        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: execResult.success
            ? JSON.stringify(execResult.result)
            : `Error: ${execResult.error}`,
        });
      }
    }

    const event: StreamingAgentEvent = { type: 'max_steps_reached', step };
    events.push(event);
    yield event;
    return this.buildResult(
      `Agent stopped: reached maximum steps (${this.maxSteps})`,
      messages, step, totalUsage, events
    );
  }

  /**
   * 便捷方法：流式运行 + onEvent 回调
   * 与 Agent.run() 的接口一致，但内部使用流式
   */
  async run(
    input: string,
    onEvent?: (event: StreamingAgentEvent) => void
  ): Promise<AgentResult> {
    const gen = this.runStream(input);
    let result = await gen.next();

    while (!result.done) {
      onEvent?.(result.value);
      result = await gen.next();
    }

    return result.value;
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private accumulateUsage(total: TokenUsage, delta: TokenUsage): void {
    total.promptTokens += delta.promptTokens;
    total.completionTokens += delta.completionTokens;
    total.totalTokens += delta.totalTokens;
  }

  private buildResult(
    content: string,
    messages: Message[],
    steps: number,
    usage: TokenUsage,
    events: StreamingAgentEvent[]
  ): AgentResult {
    return { content, messages, steps, usage, events };
  }
}
