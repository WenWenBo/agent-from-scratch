/**
 * GuardedAgent -- 带安全护栏的 Agent 包装器
 *
 * 在 Agent 的输入和输出阶段自动执行护栏检查。
 * 对外暴露与 Agent 相同的接口，对使用者透明。
 *
 * 执行流程：
 *   用户输入 → InputGuardrails → Agent.run() → OutputGuardrails → 最终输出
 *               ↓ (拦截)                         ↓ (拦截)
 *            返回拒绝消息                      返回安全消息
 */

import type { AgentResult, AgentEvent } from '../agent.js';
import { Agent } from '../agent.js';
import {
  GuardrailPipeline,
  type GuardrailPipelineResult,
  type Guardrail,
} from './guardrail.js';
import type { ToolCallGuard } from './tool-guard.js';

// ============================================================
// 配置
// ============================================================

export interface GuardedAgentOptions {
  /** 被保护的 Agent */
  agent: Agent;

  /** 输入阶段的护栏 */
  inputGuardrails?: Guardrail[];

  /** 输出阶段的护栏 */
  outputGuardrails?: Guardrail[];

  /** 工具调用守卫 */
  toolGuard?: ToolCallGuard;

  /** 输入被拦截时的回复 */
  inputBlockedMessage?: string;

  /** 输出被拦截时的回复 */
  outputBlockedMessage?: string;

  /** 遇到第一个失败护栏就立即返回 */
  failFast?: boolean;
}

// ============================================================
// 护栏事件（扩展 AgentEvent）
// ============================================================

export type GuardrailEvent =
  | { type: 'guardrail_input_check'; result: GuardrailPipelineResult }
  | { type: 'guardrail_output_check'; result: GuardrailPipelineResult }
  | { type: 'guardrail_blocked'; stage: 'input' | 'output'; reason: string };

// ============================================================
// GuardedAgent 实现
// ============================================================

export class GuardedAgent {
  private agent: Agent;
  private inputPipeline: GuardrailPipeline;
  private outputPipeline: GuardrailPipeline;
  private toolGuard: ToolCallGuard | undefined;
  private inputBlockedMessage: string;
  private outputBlockedMessage: string;
  private failFast: boolean;

  constructor(options: GuardedAgentOptions) {
    this.agent = options.agent;
    this.toolGuard = options.toolGuard;
    this.inputBlockedMessage = options.inputBlockedMessage
      ?? 'I cannot process this request as it was flagged by our safety system.';
    this.outputBlockedMessage = options.outputBlockedMessage
      ?? 'I generated a response but it was filtered by our safety system. Please try rephrasing your question.';
    this.failFast = options.failFast ?? true;

    this.inputPipeline = new GuardrailPipeline();
    if (options.inputGuardrails) {
      this.inputPipeline.addMany(options.inputGuardrails);
    }

    this.outputPipeline = new GuardrailPipeline();
    if (options.outputGuardrails) {
      this.outputPipeline.addMany(options.outputGuardrails);
    }
  }

  /**
   * 带护栏保护的 run
   */
  async run(
    input: string,
    onEvent?: (event: AgentEvent | GuardrailEvent) => void
  ): Promise<AgentResult> {
    // --- 输入护栏 ---
    if (this.inputPipeline.size > 0) {
      const inputCheck = await this.inputPipeline.run(input, 'input', {
        failFast: this.failFast,
      });

      onEvent?.({ type: 'guardrail_input_check', result: inputCheck });

      if (!inputCheck.passed) {
        const reason = inputCheck.results
          .filter((r) => !r.passed)
          .map((r) => r.reason)
          .join('; ');

        onEvent?.({ type: 'guardrail_blocked', stage: 'input', reason });

        return this.blockedResult(this.inputBlockedMessage, reason);
      }
    }

    // --- Agent 执行 ---
    const result = await this.agent.run(input, onEvent);

    // --- 输出护栏 ---
    if (this.outputPipeline.size > 0 && result.content) {
      const outputCheck = await this.outputPipeline.run(result.content, 'output', {
        failFast: this.failFast,
      });

      onEvent?.({ type: 'guardrail_output_check', result: outputCheck });

      if (!outputCheck.passed) {
        const reason = outputCheck.results
          .filter((r) => !r.passed)
          .map((r) => r.reason)
          .join('; ');

        onEvent?.({ type: 'guardrail_blocked', stage: 'output', reason });

        return {
          ...result,
          content: this.outputBlockedMessage,
          events: [
            ...result.events,
            { type: 'error' as const, step: result.steps, error: `Output blocked: ${reason}` },
          ],
        };
      }
    }

    return result;
  }

  private blockedResult(message: string, reason: string): AgentResult {
    return {
      content: message,
      messages: [],
      steps: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      events: [{ type: 'error', step: 0, error: `Input blocked: ${reason}` }],
    };
  }
}
