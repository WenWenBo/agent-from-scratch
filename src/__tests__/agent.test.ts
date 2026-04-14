/**
 * Agent 单元测试
 * 用 mock Provider 测试 ReAct 循环的所有路径，不依赖真实 API
 *
 * 覆盖场景：
 * 1. 纯对话（无工具）-- 1 步直接回复
 * 2. 单工具调用 -- 2 步（调用 → 回复）
 * 3. 多步工具调用 -- 3+ 步（连续调用多个工具）
 * 4. 并行工具调用 -- 1 步返回多个 tool_calls
 * 5. 工具执行失败 -- LLM 收到错误后应能恢复
 * 6. 最大步数限制 -- 防止无限循环
 * 7. LLM 调用失败 -- 网络错误等
 * 8. 事件回调 -- onEvent 被正确触发
 * 9. Token 用量累计 -- 多轮调用的 usage 正确累加
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { Agent } from '../agent.js';
import type { AgentEvent } from '../agent.js';
import type { LLMProvider } from '../providers/base.js';
import type { ChatRequest, ChatResponse } from '../types.js';
import { ToolRegistry, defineTool } from '../tools/index.js';

// ============================================================
// Mock Provider 工厂
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

function makeUsage(prompt = 10, completion = 5): ChatResponse['usage'] {
  return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
}

// ============================================================
// 测试用工具
// ============================================================

const echoTool = defineTool({
  name: 'echo',
  description: '回显输入',
  parameters: z.object({ message: z.string() }),
  execute: async ({ message }) => ({ echo: message }),
});

const addTool = defineTool({
  name: 'add',
  description: '两数相加',
  parameters: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => ({ result: a + b }),
});

const failingTool = defineTool({
  name: 'failing',
  description: '总是失败',
  parameters: z.object({}),
  execute: async () => { throw new Error('Tool crashed'); },
});

function makeRegistry(...tools: any[]): ToolRegistry {
  const reg = new ToolRegistry();
  reg.registerMany(tools);
  return reg;
}

// ============================================================
// 测试
// ============================================================

describe('Agent', () => {
  // ----------------------------------------------------------
  // 1. 纯对话
  // ----------------------------------------------------------

  describe('纯对话（无工具）', () => {
    it('应 1 步直接返回回复', async () => {
      const provider = createMockProvider([
        { id: 'r1', content: '你好！', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
      });

      const result = await agent.run('你好');

      expect(result.content).toBe('你好！');
      expect(result.steps).toBe(1);
      expect(result.messages).toHaveLength(3); // system + user + assistant
    });
  });

  // ----------------------------------------------------------
  // 2. 单工具调用
  // ----------------------------------------------------------

  describe('单工具调用', () => {
    it('应完成 think → act → observe → answer 循环', async () => {
      const provider = createMockProvider([
        // 第 1 步：LLM 决定调用工具
        {
          id: 'r1',
          content: null,
          toolCalls: [{ id: 'call_1', function: { name: 'echo', arguments: '{"message":"hi"}' } }],
          usage: makeUsage(10, 5),
          finishReason: 'tool_calls',
        },
        // 第 2 步：LLM 看到工具结果，生成最终回复
        {
          id: 'r2',
          content: '工具返回了: hi',
          toolCalls: undefined,
          usage: makeUsage(20, 8),
          finishReason: 'stop',
        },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools: makeRegistry(echoTool),
      });

      const result = await agent.run('测试 echo');

      expect(result.content).toBe('工具返回了: hi');
      expect(result.steps).toBe(2);

      // 消息历史: system + user + assistant(toolCall) + tool(result) + assistant(final)
      expect(result.messages).toHaveLength(5);
      expect(result.messages[2]!.role).toBe('assistant');
      expect(result.messages[3]!.role).toBe('tool');
      expect(result.messages[4]!.role).toBe('assistant');
    });

    it('工具结果应正确序列化为 JSON 字符串', async () => {
      const provider = createMockProvider([
        {
          id: 'r1',
          content: null,
          toolCalls: [{ id: 'call_1', function: { name: 'add', arguments: '{"a":3,"b":4}' } }],
          usage: makeUsage(),
          finishReason: 'tool_calls',
        },
        {
          id: 'r2',
          content: '结果是 7',
          toolCalls: undefined,
          usage: makeUsage(),
          finishReason: 'stop',
        },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools: makeRegistry(addTool),
      });

      const result = await agent.run('3+4');

      const toolMsg = result.messages[3]!;
      expect(toolMsg.role).toBe('tool');
      if (toolMsg.role === 'tool') {
        expect(JSON.parse(toolMsg.content)).toEqual({ result: 7 });
      }
    });
  });

  // ----------------------------------------------------------
  // 3. 多步工具调用
  // ----------------------------------------------------------

  describe('多步工具调用', () => {
    it('应支持连续多轮工具调用', async () => {
      const provider = createMockProvider([
        // 第 1 步：调用 echo
        {
          id: 'r1',
          content: '先回显一下',
          toolCalls: [{ id: 'call_1', function: { name: 'echo', arguments: '{"message":"step1"}' } }],
          usage: makeUsage(),
          finishReason: 'tool_calls',
        },
        // 第 2 步：再调用 add
        {
          id: 'r2',
          content: '再算一下',
          toolCalls: [{ id: 'call_2', function: { name: 'add', arguments: '{"a":1,"b":2}' } }],
          usage: makeUsage(),
          finishReason: 'tool_calls',
        },
        // 第 3 步：最终回复
        {
          id: 'r3',
          content: '全部完成',
          toolCalls: undefined,
          usage: makeUsage(),
          finishReason: 'stop',
        },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools: makeRegistry(echoTool, addTool),
      });

      const result = await agent.run('多步测试');

      expect(result.steps).toBe(3);
      expect(result.content).toBe('全部完成');
    });
  });

  // ----------------------------------------------------------
  // 4. 并行工具调用
  // ----------------------------------------------------------

  describe('并行工具调用', () => {
    it('应处理一轮中返回多个 tool_calls', async () => {
      const provider = createMockProvider([
        {
          id: 'r1',
          content: null,
          toolCalls: [
            { id: 'call_a', function: { name: 'echo', arguments: '{"message":"a"}' } },
            { id: 'call_b', function: { name: 'add', arguments: '{"a":10,"b":20}' } },
          ],
          usage: makeUsage(),
          finishReason: 'tool_calls',
        },
        {
          id: 'r2',
          content: '两个工具都执行完了',
          toolCalls: undefined,
          usage: makeUsage(),
          finishReason: 'stop',
        },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools: makeRegistry(echoTool, addTool),
      });

      const result = await agent.run('并行测试');

      expect(result.steps).toBe(2);
      // 消息历史应包含 2 条 tool 消息
      const toolMessages = result.messages.filter((m) => m.role === 'tool');
      expect(toolMessages).toHaveLength(2);
    });
  });

  // ----------------------------------------------------------
  // 5. 工具执行失败
  // ----------------------------------------------------------

  describe('工具执行失败', () => {
    it('工具异常应作为错误消息返回给 LLM', async () => {
      const provider = createMockProvider([
        {
          id: 'r1',
          content: null,
          toolCalls: [{ id: 'call_1', function: { name: 'failing', arguments: '{}' } }],
          usage: makeUsage(),
          finishReason: 'tool_calls',
        },
        {
          id: 'r2',
          content: '工具出错了，让我换个方式',
          toolCalls: undefined,
          usage: makeUsage(),
          finishReason: 'stop',
        },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools: makeRegistry(failingTool),
      });

      const result = await agent.run('测试失败');

      expect(result.content).toBe('工具出错了，让我换个方式');
      // 工具错误消息应包含错误信息
      const toolMsg = result.messages.find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      if (toolMsg?.role === 'tool') {
        expect(toolMsg.content).toContain('Error');
      }
    });
  });

  // ----------------------------------------------------------
  // 6. 最大步数限制
  // ----------------------------------------------------------

  describe('最大步数限制', () => {
    it('达到 maxSteps 应终止循环', async () => {
      // LLM 每次都返回工具调用，永不停止
      const infiniteToolCalls = Array.from({ length: 10 }, (_, i) => ({
        id: `r${i}`,
        content: null,
        toolCalls: [{ id: `call_${i}`, function: { name: 'echo', arguments: '{"message":"loop"}' } }],
        usage: makeUsage(),
        finishReason: 'tool_calls' as const,
      }));

      const provider = createMockProvider(infiniteToolCalls);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools: makeRegistry(echoTool),
        maxSteps: 3,
      });

      const result = await agent.run('无限循环测试');

      expect(result.steps).toBe(3);
      expect(result.content).toContain('maximum steps');
    });
  });

  // ----------------------------------------------------------
  // 7. LLM 调用失败
  // ----------------------------------------------------------

  describe('LLM 调用失败', () => {
    it('网络错误应被捕获并返回', async () => {
      const provider = {
        chat: vi.fn(async () => { throw new Error('Network timeout'); }),
        stream: vi.fn(),
      } as unknown as LLMProvider;

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
      });

      const result = await agent.run('测试');

      expect(result.content).toContain('Network timeout');
      expect(result.events.some((e) => e.type === 'error')).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // 8. 事件回调
  // ----------------------------------------------------------

  describe('事件回调', () => {
    it('应按正确顺序触发事件', async () => {
      const provider = createMockProvider([
        {
          id: 'r1',
          content: '让我算一下',
          toolCalls: [{ id: 'call_1', function: { name: 'add', arguments: '{"a":1,"b":2}' } }],
          usage: makeUsage(),
          finishReason: 'tool_calls',
        },
        {
          id: 'r2',
          content: '结果是 3',
          toolCalls: undefined,
          usage: makeUsage(),
          finishReason: 'stop',
        },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools: makeRegistry(addTool),
      });

      const eventTypes: string[] = [];
      await agent.run('1+2', (event) => eventTypes.push(event.type));

      expect(eventTypes).toEqual([
        'thinking',     // LLM 思考
        'tool_call',    // 发起工具调用
        'tool_result',  // 工具执行结果
        'answer',       // 最终回复
      ]);
    });

    it('events 数组应与 onEvent 回调一致', async () => {
      const provider = createMockProvider([
        { id: 'r1', content: '直接回复', toolCalls: undefined, usage: makeUsage(), finishReason: 'stop' },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
      });

      const callbackEvents: AgentEvent[] = [];
      const result = await agent.run('测试', (e) => callbackEvents.push(e));

      expect(result.events).toEqual(callbackEvents);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe('answer');
    });
  });

  // ----------------------------------------------------------
  // 9. Token 用量累计
  // ----------------------------------------------------------

  describe('Token 用量累计', () => {
    it('多轮调用的 usage 应正确累加', async () => {
      const provider = createMockProvider([
        {
          id: 'r1',
          content: null,
          toolCalls: [{ id: 'call_1', function: { name: 'echo', arguments: '{"message":"x"}' } }],
          usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
          finishReason: 'tool_calls',
        },
        {
          id: 'r2',
          content: '完成',
          toolCalls: undefined,
          usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
          finishReason: 'stop',
        },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        tools: makeRegistry(echoTool),
      });

      const result = await agent.run('测试');

      expect(result.usage).toEqual({
        promptTokens: 300,
        completionTokens: 50,
        totalTokens: 350,
      });
    });
  });

  // ----------------------------------------------------------
  // 10. 无工具但 LLM 返回 tool_calls
  // ----------------------------------------------------------

  describe('边界情况', () => {
    it('无工具注册但 LLM 返回 tool_calls 应报错', async () => {
      const provider = createMockProvider([
        {
          id: 'r1',
          content: null,
          toolCalls: [{ id: 'call_1', function: { name: 'ghost', arguments: '{}' } }],
          usage: makeUsage(),
          finishReason: 'tool_calls',
        },
      ]);

      const agent = new Agent({
        provider,
        model: 'test',
        systemPrompt: '你是助手',
        // 注意：没有传 tools
      });

      const result = await agent.run('测试');
      expect(result.content).toContain('No tools available');
    });
  });
});
