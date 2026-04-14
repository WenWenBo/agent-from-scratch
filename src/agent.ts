/**
 * Agent -- TinyAgent 框架的核心
 * 实现 ReAct（Reasoning + Acting）循环：
 *   Think → Act → Observe → Think → Act → Observe → ... → Final Answer
 */

import type {
  Message,
  ChatResponse,
  TokenUsage,
} from './types.js';
import type { LLMProvider } from './providers/base.js';
import type { ToolRegistry } from './tools/registry.js';
import type { ToolExecutionResult } from './tools/tool.js';

// ============================================================
// Agent 配置
// ============================================================

export interface AgentOptions {
  /** 使用的 LLM Provider */
  provider: LLMProvider;

  /** 模型名称 */
  model: string;

  /** System Prompt -- 定义 Agent 的身份和行为 */
  systemPrompt: string;

  /** 工具注册中心（可选，无工具的 Agent 就是纯对话） */
  tools?: ToolRegistry;

  /** 单次 run 的最大步数（防止无限循环），默认 10 */
  maxSteps?: number;

  /** LLM 调用的 temperature，默认 0 */
  temperature?: number;

  /** 最大输出 token 数 */
  maxTokens?: number;
}

// ============================================================
// Agent 运行事件 -- 每一步产生的事件，用于观测和调试
// ============================================================

export type AgentEvent =
  | { type: 'text_delta'; step: number; content: string }
  | { type: 'thinking'; step: number; content: string | null }
  | { type: 'tool_call'; step: number; toolName: string; arguments: string; toolCallId: string }
  | { type: 'tool_result'; step: number; toolCallId: string; result: ToolExecutionResult }
  | { type: 'answer'; step: number; content: string }
  | { type: 'error'; step: number; error: string }
  | { type: 'max_steps_reached'; step: number };

// ============================================================
// Agent 运行结果
// ============================================================

export interface AgentResult {
  /** 最终回复内容 */
  content: string;

  /** 完整的消息历史（含所有中间步骤） */
  messages: Message[];

  /** 执行了多少步 */
  steps: number;

  /** 累计 Token 用量 */
  usage: TokenUsage;

  /** 产生的所有事件（用于调试和可观测性） */
  events: AgentEvent[];
}

// ============================================================
// Agent 类
// ============================================================

export class Agent {
  private provider: LLMProvider;
  private model: string;
  private systemPrompt: string;
  private tools: ToolRegistry | undefined;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number | undefined;

  constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.tools = options.tools;
    this.maxSteps = options.maxSteps ?? 10;
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens;
  }

  /**
   * 运行 Agent -- ReAct 循环的核心入口
   *
   * @param input 用户输入
   * @param onEvent 可选的事件回调（实时观测每一步）
   * @returns AgentResult 包含最终回复、消息历史、步数、Token 用量
   */
  async run(
    input: string,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentResult> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: input },
    ];

    const events: AgentEvent[] = [];
    const emit = (event: AgentEvent) => {
      events.push(event);
      onEvent?.(event);
    };

    const totalUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    let step = 0;

    // ========================================================
    // ReAct 循环
    // ========================================================
    while (step < this.maxSteps) {
      step++;

      // --- Think: 调用 LLM ---
      let response: ChatResponse;
      try {
        response = await this.callLLM(messages);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', step, error: errorMsg });
        return this.buildResult(
          `Error calling LLM: ${errorMsg}`,
          messages,
          step,
          totalUsage,
          events
        );
      }

      this.accumulateUsage(totalUsage, response.usage);

      // --- 终止条件 1: LLM 直接回复（没有工具调用）---
      if (response.finishReason === 'stop' || !response.toolCalls?.length) {
        const content = response.content ?? '';
        emit({ type: 'answer', step, content });
        messages.push({ role: 'assistant', content });
        return this.buildResult(content, messages, step, totalUsage, events);
      }

      // --- 终止条件 2: 上下文长度超限 ---
      if (response.finishReason === 'length') {
        const content = response.content ?? '[Response truncated due to length limit]';
        emit({ type: 'error', step, error: 'Context length exceeded' });
        messages.push({ role: 'assistant', content });
        return this.buildResult(content, messages, step, totalUsage, events);
      }

      // --- Think: LLM 决定调用工具 ---
      if (response.content) {
        emit({ type: 'thinking', step, content: response.content });
      }

      // 将 assistant 消息（含 toolCalls）加入历史
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // --- Act: 执行工具 ---
      if (!this.tools) {
        emit({
          type: 'error',
          step,
          error: 'LLM requested tool calls but no tools are registered',
        });
        return this.buildResult(
          'Error: No tools available',
          messages,
          step,
          totalUsage,
          events
        );
      }

      for (const toolCall of response.toolCalls!) {
        emit({
          type: 'tool_call',
          step,
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments,
          toolCallId: toolCall.id,
        });

        // 执行工具
        const execResult = await this.tools.execute(toolCall);

        emit({
          type: 'tool_result',
          step,
          toolCallId: toolCall.id,
          result: execResult,
        });

        // --- Observe: 将工具结果加入消息历史 ---
        const resultContent = execResult.success
          ? JSON.stringify(execResult.result)
          : `Error: ${execResult.error}`;

        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: resultContent,
        });
      }

      // 循环继续 → 回到 Think
    }

    // --- 终止条件 3: 达到最大步数 ---
    emit({ type: 'max_steps_reached', step });
    return this.buildResult(
      `Agent stopped: reached maximum steps (${this.maxSteps})`,
      messages,
      step,
      totalUsage,
      events
    );
  }

  /**
   * 支持多轮对话的 run -- 接受已有消息历史
   */
  async runWithMessages(
    messages: Message[],
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentResult> {
    const events: AgentEvent[] = [];
    const emit = (event: AgentEvent) => {
      events.push(event);
      onEvent?.(event);
    };

    const totalUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    let step = 0;

    while (step < this.maxSteps) {
      step++;

      let response: ChatResponse;
      try {
        response = await this.callLLM(messages);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', step, error: errorMsg });
        return this.buildResult(
          `Error calling LLM: ${errorMsg}`,
          messages,
          step,
          totalUsage,
          events
        );
      }

      this.accumulateUsage(totalUsage, response.usage);

      if (response.finishReason === 'stop' || !response.toolCalls?.length) {
        const content = response.content ?? '';
        emit({ type: 'answer', step, content });
        messages.push({ role: 'assistant', content });
        return this.buildResult(content, messages, step, totalUsage, events);
      }

      if (response.finishReason === 'length') {
        const content = response.content ?? '[Response truncated due to length limit]';
        emit({ type: 'error', step, error: 'Context length exceeded' });
        messages.push({ role: 'assistant', content });
        return this.buildResult(content, messages, step, totalUsage, events);
      }

      if (response.content) {
        emit({ type: 'thinking', step, content: response.content });
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      if (!this.tools) {
        emit({
          type: 'error',
          step,
          error: 'LLM requested tool calls but no tools are registered',
        });
        return this.buildResult(
          'Error: No tools available',
          messages,
          step,
          totalUsage,
          events
        );
      }

      for (const toolCall of response.toolCalls!) {
        emit({
          type: 'tool_call',
          step,
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments,
          toolCallId: toolCall.id,
        });

        const execResult = await this.tools.execute(toolCall);

        emit({
          type: 'tool_result',
          step,
          toolCallId: toolCall.id,
          result: execResult,
        });

        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: execResult.success
            ? JSON.stringify(execResult.result)
            : `Error: ${execResult.error}`,
        });
      }
    }

    emit({ type: 'max_steps_reached', step });
    return this.buildResult(
      `Agent stopped: reached maximum steps (${this.maxSteps})`,
      messages,
      step,
      totalUsage,
      events
    );
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async callLLM(messages: Message[]): Promise<ChatResponse> {
    return this.provider.chat({
      model: this.model,
      messages,
      tools: this.tools?.toDefinitions(),
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    });
  }

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
    events: AgentEvent[]
  ): AgentResult {
    return { content, messages, steps, usage, events };
  }
}
