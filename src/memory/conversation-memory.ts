/**
 * ConversationMemory -- 短期记忆（对话上下文管理）
 *
 * 核心职责：
 * 1. 维护当前会话的消息历史
 * 2. 通过窗口策略控制发送给 LLM 的消息范围
 * 3. 支持对话摘要（将早期消息压缩为摘要）
 * 4. 与 Agent 对接，提供 getContextMessages()
 */

import type { Message, SystemMessage } from '../types.js';
import type { WindowStrategy, ConversationSummary } from './types.js';
import { SlidingWindowStrategy } from './window-strategies.js';

export interface ConversationMemoryOptions {
  /** System Prompt */
  systemPrompt: string;

  /** 最大保留消息数（不含 system），默认 20 */
  maxMessages?: number;

  /** 窗口策略，默认滑动窗口 */
  windowStrategy?: WindowStrategy;
}

export class ConversationMemory {
  private systemPrompt: string;
  private messages: Message[] = [];
  private maxMessages: number;
  private windowStrategy: WindowStrategy;
  private summary: ConversationSummary | null = null;

  constructor(options: ConversationMemoryOptions) {
    this.systemPrompt = options.systemPrompt;
    this.maxMessages = options.maxMessages ?? 20;
    this.windowStrategy = options.windowStrategy ?? new SlidingWindowStrategy();
  }

  // ============================================================
  // 消息管理
  // ============================================================

  /** 添加单条消息 */
  addMessage(message: Message): void {
    // system 消息不加入历史
    if (message.role === 'system') return;
    this.messages.push(message);
  }

  /** 批量添加消息（例如从 AgentResult.messages 中导入） */
  addMessages(messages: Message[]): void {
    for (const msg of messages) {
      this.addMessage(msg);
    }
  }

  /** 获取完整消息历史（不含 system） */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /** 获取消息总数 */
  getMessageCount(): number {
    return this.messages.length;
  }

  /** 清空消息历史 */
  clear(): void {
    this.messages = [];
    this.summary = null;
  }

  // ============================================================
  // 上下文构建 -- 核心方法
  // ============================================================

  /**
   * 获取要发送给 LLM 的完整上下文消息列表
   * 流程：
   * 1. 用窗口策略裁剪消息
   * 2. 如果有摘要，将其作为 system 消息的一部分注入
   * 3. 在最前面加上 system prompt
   */
  getContextMessages(): Message[] {
    // 1. 窗口策略裁剪
    const windowed = this.windowStrategy.apply(this.messages, this.maxMessages);

    // 2. 构建 system 消息（含摘要）
    let systemContent = this.systemPrompt;
    if (this.summary) {
      systemContent += `\n\n[Previous conversation summary]\n${this.summary.content}`;
    }

    const systemMessage: SystemMessage = {
      role: 'system',
      content: systemContent,
    };

    // 3. 组装
    return [systemMessage, ...windowed];
  }

  // ============================================================
  // 摘要管理
  // ============================================================

  /** 设置摘要（通常由外部 LLM 生成） */
  setSummary(content: string, messageCount: number): void {
    this.summary = {
      content,
      messageCount,
      createdAt: Date.now(),
    };
  }

  /** 获取当前摘要 */
  getSummary(): ConversationSummary | null {
    return this.summary;
  }

  /**
   * 压缩历史消息：保留最近 keepRecent 条，其余由调用方生成摘要后设置
   * 返回需要被摘要的消息（交给调用方去做 LLM 摘要）
   */
  prepareForSummarization(keepRecent: number): Message[] | null {
    if (this.messages.length <= keepRecent) {
      return null;
    }

    const toSummarize = this.messages.slice(0, this.messages.length - keepRecent);
    this.messages = this.messages.slice(-keepRecent);

    return toSummarize;
  }

  // ============================================================
  // 更新 System Prompt
  // ============================================================

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }
}
