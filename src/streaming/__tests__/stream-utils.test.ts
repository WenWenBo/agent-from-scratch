/**
 * 流式工具函数单元测试
 */

import { describe, it, expect } from 'vitest';
import type { StreamChunk } from '../../types.js';
import { StreamCollector, collectStream, streamToText } from '../stream-utils.js';

// ============================================================
// 辅助函数：创建 AsyncIterable
// ============================================================

async function* toStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ============================================================
// StreamCollector
// ============================================================

describe('StreamCollector', () => {
  it('应正确累积文本内容', () => {
    const collector = new StreamCollector();
    collector.push({ type: 'text_delta', content: 'Hello' });
    collector.push({ type: 'text_delta', content: ' World' });
    collector.push({ type: 'done' });

    const response = collector.getResponse();
    expect(response.content).toBe('Hello World');
    expect(response.finishReason).toBe('stop');
  });

  it('应正确累积工具调用（Provider 产出累积值模式）', () => {
    const collector = new StreamCollector();
    // Provider 每次 yield 的是累积值（非增量）
    collector.push({
      type: 'tool_call_delta',
      toolCall: { id: 'call_1', function: { name: 'calc', arguments: '' } },
    });
    collector.push({
      type: 'tool_call_delta',
      toolCall: { id: 'call_1', function: { name: 'calc', arguments: '{"expr' } },
    });
    collector.push({
      type: 'tool_call_delta',
      toolCall: { id: 'call_1', function: { name: 'calc', arguments: '{"expr":"2+2"}' } },
    });
    collector.push({ type: 'done' });

    const response = collector.getResponse();
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.id).toBe('call_1');
    expect(response.toolCalls![0]!.function.name).toBe('calc');
    expect(response.toolCalls![0]!.function.arguments).toBe('{"expr":"2+2"}');
    expect(response.finishReason).toBe('tool_calls');
  });

  it('应正确处理 usage', () => {
    const collector = new StreamCollector();
    collector.push({ type: 'text_delta', content: 'hi' });
    collector.push({
      type: 'usage',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    collector.push({ type: 'done' });

    const response = collector.getResponse();
    expect(response.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('文本+工具调用混合时应正确处理', () => {
    const collector = new StreamCollector();
    collector.push({ type: 'text_delta', content: '让我计算一下' });
    collector.push({
      type: 'tool_call_delta',
      toolCall: { id: 'c1', function: { name: 'calc', arguments: '{"x":1}' } },
    });
    collector.push({ type: 'done' });

    const response = collector.getResponse();
    expect(response.content).toBe('让我计算一下');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.finishReason).toBe('tool_calls');
  });

  it('空 stream 应返回空内容', () => {
    const collector = new StreamCollector();
    collector.push({ type: 'done' });

    const response = collector.getResponse();
    expect(response.content).toBeNull();
    expect(response.finishReason).toBe('stop');
  });
});

// ============================================================
// collectStream
// ============================================================

describe('collectStream', () => {
  it('应将 stream 收集为完整 ChatResponse', async () => {
    const chunks: StreamChunk[] = [
      { type: 'text_delta', content: 'Hello' },
      { type: 'text_delta', content: ' World' },
      { type: 'usage', usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } },
      { type: 'done' },
    ];

    const response = await collectStream(toStream(chunks));
    expect(response.content).toBe('Hello World');
    expect(response.usage.totalTokens).toBe(8);
  });
});

// ============================================================
// streamToText
// ============================================================

describe('streamToText', () => {
  it('应只提取文本内容', async () => {
    const chunks: StreamChunk[] = [
      { type: 'text_delta', content: 'Hello' },
      { type: 'usage', usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } },
      { type: 'text_delta', content: ' World' },
      { type: 'done' },
    ];

    const text = await streamToText(toStream(chunks));
    expect(text).toBe('Hello World');
  });

  it('无文本 chunk 应返回空字符串', async () => {
    const chunks: StreamChunk[] = [
      { type: 'done' },
    ];

    const text = await streamToText(toStream(chunks));
    expect(text).toBe('');
  });
});
