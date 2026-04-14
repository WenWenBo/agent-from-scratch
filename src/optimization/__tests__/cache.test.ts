/**
 * LLMCache -- 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMCache } from '../cache.js';
import type { ChatRequest, ChatResponse } from '../../types.js';

const makeRequest = (content: string, model = 'gpt-4o'): ChatRequest => ({
  model,
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content },
  ],
});

const makeResponse = (content: string): ChatResponse => ({
  id: 'resp-1',
  content,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  finishReason: 'stop',
});

describe('LLMCache', () => {
  it('应缓存并返回相同请求的响应', () => {
    const cache = new LLMCache();
    const req = makeRequest('Hello');
    const res = makeResponse('Hi there!');

    cache.set(req, res);
    const cached = cache.get(req);

    expect(cached).toBeDefined();
    expect(cached?.content).toBe('Hi there!');
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(0);
  });

  it('不同请求应 miss', () => {
    const cache = new LLMCache();
    cache.set(makeRequest('Hello'), makeResponse('Hi'));

    const result = cache.get(makeRequest('Goodbye'));
    expect(result).toBeUndefined();
    expect(cache.misses).toBe(1);
  });

  it('不同模型应视为不同请求', () => {
    const cache = new LLMCache();
    cache.set(makeRequest('Hello', 'gpt-4o'), makeResponse('A'));
    cache.set(makeRequest('Hello', 'gpt-4o-mini'), makeResponse('B'));

    expect(cache.get(makeRequest('Hello', 'gpt-4o'))?.content).toBe('A');
    expect(cache.get(makeRequest('Hello', 'gpt-4o-mini'))?.content).toBe('B');
  });

  it('TTL 过期后应 miss', () => {
    const cache = new LLMCache({ ttlMs: 50 });
    cache.set(makeRequest('Hello'), makeResponse('Hi'));

    expect(cache.get(makeRequest('Hello'))).toBeDefined();

    // 模拟时间流逝
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);

    expect(cache.get(makeRequest('Hello'))).toBeUndefined();
    vi.useRealTimers();
  });

  it('超过 maxSize 时应淘汰 LRU', async () => {
    const cache = new LLMCache({ maxSize: 2 });

    cache.set(makeRequest('A'), makeResponse('RA'));
    await new Promise((r) => setTimeout(r, 5));
    cache.set(makeRequest('B'), makeResponse('RB'));
    await new Promise((r) => setTimeout(r, 5));

    // 访问 A，使 B 成为 LRU（B.lastAccessedAt 最早）
    cache.get(makeRequest('A'));
    await new Promise((r) => setTimeout(r, 5));

    // 插入 C，应淘汰 B（LRU）
    cache.set(makeRequest('C'), makeResponse('RC'));

    expect(cache.get(makeRequest('A'))?.content).toBe('RA');
    expect(cache.get(makeRequest('B'))).toBeUndefined();
    expect(cache.get(makeRequest('C'))?.content).toBe('RC');
  });

  it('has() 应检查条目存在性', () => {
    const cache = new LLMCache();
    const req = makeRequest('Test');
    cache.set(req, makeResponse('OK'));

    expect(cache.has(req)).toBe(true);
    expect(cache.has(makeRequest('Other'))).toBe(false);
  });

  it('invalidate() 应删除指定条目', () => {
    const cache = new LLMCache();
    const req = makeRequest('Test');
    cache.set(req, makeResponse('OK'));

    expect(cache.invalidate(req)).toBe(true);
    expect(cache.get(req)).toBeUndefined();
  });

  it('clear() 应清空所有数据和统计', () => {
    const cache = new LLMCache();
    cache.set(makeRequest('A'), makeResponse('RA'));
    cache.get(makeRequest('A'));
    cache.get(makeRequest('B'));

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
  });

  it('hitRate 应正确计算', () => {
    const cache = new LLMCache();
    cache.set(makeRequest('A'), makeResponse('RA'));
    cache.get(makeRequest('A')); // hit
    cache.get(makeRequest('B')); // miss
    cache.get(makeRequest('A')); // hit

    expect(cache.hitRate).toBeCloseTo(2 / 3, 2);
  });

  it('disabled 模式下不应缓存', () => {
    const cache = new LLMCache({ enabled: false });
    cache.set(makeRequest('A'), makeResponse('RA'));

    expect(cache.get(makeRequest('A'))).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('getStats() 应返回完整统计', () => {
    const cache = new LLMCache({ maxSize: 50, ttlMs: 10000 });
    cache.set(makeRequest('A'), makeResponse('RA'));
    cache.get(makeRequest('A'));

    const stats = cache.getStats();
    expect(stats.size).toBe(1);
    expect(stats.maxSize).toBe(50);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
    expect(stats.ttlMs).toBe(10000);
  });
});
