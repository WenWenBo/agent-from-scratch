/**
 * 窗口策略单元测试
 */

import { describe, it, expect } from 'vitest';
import type { Message } from '../../types.js';
import {
  SlidingWindowStrategy,
  TokenBudgetStrategy,
  SummaryWindowStrategy,
  estimateTokenCount,
} from '../window-strategies.js';

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `消息 ${i + 1}`,
  }));
}

// ============================================================
// SlidingWindowStrategy
// ============================================================

describe('SlidingWindowStrategy', () => {
  const strategy = new SlidingWindowStrategy();

  it('消息数不超过 max 时应返回全部', () => {
    const msgs = makeMessages(3);
    const result = strategy.apply(msgs, 5);
    expect(result).toHaveLength(3);
  });

  it('消息数超过 max 时应保留最近的', () => {
    const msgs = makeMessages(10);
    const result = strategy.apply(msgs, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: 'user', content: '消息 8' });
    expect(result[2]).toEqual({ role: 'user', content: '消息 10' });
  });

  it('max=0 应返回空', () => {
    const msgs = makeMessages(5);
    const result = strategy.apply(msgs, 0);
    expect(result).toHaveLength(0);
  });

  it('空消息列表应返回空', () => {
    const result = strategy.apply([], 10);
    expect(result).toHaveLength(0);
  });
});

// ============================================================
// TokenBudgetStrategy
// ============================================================

describe('TokenBudgetStrategy', () => {
  it('应按 Token 预算从最新消息开始保留', () => {
    const strategy = new TokenBudgetStrategy(50);
    const msgs: Message[] = [
      { role: 'user', content: 'Short' },
      { role: 'assistant', content: 'Also short' },
      { role: 'user', content: 'Last one' },
    ];

    const result = strategy.apply(msgs, 100);
    expect(result.length).toBeGreaterThan(0);
    // 最后一条消息一定在结果中
    expect(result[result.length - 1]!).toEqual({ role: 'user', content: 'Last one' });
  });

  it('预算极小时应至少返回 0 条', () => {
    const strategy = new TokenBudgetStrategy(1);
    const msgs: Message[] = [
      { role: 'user', content: '这是一条很长的中文消息，应该超过 1 个 token 的预算' },
    ];
    const result = strategy.apply(msgs, 100);
    expect(result).toHaveLength(0);
  });

  it('预算极大时应返回全部', () => {
    const strategy = new TokenBudgetStrategy(100000);
    const msgs = makeMessages(5);
    const result = strategy.apply(msgs, 100);
    expect(result).toHaveLength(5);
  });

  it('应正确处理含 toolCalls 的 assistant 消息', () => {
    const strategy = new TokenBudgetStrategy(500);
    const msgs: Message[] = [
      { role: 'user', content: 'calculate 2+2' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'c1', function: { name: 'calc', arguments: '{"expr":"2+2"}' } }],
      },
      { role: 'tool', toolCallId: 'c1', content: '{"result":4}' },
      { role: 'assistant', content: 'The answer is 4.' },
    ];

    const result = strategy.apply(msgs, 100);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================
// SummaryWindowStrategy
// ============================================================

describe('SummaryWindowStrategy', () => {
  it('消息数不超过 recentCount 时应返回全部', () => {
    const strategy = new SummaryWindowStrategy(6);
    const msgs = makeMessages(4);
    const result = strategy.apply(msgs, 100);
    expect(result).toHaveLength(4);
  });

  it('消息数超过 recentCount 时应只保留最近的', () => {
    const strategy = new SummaryWindowStrategy(3);
    const msgs = makeMessages(10);
    const result = strategy.apply(msgs, 100);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: 'user', content: '消息 8' });
  });
});

// ============================================================
// estimateTokenCount
// ============================================================

describe('estimateTokenCount', () => {
  it('英文文本应约 4 chars = 1 token', () => {
    const tokens = estimateTokenCount('hello world'); // 11 chars => ~2.75 + 4 overhead
    expect(tokens).toBeGreaterThan(4);
    expect(tokens).toBeLessThan(15);
  });

  it('中文文本应约 1 char = 1 token', () => {
    const tokens = estimateTokenCount('你好世界'); // 4 CJK chars => 4 + 4 overhead
    expect(tokens).toBe(8);
  });

  it('空字符串应返回 0', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('混合中英文应合理估算', () => {
    const tokens = estimateTokenCount('Hello 你好');
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(15);
  });
});
