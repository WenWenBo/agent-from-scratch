/**
 * MemoryAgent -- 带记忆能力的 Agent
 *
 * 在 Agent（Chapter 03）基础上增加：
 * 1. 短期记忆：使用 ConversationMemory 管理对话上下文
 * 2. 长期记忆：使用 MemoryStore 存取跨会话信息
 * 3. 自动摘要：对话过长时自动压缩早期消息
 */

import type {
  Message,
  ChatResponse,
  TokenUsage,
} from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { AgentEvent, AgentResult } from '../agent.js';
import type { MemoryStore } from './types.js';
import type { ToolExecutionResult } from '../tools/tool.js';
import { ConversationMemory } from './conversation-memory.js';
import type { ConversationMemoryOptions } from './conversation-memory.js';

// ============================================================
// MemoryAgent 配置
// ============================================================

export interface MemoryAgentOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  tools?: ToolRegistry;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;

  /** 短期记忆配置 */
  conversationMemory?: Partial<ConversationMemoryOptions>;

  /** 长期记忆存储 */
  longTermMemory?: MemoryStore;

  /** 自动摘要阈值：消息数超过此值时触发摘要，默认 16 */
  summaryThreshold?: number;

  /** 摘要后保留的最近消息数，默认 6 */
  summaryKeepRecent?: number;
}

// ============================================================
// MemoryAgent 类
// ============================================================

export class MemoryAgent {
  private provider: LLMProvider;
  private model: string;
  private tools: ToolRegistry | undefined;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number | undefined;

  private memory: ConversationMemory;
  private longTermMemory: MemoryStore | undefined;
  private summaryThreshold: number;
  private summaryKeepRecent: number;

  constructor(options: MemoryAgentOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.tools = options.tools;
    this.maxSteps = options.maxSteps ?? 10;
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens;
    this.longTermMemory = options.longTermMemory;
    this.summaryThreshold = options.summaryThreshold ?? 16;
    this.summaryKeepRecent = options.summaryKeepRecent ?? 6;

    this.memory = new ConversationMemory({
      systemPrompt: options.systemPrompt,
      maxMessages: options.conversationMemory?.maxMessages,
      windowStrategy: options.conversationMemory?.windowStrategy,
    });
  }

  // ============================================================
  // 对话入口 -- 支持多轮对话
  // ============================================================

