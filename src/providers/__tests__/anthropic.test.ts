/**
 * Anthropic Provider 单元测试
 *
 * 重点测试 Anthropic 与 OpenAI 的差异点：
 * 1. system 消息提取为顶层字段
 * 2. tool_use / tool_result 的 content block 格式
 * 3. 连续同角色消息的合并
 * 4. 认证 header 差异 (x-api-key)
 * 5. 流式事件的不同结构
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic.js';
import { mockJsonResponse, mockSSEResponse, mockErrorResponse } from './helpers.js';
import type { Message, ToolDefinition } from '../../types.js';

// ============================================================
// mock 数据工厂
// ============================================================

function makeAnthropicTextResponse(text: string) {
  return {
    id: 'msg_test_001',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 12, output_tokens: 8 },
  };
}

function makeAnthropicToolUseResponse() {
  return {
    id: 'msg_test_002',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: '让我查一下天气' },
      {
        type: 'tool_use',
        id: 'toolu_abc123',
        name: 'get_weather',
        input: { city: '上海' },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

function makeAnthropicStreamEvents() {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_stream_001',
        type: 'message',
        role: 'assistant',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: '你' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: '好' },
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 5 },
    },
    {
      type: 'message_stop',
    },
  ];
}

function makeAnthropicStreamToolUseEvents() {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_stream_002',
        type: 'message',
        role: 'assistant',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 15, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_stream_1', name: 'search' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"q' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: 'uery":"test"}' },
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 12 },
    },
    {
      type: 'message_stop',
    },
  ];
}

// ============================================================
// 测试
// ============================================================

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let fetchSpy: any;

  beforeEach(() => {
    provider = new AnthropicProvider({
      apiKey: 'test-anthropic-key',
      baseUrl: 'https://api.test-anthropic.com',
      defaultModel: 'claude-sonnet-4-20250514',
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------
  // 1. 基础文本对话
  // ----------------------------------------------------------

  describe('chat() - 文本对话', () => {
    it('应正确解析文本回复', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('你好世界'))
      );

      const result = await provider.chat({
        model: '',
        messages: [{ role: 'user', content: '你好' }],
      });

      expect(result.content).toBe('你好世界');
      expect(result.finishReason).toBe('stop');
      expect(result.toolCalls).toBeUndefined();
    });

    it('应正确映射 Token 用量（input_tokens → promptTokens）', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('test'))
      );

      const result = await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.usage).toEqual({
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
      });
    });
  });

  // ----------------------------------------------------------
  // 2. 工具调用（content block 格式）
  // ----------------------------------------------------------

  describe('chat() - 工具调用', () => {
    it('应从 content blocks 中提取 tool_use', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicToolUseResponse())
      );

      const result = await provider.chat({
        model: '',
        messages: [{ role: 'user', content: '上海天气' }],
      });

      expect(result.content).toBe('让我查一下天气');
      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]!.id).toBe('toolu_abc123');
      expect(result.toolCalls![0]!.function.name).toBe('get_weather');
      expect(JSON.parse(result.toolCalls![0]!.function.arguments)).toEqual({
        city: '上海',
      });
    });

    it('tool_use.input (object) 应被序列化为 JSON 字符串', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicToolUseResponse())
      );

      const result = await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(typeof result.toolCalls![0]!.function.arguments).toBe('string');
    });
  });

  // ----------------------------------------------------------
  // 3. 请求格式转换（Anthropic 特有逻辑）
  // ----------------------------------------------------------

  describe('请求格式转换', () => {
    it('system 消息应提取为顶层 system 字段', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('ok'))
      );

      await provider.chat({
        model: '',
        messages: [
          { role: 'system', content: '你是一个助手' },
          { role: 'user', content: '你好' },
        ],
      });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );

      expect(sentBody.system).toBe('你是一个助手');
      expect(sentBody.messages.every((m: any) => m.role !== 'system')).toBe(true);
    });

    it('tool 消息应转换为 user 角色的 tool_result block', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('天气晴'))
      );

      const messages: Message[] = [
        { role: 'user', content: '天气？' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: 'toolu_1', function: { name: 'weather', arguments: '{"city":"北京"}' } },
          ],
        },
        { role: 'tool', toolCallId: 'toolu_1', content: '晴天 22°C' },
      ];

      await provider.chat({ model: '', messages });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );
      const sentMessages = sentBody.messages;

      // tool_result 应被包装为 user 角色
      const toolResultMsg = sentMessages.find(
        (m: any) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.some((b: any) => b.type === 'tool_result')
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content[0].tool_use_id).toBe('toolu_1');
      expect(toolResultMsg.content[0].content).toBe('晴天 22°C');
    });

    it('连续同角色消息应被合并', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('ok'))
      );

      // 模拟一个场景: user 消息 → assistant tool_call → tool_result(user) → 新 user 消息
      // tool_result 和新 user 消息都是 user 角色，应被合并
      const messages: Message[] = [
        { role: 'user', content: '查天气' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: 'toolu_1', function: { name: 'weather', arguments: '{}' } },
          ],
        },
        { role: 'tool', toolCallId: 'toolu_1', content: '晴天' },
        { role: 'user', content: '谢谢' },
      ];

      await provider.chat({ model: '', messages });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );
      const sentMessages = sentBody.messages;

      // tool_result(user) 和 "谢谢"(user) 应合并为一条 user 消息
      const userMessages = sentMessages.filter((m: any) => m.role === 'user');
      const assistantMessages = sentMessages.filter((m: any) => m.role === 'assistant');

      // 应该是 user → assistant → user（合并后的）
      expect(sentMessages).toHaveLength(3);
      expect(sentMessages[0].role).toBe('user');
      expect(sentMessages[1].role).toBe('assistant');
      expect(sentMessages[2].role).toBe('user');
      expect(Array.isArray(sentMessages[2].content)).toBe(true);
      expect(sentMessages[2].content.length).toBe(2); // tool_result + text
    });

    it('assistant toolCalls 应转换为 tool_use content blocks', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('ok'))
      );

      const messages: Message[] = [
        { role: 'user', content: '计算' },
        {
          role: 'assistant',
          content: '好的',
          toolCalls: [
            { id: 'toolu_calc', function: { name: 'calc', arguments: '{"expr":"1+1"}' } },
          ],
        },
        { role: 'tool', toolCallId: 'toolu_calc', content: '2' },
      ];

      await provider.chat({ model: '', messages });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );
      const assistantMsg = sentBody.messages.find((m: any) => m.role === 'assistant');

      expect(Array.isArray(assistantMsg.content)).toBe(true);
      expect(assistantMsg.content[0].type).toBe('text');
      expect(assistantMsg.content[0].text).toBe('好的');
      expect(assistantMsg.content[1].type).toBe('tool_use');
      expect(assistantMsg.content[1].name).toBe('calc');
      expect(assistantMsg.content[1].input).toEqual({ expr: '1+1' });
    });

    it('工具定义应转换为 Anthropic 格式（input_schema）', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('ok'))
      );

      const tools: ToolDefinition[] = [
        {
          type: 'function',
          function: {
            name: 'search',
            description: '搜索',
            parameters: {
              type: 'object',
              properties: { q: { type: 'string' } },
            },
          },
        },
      ];

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
        tools,
      });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );

      expect(sentBody.tools[0].name).toBe('search');
      expect(sentBody.tools[0].description).toBe('搜索');
      expect(sentBody.tools[0].input_schema).toBeDefined();
      // 注意：Anthropic 用 input_schema，OpenAI 用 parameters
      expect(sentBody.tools[0].parameters).toBeUndefined();
    });

    it('应使用 x-api-key header 而非 Authorization', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('ok'))
      );

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      });

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-anthropic-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('应请求正确的 URL', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('ok'))
      );

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(fetchSpy.mock.calls[0]![0]).toBe(
        'https://api.test-anthropic.com/v1/messages'
      );
    });

    it('未设置 maxTokens 时应默认为 4096', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeAnthropicTextResponse('ok'))
      );

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );
      expect(sentBody.max_tokens).toBe(4096);
    });
  });

  // ----------------------------------------------------------
  // 4. 错误处理
  // ----------------------------------------------------------

  describe('错误处理', () => {
    it('API 返回非 200 时应抛出错误', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockErrorResponse('Overloaded', 529)
      );

      await expect(
        provider.chat({
          model: '',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow('Anthropic API error (529)');
    });
  });

  // ----------------------------------------------------------
  // 5. 流式文本输出
  // ----------------------------------------------------------

  describe('stream() - 文本流', () => {
    it('应逐块 yield text_delta', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockSSEResponse(makeAnthropicStreamEvents())
      );

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        model: '',
        messages: [{ role: 'user', content: '你好' }],
      })) {
        if (chunk.type === 'text_delta' && chunk.content) {
          chunks.push(chunk.content);
        }
      }

      expect(chunks).toEqual(['你', '好']);
    });

    it('message_delta 应 yield usage', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockSSEResponse(makeAnthropicStreamEvents())
      );

      let hasUsage = false;
      for await (const chunk of provider.stream({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      })) {
        if (chunk.type === 'usage') {
          hasUsage = true;
          expect(chunk.usage!.promptTokens).toBe(10);
          expect(chunk.usage!.completionTokens).toBe(5);
        }
      }

      expect(hasUsage).toBe(true);
    });

    it('message_stop 应 yield done', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockSSEResponse(makeAnthropicStreamEvents())
      );

      const types: string[] = [];
      for await (const chunk of provider.stream({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      })) {
        types.push(chunk.type);
      }

      expect(types).toContain('done');
    });
  });

  // ----------------------------------------------------------
  // 6. 流式工具调用
  // ----------------------------------------------------------

  describe('stream() - 工具调用流', () => {
    it('应累积 input_json_delta 为完整参数', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockSSEResponse(makeAnthropicStreamToolUseEvents())
      );

      const toolDeltas: Array<{ id?: string; name?: string; args?: string }> = [];
      for await (const chunk of provider.stream({
        model: '',
        messages: [{ role: 'user', content: 'search' }],
      })) {
        if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
          toolDeltas.push({
            id: chunk.toolCall.id,
            name: chunk.toolCall.function?.name,
            args: chunk.toolCall.function?.arguments,
          });
        }
      }

      expect(toolDeltas.length).toBeGreaterThanOrEqual(1);
      const last = toolDeltas[toolDeltas.length - 1]!;
      expect(last.id).toBe('toolu_stream_1');
      expect(last.name).toBe('search');
      expect(last.args).toBe('{"query":"test"}');
    });
  });
});
