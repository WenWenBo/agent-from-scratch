/**
 * MemoryAgent 单元测试
 * 用 mock Provider 验证记忆系统与 ReAct 循环的集成
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { MemoryAgent } from '../memory-agent.js';
import { InMemoryStore } from '../memory-store.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ChatRequest, ChatResponse } from '../../types.js';
import { ToolRegistry, defineTool } from '../../tools/index.js';

// ============================================================
// Helpers
// ============================================================

function createMockProvider(responses: ChatResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(async (_request: ChatRequest): Promise<ChatResponse> => {
      const response = responses[callIndex];
      if (!response) throw new Error('No more mock responses');
      callIndex++;
      return response;
    }),
    stream: vi.fn(),
  } as unknown as LLMProvider;
}

function makeUsage(p = 10, c = 5) {
  return { promptTokens: p, completionTokens: c, totalTokens: p + c };
}

const echoTool = defineTool({
  name: 'echo',
  description: '回显输入',
  parameters: z.object({ message: z.string() }),
  execute: async ({ message }) => ({ echo: message }),
});

// ============================================================
// 测试
// ============================================================

describe('MemoryAgent', () => {
  // ----------------------------------------------------------
  // 基础对话
  // ----------------------------------------------------------

  describe('基础对话', () => {
    it('单轮对话应正确返回', async () => {
      const provider = createMockProvider([
        { id: 'r1', content: '你好！', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' },
      ]);

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
      });

      const result = await agent.chat('你好');
      expect(result.content).toBe('你好！');
      expect(result.steps).toBe(1);
    });

    it('多轮对话应保持上下文', async () => {
      let callCount = 0;
      const provider = {
        chat: vi.fn(async (request: ChatRequest): Promise<ChatResponse> => {
          callCount++;
          if (callCount === 1) {
            return { id: 'r1', content: '你好！', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' };
          }
          // 第 2 轮应能看到第 1 轮的历史
          const hasHistory = request.messages.some(
            (m) => m.role === 'user' && m.content === '你好'
          );
          const hasAssistantReply = request.messages.some(
            (m) => m.role === 'assistant' && m.content === '你好！'
          );
          expect(hasHistory).toBe(true);
          expect(hasAssistantReply).toBe(true);

          return { id: 'r2', content: '我之前说过你好', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' };
        }),
        stream: vi.fn(),
      } as unknown as LLMProvider;

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
      });

      await agent.chat('你好');
      const r2 = await agent.chat('你之前说了什么？');
      expect(r2.content).toBe('我之前说过你好');
      expect(agent.getMessageCount()).toBe(4); // user + assistant + user + assistant
    });
  });

  // ----------------------------------------------------------
  // 工具调用与记忆
  // ----------------------------------------------------------

  describe('工具调用与记忆', () => {
    it('工具调用后的消息应加入记忆', async () => {
      const provider = createMockProvider([
        {
          id: 'r1',
          content: null,
          toolCalls: [{ id: 'c1', function: { name: 'echo', arguments: '{"message":"test"}' } }],
          usage: makeUsage(),
          finishReason: 'tool_calls',
        },
        {
          id: 'r2',
          content: 'Echo 返回了 test',
          toolCalls: undefined,
          usage: makeUsage(),
          finishReason: 'stop',
        },
      ]);

      const tools = new ToolRegistry();
      tools.register(echoTool);

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools,
      });

      await agent.chat('echo test');

      // 记忆中应有：user + assistant(toolCall) + tool(result) + assistant(final)
      expect(agent.getMessageCount()).toBe(4);
    });
  });

  // ----------------------------------------------------------
  // 长期记忆
  // ----------------------------------------------------------

  describe('长期记忆', () => {
    it('remember 应存入长期记忆', async () => {
      const store = new InMemoryStore();
      const provider = createMockProvider([
        { id: 'r1', content: '好的', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' },
      ]);

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        longTermMemory: store,
      });

      await agent.remember('用户喜欢 TypeScript', { source: 'chat' }, 0.9);
      expect(await store.size()).toBe(1);
    });

    it('recall 应搜索长期记忆', async () => {
      const store = new InMemoryStore();
      await store.add({ content: '用户喜欢 TypeScript', metadata: {}, importance: 0.8 });
      await store.add({ content: '用户不喜欢 Java', metadata: {}, importance: 0.5 });

      const provider = createMockProvider([]);

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        longTermMemory: store,
      });

      const results = await agent.recall('TypeScript');
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('TypeScript');
    });

    it('长期记忆应注入 system 消息', async () => {
      const store = new InMemoryStore();
      await store.add({ content: 'User prefers TypeScript', metadata: {}, importance: 0.9 });

      let capturedSystemContent = '';
      const provider = {
        chat: vi.fn(async (request: ChatRequest): Promise<ChatResponse> => {
          const sys = request.messages[0]!;
          if (sys.role === 'system') {
            capturedSystemContent = sys.content;
          }
          return { id: 'r1', content: 'TypeScript!', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' };
        }),
        stream: vi.fn(),
      } as unknown as LLMProvider;

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        longTermMemory: store,
      });

      // 用户输入中包含 "TypeScript"，能匹配到长期记忆
      const result = await agent.chat('Tell me about TypeScript');
      expect(result.content).toBe('TypeScript!');
      expect(capturedSystemContent).toContain('User prefers TypeScript');
      expect(capturedSystemContent).toContain('[Relevant memories]');
    });
  });

  // ----------------------------------------------------------
  // 自动摘要
  // ----------------------------------------------------------

  describe('自动摘要', () => {
    it('消息数达到阈值时应触发摘要', async () => {
      const summaryCallIndex = { value: -1 };
      let callCount = 0;

      const provider = {
        chat: vi.fn(async (request: ChatRequest): Promise<ChatResponse> => {
          callCount++;
          // 检测摘要请求
          const isSummaryRequest = request.messages.some(
            (m) => m.role === 'system' && m.content.includes('summarizer')
          );
          if (isSummaryRequest) {
            summaryCallIndex.value = callCount;
            return {
              id: `summary`,
              content: 'User discussed various topics including greetings.',
              toolCalls: undefined,
              usage: makeUsage(),
              finishReason: 'stop',
            };
          }
          return {
            id: `r${callCount}`,
            content: `回复 ${callCount}`,
            toolCalls: undefined,
            usage: makeUsage(),
            finishReason: 'stop',
          };
        }),
        stream: vi.fn(),
      } as unknown as LLMProvider;

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        summaryThreshold: 6,
        summaryKeepRecent: 2,
      });

      // 添加足够多的消息触发摘要
      for (let i = 0; i < 4; i++) {
        await agent.chat(`消息 ${i}`);
      }

      // 第 4 轮时消息数为 8（4 user + 4 assistant），超过阈值 6
      // 应该已经触发过摘要
      expect(summaryCallIndex.value).toBeGreaterThan(0);

      // 摘要后消息数应减少
      expect(agent.getMessageCount()).toBeLessThanOrEqual(6);
    });
  });

  // ----------------------------------------------------------
  // 会话管理
  // ----------------------------------------------------------

  describe('会话管理', () => {
    it('resetConversation 应清空短期记忆', async () => {
      const provider = createMockProvider([
        { id: 'r1', content: '你好', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' },
      ]);

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
      });

      await agent.chat('hi');
      expect(agent.getMessageCount()).toBe(2);

      agent.resetConversation();
      expect(agent.getMessageCount()).toBe(0);
    });

    it('重置后长期记忆应保留', async () => {
      const store = new InMemoryStore();
      const provider = createMockProvider([
        { id: 'r1', content: '好的', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' },
      ]);

      const agent = new MemoryAgent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        longTermMemory: store,
      });

      await agent.remember('important fact');
      await agent.chat('hi');
      agent.resetConversation();

      expect(agent.getMessageCount()).toBe(0);
      expect(await store.size()).toBe(1);
    });
  });
});
