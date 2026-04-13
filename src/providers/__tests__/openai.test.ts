/**
 * OpenAI Provider 单元测试
 *
 * 测试策略：用 vi.spyOn(globalThis, 'fetch') 拦截 HTTP 请求，
 * 返回预构造的 mock Response，完全不依赖真实 API。
 *
 * 覆盖场景：
 * 1. 基础文本对话（非流式）
 * 2. 带工具调用的对话（非流式）
 * 3. 流式文本输出
 * 4. 流式工具调用
 * 5. API 错误处理
 * 6. 请求参数格式转换
 * 7. SSE 分包缓冲区处理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai.js';
import {
  mockJsonResponse,
  mockSSEResponse,
  mockChunkedSSEResponse,
  mockErrorResponse,
} from './helpers.js';
import type { ChatRequest, Message, ToolDefinition } from '../../types.js';

// ============================================================
// 测试用的 mock 数据工厂
// ============================================================

function makeOpenAITextResponse(content: string) {
  return {
    id: 'chatcmpl-test-001',
    choices: [
      {
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };
}

function makeOpenAIToolCallResponse() {
  return {
    id: 'chatcmpl-test-002',
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"city":"北京"}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: {
      prompt_tokens: 15,
      completion_tokens: 25,
      total_tokens: 40,
    },
  };
}

function makeStreamTextChunks() {
  return [
    {
      id: 'chatcmpl-stream-001',
      choices: [{ delta: { role: 'assistant' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-stream-001',
      choices: [{ delta: { content: '你' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-stream-001',
      choices: [{ delta: { content: '好' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-stream-001',
      choices: [{ delta: { content: '！' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-stream-001',
      choices: [{ delta: {}, finish_reason: 'stop' }],
    },
  ];
}

function makeStreamToolCallChunks() {
  return [
    {
      id: 'chatcmpl-stream-002',
      choices: [
        {
          delta: {
            role: 'assistant',
            tool_calls: [
              { index: 0, id: 'call_xyz', type: 'function', function: { name: 'get_weather', arguments: '' } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-stream-002',
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: '{"ci' } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-stream-002',
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: 'ty":"北京"}' } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-stream-002',
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    },
  ];
}

// ============================================================
// 测试
// ============================================================

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.test.com/v1',
      defaultModel: 'gpt-4o-mini',
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
        mockJsonResponse(makeOpenAITextResponse('你好世界'))
      );

      const result = await provider.chat({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: '你好' }],
      });

      expect(result.content).toBe('你好世界');
      expect(result.finishReason).toBe('stop');
      expect(result.toolCalls).toBeUndefined();
    });

    it('应正确解析 Token 用量', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeOpenAITextResponse('test'))
      );

      const result = await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });
    });

    it('空 model 时应使用 defaultModel', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeOpenAITextResponse('ok'))
      );

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );
      expect(sentBody.model).toBe('gpt-4o-mini');
    });
  });

  // ----------------------------------------------------------
  // 2. 工具调用
  // ----------------------------------------------------------

  describe('chat() - 工具调用', () => {
    it('应正确解析 tool_calls', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeOpenAIToolCallResponse())
      );

      const result = await provider.chat({
        model: '',
        messages: [{ role: 'user', content: '北京天气' }],
      });

      expect(result.content).toBeNull();
      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]!.id).toBe('call_abc123');
      expect(result.toolCalls![0]!.function.name).toBe('get_weather');
      expect(JSON.parse(result.toolCalls![0]!.function.arguments)).toEqual({
        city: '北京',
      });
    });
  });

  // ----------------------------------------------------------
  // 3. 请求格式转换
  // ----------------------------------------------------------

  describe('请求格式转换', () => {
    it('应正确转换所有消息角色', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeOpenAITextResponse('ok'))
      );

      const messages: Message[] = [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '问题' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } },
          ],
        },
        { role: 'tool', toolCallId: 'call_1', content: '结果' },
      ];

      await provider.chat({ model: '', messages });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );
      const sentMessages = sentBody.messages;

      expect(sentMessages).toHaveLength(4);
      expect(sentMessages[0].role).toBe('system');
      expect(sentMessages[1].role).toBe('user');
      expect(sentMessages[2].role).toBe('assistant');
      expect(sentMessages[2].tool_calls[0].id).toBe('call_1');
      expect(sentMessages[3].role).toBe('tool');
      expect(sentMessages[3].tool_call_id).toBe('call_1');
    });

    it('应正确转换工具定义', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeOpenAITextResponse('ok'))
      );

      const tools: ToolDefinition[] = [
        {
          type: 'function',
          function: {
            name: 'calculator',
            description: '计算数学表达式',
            parameters: {
              type: 'object',
              properties: {
                expression: { type: 'string' },
              },
              required: ['expression'],
            },
          },
        },
      ];

      await provider.chat({ model: '', messages: [{ role: 'user', content: 'test' }], tools });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );

      expect(sentBody.tools).toHaveLength(1);
      expect(sentBody.tools[0].type).toBe('function');
      expect(sentBody.tools[0].function.name).toBe('calculator');
      expect(sentBody.tools[0].function.description).toBe('计算数学表达式');
    });

    it('应正确传递 temperature / maxTokens / stop', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeOpenAITextResponse('ok'))
      );

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.3,
        maxTokens: 100,
        stop: ['\n'],
      });

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );

      expect(sentBody.temperature).toBe(0.3);
      expect(sentBody.max_tokens).toBe(100);
      expect(sentBody.stop).toEqual(['\n']);
      expect(sentBody.stream).toBe(false);
    });

    it('应正确设置 Authorization header', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeOpenAITextResponse('ok'))
      );

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      });

      const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-key');
    });

    it('应请求正确的 URL', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse(makeOpenAITextResponse('ok'))
      );

      await provider.chat({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(fetchSpy.mock.calls[0]![0]).toBe(
        'https://api.test.com/v1/chat/completions'
      );
    });
  });

  // ----------------------------------------------------------
  // 4. 错误处理
  // ----------------------------------------------------------

  describe('错误处理', () => {
    it('API 返回非 200 时应抛出错误', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockErrorResponse('Invalid API Key', 401)
      );

      await expect(
        provider.chat({
          model: '',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow('OpenAI API error (401)');
    });

    it('空 choices 应抛出错误', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockJsonResponse({
          id: 'test',
          choices: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        })
      );

      await expect(
        provider.chat({
          model: '',
          messages: [{ role: 'user', content: 'test' }],
        })
      ).rejects.toThrow('OpenAI returned empty choices');
    });
  });

  // ----------------------------------------------------------
  // 5. 流式文本输出
  // ----------------------------------------------------------

  describe('stream() - 文本流', () => {
    it('应逐块 yield 文本', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockSSEResponse(makeStreamTextChunks())
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

      expect(chunks).toEqual(['你', '好', '！']);
    });

    it('流结束时应 yield done', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockSSEResponse(makeStreamTextChunks())
      );

      const types: string[] = [];
      for await (const chunk of provider.stream({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      })) {
        types.push(chunk.type);
      }

      expect(types.filter((t) => t === 'done').length).toBeGreaterThanOrEqual(1);
    });

    it('stream=true 应正确传递给 API', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockSSEResponse(makeStreamTextChunks())
      );

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      })) {
        // consume
      }

      const sentBody = JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string
      );
      expect(sentBody.stream).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // 6. 流式工具调用
  // ----------------------------------------------------------

  describe('stream() - 工具调用流', () => {
    it('应累积 tool_call 的分片参数', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockSSEResponse(makeStreamToolCallChunks())
      );

      const toolDeltas: Array<{ id?: string; name?: string; args?: string }> = [];
      for await (const chunk of provider.stream({
        model: '',
        messages: [{ role: 'user', content: '天气' }],
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
      expect(last.id).toBe('call_xyz');
      expect(last.name).toBe('get_weather');
      expect(last.args).toBe('{"city":"北京"}');
    });
  });

  // ----------------------------------------------------------
  // 7. SSE 缓冲区分包处理
  // ----------------------------------------------------------

  describe('stream() - SSE 分包', () => {
    it('数据在任意字节处断开时仍应正确解析', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockChunkedSSEResponse(makeStreamTextChunks(), 15)
      );

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        model: '',
        messages: [{ role: 'user', content: 'test' }],
      })) {
        if (chunk.type === 'text_delta' && chunk.content) {
          chunks.push(chunk.content);
        }
      }

      expect(chunks).toEqual(['你', '好', '！']);
    });
  });

  // ----------------------------------------------------------
  // 8. 流式错误处理
  // ----------------------------------------------------------

  describe('stream() - 错误处理', () => {
    it('API 返回非 200 时应抛出错误', async () => {
      fetchSpy.mockResolvedValueOnce(mockErrorResponse('Rate limited', 429));

      await expect(async () => {
        for await (const _ of provider.stream({
          model: '',
          messages: [{ role: 'user', content: 'test' }],
        })) {
          // consume
        }
      }).rejects.toThrow('OpenAI API error (429)');
    });
  });
});