  /**
   * 发送消息并获取回复
   * 与 Agent.run() 不同，MemoryAgent.chat() 会自动管理对话历史
   */
  async chat(
    input: string,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentResult> {
    // 1. 将用户消息加入短期记忆
    this.memory.addMessage({ role: 'user', content: input });

    // 2. 检查是否需要摘要压缩
    await this.maybeSummarize();

    // 3. 构建上下文 + 注入长期记忆
    const contextMessages = await this.buildContextWithLongTermMemory(input);

    // 4. 执行 ReAct 循环
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

    const messages = [...contextMessages];
    let step = 0;

    while (step < this.maxSteps) {
      step++;

      let response: ChatResponse;
      try {
        response = await this.callLLM(messages);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', step, error: errorMsg });
        return this.buildResult(`Error calling LLM: ${errorMsg}`, messages, step, totalUsage, events);
      }

      totalUsage.promptTokens += response.usage.promptTokens;
      totalUsage.completionTokens += response.usage.completionTokens;
      totalUsage.totalTokens += response.usage.totalTokens;

      // 终止：直接回复
      if (response.finishReason === 'stop' || !response.toolCalls?.length) {
        const content = response.content ?? '';
        emit({ type: 'answer', step, content });
        messages.push({ role: 'assistant', content });

        // 将 assistant 回复加入短期记忆
        this.memory.addMessage({ role: 'assistant', content });

        return this.buildResult(content, messages, step, totalUsage, events);
      }

      // 终止：上下文超限
      if (response.finishReason === 'length') {
        const content = response.content ?? '[Response truncated due to length limit]';
        emit({ type: 'error', step, error: 'Context length exceeded' });
        messages.push({ role: 'assistant', content });
        this.memory.addMessage({ role: 'assistant', content });
        return this.buildResult(content, messages, step, totalUsage, events);
      }

      // Think
      if (response.content) {
        emit({ type: 'thinking', step, content: response.content });
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // 工具调用消息也加入短期记忆
      this.memory.addMessage({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // Act
      if (!this.tools) {
        emit({ type: 'error', step, error: 'LLM requested tool calls but no tools are registered' });
        return this.buildResult('Error: No tools available', messages, step, totalUsage, events);
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

        emit({ type: 'tool_result', step, toolCallId: toolCall.id, result: execResult });

        const resultContent = execResult.success
          ? JSON.stringify(execResult.result)
          : `Error: ${execResult.error}`;

        messages.push({ role: 'tool', toolCallId: toolCall.id, content: resultContent });
        this.memory.addMessage({ role: 'tool', toolCallId: toolCall.id, content: resultContent });
      }
    }

    emit({ type: 'max_steps_reached', step });
    return this.buildResult(
      `Agent stopped: reached maximum steps (${this.maxSteps})`,
      messages, step, totalUsage, events
    );
  }

  // ============================================================
  // 长期记忆操作
  // ============================================================

  /** 手动存入长期记忆 */
  async remember(content: string, metadata: Record<string, unknown> = {}, importance: number = 0.5): Promise<void> {
    if (!this.longTermMemory) return;
    await this.longTermMemory.add({ content, metadata, importance });
  }

  /** 搜索长期记忆 */
  async recall(query: string, limit: number = 5): Promise<string[]> {
    if (!this.longTermMemory) return [];
    const entries = await this.longTermMemory.search(query, limit);
    return entries.map((e) => e.content);
  }

  // ============================================================
  // 会话管理
  // ============================================================

  /** 获取对话记忆对象（直接访问底层 API） */
  getConversationMemory(): ConversationMemory {
    return this.memory;
  }

  /** 重置对话（清除短期记忆，保留长期记忆） */
  resetConversation(): void {
    this.memory.clear();
  }

  /** 获取当前对话消息总数 */
  getMessageCount(): number {
    return this.memory.getMessageCount();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 构建上下文，如果有长期记忆，搜索相关记忆并注入
   */
  private async buildContextWithLongTermMemory(query: string): Promise<Message[]> {
    const contextMessages = this.memory.getContextMessages();

    if (!this.longTermMemory) {
      return contextMessages;
    }

    // 搜索相关长期记忆
    const memories = await this.longTermMemory.search(query, 3);
    if (memories.length === 0) {
      return contextMessages;
    }

    // 将长期记忆注入 system 消息
    const memoryText = memories
      .map((m) => `- ${m.content}`)
      .join('\n');

    const system = contextMessages[0]!;
    if (system.role === 'system') {
      const enriched: Message = {
        role: 'system',
        content: `${system.content}\n\n[Relevant memories]\n${memoryText}`,
      };
      return [enriched, ...contextMessages.slice(1)];
    }

    return contextMessages;
  }

  /**
   * 当消息数超过阈值时触发摘要
   */
  private async maybeSummarize(): Promise<void> {
    if (this.memory.getMessageCount() < this.summaryThreshold) {
      return;
    }

    const toSummarize = this.memory.prepareForSummarization(this.summaryKeepRecent);
    if (!toSummarize || toSummarize.length === 0) {
      return;
    }

    // 用 LLM 生成摘要
    const summaryText = await this.generateSummary(toSummarize);
    this.memory.setSummary(summaryText, toSummarize.length);
  }

  /**
   * 调用 LLM 生成对话摘要
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    const conversationText = messages
      .map((m) => {
        if (m.role === 'user') return `User: ${m.content}`;
        if (m.role === 'assistant') return `Assistant: ${m.content ?? '[tool call]'}`;
        if (m.role === 'tool') return `Tool Result: ${m.content}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');

    try {
      const response = await this.provider.chat({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a summarizer. Summarize the following conversation into a concise paragraph that captures key topics, decisions, and context. Keep it under 200 words. Write in the same language as the conversation.',
          },
          {
            role: 'user',
            content: `Summarize this conversation:\n\n${conversationText}`,
          },
        ],
        temperature: 0,
      });
      return response.content ?? 'Unable to generate summary.';
    } catch {
      return `[Summary of ${messages.length} messages - generation failed]`;
    }
  }

  private async callLLM(messages: Message[]): Promise<ChatResponse> {
    return this.provider.chat({
      model: this.model,
      messages,
      tools: this.tools?.toDefinitions(),
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    });
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
