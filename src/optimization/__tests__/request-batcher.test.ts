/**
 * RequestBatcher -- 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { RequestBatcher } from '../request-batcher.js';
import type { ChatRequest, ChatResponse } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';

const makeRequest = (content: string): ChatRequest => ({
  model: 'gpt-4o',
  messages: [{ role: 'user', content }],
});

const makeResponse = (content: string): ChatResponse => ({
  id: `resp-${content}`,
  content,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  finishReason: 'stop',
});

function createMockProvider(): LLMProvider {
  return {
    chat: vi.fn(async (req: ChatRequest) => {
      await new Promise((r) => setTimeout(r, 10));
      const content = req.messages[req.messages.length - 1]!;
      const text = 'content' in content ? content.content : 'response';
      return makeResponse(`echo-${text}`);
    }),
    stream: vi.fn(),
  } as any;
}

describe('RequestBatcher', () => {
  it('应正常处理单个请求', async () => {
    const provider = createMockProvider();
    const batcher = new RequestBatcher({ provider, deduplication: false });

    const response = await batcher.submit(makeRequest('Hello'));
    expect(response.content).toBe('echo-Hello');
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it('应并发控制请求', async () => {
    const callOrder: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const provider: LLMProvider = {
      chat: vi.fn(async (req: ChatRequest) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        const msg = req.messages[req.messages.length - 1]!;
        const text = 'content' in msg ? msg.content : '';
        callOrder.push(parseInt(text ?? '0'));
        return makeResponse(text ?? '');
      }),
      stream: vi.fn(),
    } as any;

    const batcher = new RequestBatcher({
      provider,
      maxConcurrency: 2,
      deduplication: false,
    });

    const promises = [
      batcher.submit(makeRequest('1')),
      batcher.submit(makeRequest('2')),
      batcher.submit(makeRequest('3')),
      batcher.submit(makeRequest('4')),
    ];

    await Promise.all(promises);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(provider.chat).toHaveBeenCalledTimes(4);
  });

  it('去重缓存应避免重复调用', async () => {
    const provider = createMockProvider();
    const batcher = new RequestBatcher({
      provider,
      deduplication: true,
    });

    const r1 = await batcher.submit(makeRequest('Hello'));
    const r2 = await batcher.submit(makeRequest('Hello'));

    expect(r1.content).toBe(r2.content);
    expect(provider.chat).toHaveBeenCalledTimes(1);

    const stats = batcher.getStats();
    expect(stats.deduplicated).toBe(1);
  });

  it('submitBatch 应批量处理', async () => {
    const provider = createMockProvider();
    const batcher = new RequestBatcher({ provider, deduplication: false });

    const responses = await batcher.submitBatch([
      makeRequest('A'),
      makeRequest('B'),
      makeRequest('C'),
    ]);

    expect(responses).toHaveLength(3);
    expect(responses[0]!.content).toBe('echo-A');
    expect(responses[2]!.content).toBe('echo-C');
  });

  it('provider 失败应正确 reject', async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockRejectedValue(new Error('API Error')),
      stream: vi.fn(),
    } as any;

    const batcher = new RequestBatcher({ provider, deduplication: false });

    await expect(batcher.submit(makeRequest('Test')))
      .rejects.toThrow('API Error');

    const stats = batcher.getStats();
    expect(stats.failed).toBe(1);
  });

  it('getStats 应返回正确统计', async () => {
    const provider = createMockProvider();
    const batcher = new RequestBatcher({ provider, deduplication: true });

    await batcher.submit(makeRequest('A'));
    await batcher.submit(makeRequest('A')); // dedup
    await batcher.submit(makeRequest('B'));

    const stats = batcher.getStats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.completed).toBe(2);
    expect(stats.deduplicated).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.cacheStats).toBeDefined();
  });

  it('reset 应清空统计', async () => {
    const provider = createMockProvider();
    const batcher = new RequestBatcher({ provider });

    await batcher.submit(makeRequest('A'));
    batcher.reset();

    const stats = batcher.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.completed).toBe(0);
  });
});
