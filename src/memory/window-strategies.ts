/**
 * 对话窗口策略实现
 * 控制发送给 LLM 的消息历史范围，平衡上下文质量与 Token 成本
 */

import type { Message } from '../types.js';
import type { WindowStrategy } from './types.js';

// ============================================================
// 1. 滑动窗口策略 -- 保留最近 N 条消息
// ============================================================

export class SlidingWindowStrategy implements WindowStrategy {
  readonly name = 'sliding_window';

  apply(messages: Message[], maxMessages: number): Message[] {
    if (maxMessages <= 0) {
      return [];
    }
    if (messages.length <= maxMessages) {
      return messages;
    }
    return messages.slice(-maxMessages);
  }
}

// ============================================================
// 2. Token 预算策略 -- 按估算 Token 数裁剪
// ============================================================

export class TokenBudgetStrategy implements WindowStrategy {
  readonly name = 'token_budget';

  private maxTokens: number;

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
  }

  apply(messages: Message[], _maxMessages: number): Message[] {
    let tokenCount = 0;
    const result: Message[] = [];

    // 从最新消息开始，向前累计 token
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      const msgTokens = this.estimateTokens(msg);

      if (tokenCount + msgTokens > this.maxTokens) {
        break;
      }

      tokenCount += msgTokens;
      result.unshift(msg);
    }

    return result;
  }

  /**
   * 粗略估算消息的 Token 数
   * 规则：英文约 1 token / 4 chars，中文约 1 token / 1.5 chars
   * 这是一个近似值，精确计算需要 tiktoken 等库
   */
  private estimateTokens(message: Message): number {
    let text = '';

    if (message.role === 'assistant' && message.content) {
      text = message.content;
    } else if (message.role === 'tool') {
      text = message.content;
    } else if (message.role === 'user' || message.role === 'system') {
      text = message.content;
    }

    // tool_calls 也要算 token
    if (message.role === 'assistant' && message.toolCalls) {
      for (const tc of message.toolCalls) {
        text += tc.function.name + tc.function.arguments;
      }
    }

    return estimateTokenCount(text);
  }
}

/**
 * 简易 Token 计数器
 * 对混合中英文文本的近似估算
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // CJK 字符范围：每个字约 1 token
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||  // CJK Unified Ideographs
      (code >= 0x3000 && code <= 0x303f) ||  // CJK Symbols
      (code >= 0xff00 && code <= 0xffef)     // Fullwidth Forms
    ) {
      count += 1;
    } else {
      count += 0.25; // 英文字符约 4 chars = 1 token
    }
  }

  return Math.ceil(count) + 4; // +4 for message overhead (role, formatting)
}

// ============================================================
// 3. 摘要+最近消息策略 -- 保留摘要 + 最近 N 条
// ============================================================

export class SummaryWindowStrategy implements WindowStrategy {
  readonly name = 'summary_window';

  private recentCount: number;

  constructor(recentCount: number = 6) {
    this.recentCount = recentCount;
  }

  /**
   * 返回最近的 recentCount 条消息
   * 注意：摘要注入由 ConversationMemory.getContextMessages() 处理，
   * 这里只负责裁剪
   */
  apply(messages: Message[], _maxMessages: number): Message[] {
    if (messages.length <= this.recentCount) {
      return messages;
    }
    return messages.slice(-this.recentCount);
  }
}
