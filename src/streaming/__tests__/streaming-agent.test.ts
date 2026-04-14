/**
 * StreamingAgent 单元测试
 * 使用 mock Provider 的 stream() 方法测试流式 ReAct 循环
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { StreamingAgent } from '../streaming-agent.js';
import type { StreamingAgentEvent } from '../streaming-agent.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ChatRequest, StreamChunk } from '../../types.js';
import { ToolRegistry, defineTool } from '../../tools/index.js';

// ============================================================
// Mock Provider 工厂
// ============================================================

function createMockStreamProvider(
  streamResponses: StreamChunk[][]
): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(),
    stream: vi.fn(async function* (_request: ChatRequest) {
      const chunks = streamResponses[callIndex];
      if (!chunks) throw new Error('No more mock stream responses');
      callIndex++;
      for (const chunk of chunks) {
        yield chunk;
      }
    }),
  } as unknown as LLMProvider;
}

// 生成一个纯文本流式响应
function textStreamChunks(text: string): StreamChunk[] {
  const words = text.split(' ');
  const chunks: StreamChunk[] = words.map((w, i) => ({
    type: 'text_delta' as const,
    content: i === 0 ? w : ` ${w}`,
  }));
  chunks.push({
    type: 'usage',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  });
  chunks.push({ type: 'done' });
  return chunks;
}

// 生成一个工具调用流式响应（模拟 Provider 的累积值模式）
function toolCallStreamChunks(
  id: string,
  name: string,
  args: string
): StreamChunk[] {
  return [
    { type: 'tool_call_delta', toolCall: { id, function: { name, arguments: '' } } },
    { type: 'tool_call_delta', toolCall: { id, function: { name, arguments: args } } },
    { type: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
    { type: 'done' },
  ];
}

const echoTool = defineTool({
  name: 'echo',
  description: '回显',
  parameters: z.object({ message: z.string() }),
  execute: async ({ message }) => ({ echo: message }),
});

function makeToolRegistry() {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  return reg;
}

// ============================================================
// 测试
// ============================================================

describe('StreamingAgent', () => {
  // ----------------------------------------------------------
  // 纯文本流式输出
  // ----------------------------------------------------------

  describe('纯文本流式', () => {
    it('应产出 text_delta + answer 事件', async () => {
      const provider = createMockStreamProvider([
        textStreamChunks('Hello World'),
      ]);

      const agent = new StreamingAgent({
        provider,
        model: 'test',
        systemPrompt: 'You are a helper',
      });

      const eventTypes: string[] = [];
      const textParts: string[] = [];

      const result = await agent.run('hi', (event) => {
        eventTypes.push(event.type);
        if (event.type === 'text_delta') textParts.push(event.content);
      });

      expect(result.content).toBe('Hello World');
      expect(result.steps).toBe(1);
      expect(eventTypes).toContain('text_delta');
      expect(eventTypes[eventTypes.length - 1]).toBe('answer');
      expect(textParts.join('')).toBe('Hello World');
    });

    it('runStream 应通过 AsyncGenerator 逐个产出事件', async () => {
      const provider = createMockStreamProvider([
        textStreamChunks('Streaming works'),
      ]);

      const agent = new StreamingAgent({
        provider,
        model: 'test',
        systemPrompt: 'test',
      });

      const events: StreamingAgentEvent[] = [];
      const gen = agent.runStream('test');
      let result = await gen.next();

      while (!result.done) {
        events.push(result.value);
        result = await gen.next();
      }

      const agentResult = result.value;
      expect(agentResult.content).toBe('Streaming works');
      expect(events.some((e) => e.type === 'text_delta')).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // 流式 + 工具调用
  // ----------------------------------------------------------

  describe('流式工具调用', () => {
    it('应先流式收集工具调用，再执行工具，再流式回复', async () => {
      const provider = createMockStreamProvider([
        // 第 1 步：流式返回工具调用
        toolCallStreamChunks('call_1', 'echo', '{"message":"hi"}'),
        // 第 2 步：流式返回最终回复
        textStreamChunks('Echo returned hi'),
      ]);

      const agent = new StreamingAgent({
        provider,
        model: 'test',
        systemPrompt: 'test',
        tools: makeToolRegistry(),
      });

      const eventTypes: string[] = [];
      const result = await agent.run('echo hi', (e) => eventTypes.push(e.type));

      expect(result.content).toBe('Echo returned hi');
      expect(result.steps).toBe(2);
      expect(eventTypes).toContain('tool_call');
      expect(eventTypes).toContain('tool_result');
      expect(eventTypes).toContain('text_delta');
      expect(eventTypes[eventTypes.length - 1]).toBe('answer');
    });
  });

  // ----------------------------------------------------------
  // 最大步数
  // ----------------------------------------------------------

  describe('最大步数', () => {
    it('应在达到 maxSteps 时终止', async () => {
      const infiniteToolCalls = Array.from({ length: 5 }, () =>
        toolCallStreamChunks('c1', 'echo', '{"message":"loop"}')
      );

      const provider = createMockStreamProvider(infiniteToolCalls);

      const agent = new StreamingAgent({
        provider,
        model: 'test',
        systemPrompt: 'test',
        tools: makeToolRegistry(),
        maxSteps: 2,
      });

      const result = await agent.run('loop');
      expect(result.steps).toBe(2);
      expect(result.content).toContain('maximum steps');
    });
  });

  // ----------------------------------------------------------
  // 错误处理
  // ----------------------------------------------------------

  describe('错误处理', () => {
    it('流式错误应被捕获', async () => {
      const provider = {
        chat: vi.fn(),
        stream: vi.fn(async function* () {
          yield { type: 'text_delta' as const, content: 'partial' };
          throw new Error('Connection lost');
        }),
      } as unknown as LLMProvider;

      const agent = new StreamingAgent({
        provider,
        model: 'test',
        systemPrompt: 'test',
      });

      const result = await agent.run('test');
      expect(result.content).toContain('Connection lost');
      expect(result.events.some((e) => e.type === 'error')).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // Token 用量
  // ----------------------------------------------------------

  describe('Token 用量', () => {
    it('多轮流式调用的 usage 应累加', async () => {
      const provider = createMockStreamProvider([
        toolCallStreamChunks('c1', 'echo', '{"message":"x"}'),
        textStreamChunks('done'),
      ]);

      const agent = new StreamingAgent({
        provider,
        model: 'test',
        systemPrompt: 'test',
        tools: makeToolRegistry(),
      });

      const result = await agent.run('test');
      // 2 轮，每轮 15 tokens
      expect(result.usage.totalTokens).toBe(30);
    });
  });
});
