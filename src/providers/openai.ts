/**
 * OpenAI Provider
 * 手写实现，不依赖官方 SDK，直接调用 REST API
 * 兼容所有 OpenAI API 格式的服务（OpenAI、DeepSeek、本地 Ollama 等）
 */

import type {
  ChatRequest,
  ChatResponse,
  Message,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  TokenUsage,
} from '../types.js';
import { LLMProvider, type LLMProviderOptions } from './base.js';

// ============================================================
// OpenAI API 的原始请求/响应类型（与官方 API 文档 1:1 对应）
// ============================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string[];
  stream?: boolean;
}

interface OpenAIChatResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
      /** 推理模型（o1/o3/kimi-k2.5 等）的思考过程 */
      reasoning?: string | null;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  choices: Array<{
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================
// Provider 实现
// ============================================================

export class OpenAIProvider extends LLMProvider {
  constructor(options?: Partial<LLMProviderOptions>) {
    super({
      apiKey: options?.apiKey ?? process.env.OPENAI_API_KEY ?? '',
      baseUrl: options?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      defaultModel: options?.defaultModel ?? process.env.OPENAI_MODEL ?? 'gpt-4o',
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = this.buildRequestBody(request, false);
    const response = await this.fetchAPI('/chat/completions', body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as Record<string, any>;

    // 兼容某些代理/网关返回 200 但 body 中含错误信息的情况
    if (!data.choices) {
      const msg = data.message ?? data.error?.message ?? JSON.stringify(data);
      throw new Error(`OpenAI API returned invalid response: ${msg}`);
    }

    return this.parseChatResponse(data as OpenAIChatResponse);
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(request, true);
    const response = await this.fetchAPI('/chat/completions', body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    // 某些代理/网关可能返回 200 + JSON 错误体而非 SSE 流
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') && !response.body) {
      const text = await response.text();
      throw new Error(`OpenAI API returned non-stream response: ${text}`);
    }

    yield* this.parseSSEStream(response);
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async fetchAPI(
    path: string,
    body: OpenAIChatRequest
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * 将 TinyAgent 统一消息格式转换为 OpenAI API 格式
   * 这是 Provider 层的核心职责：格式适配
   */
  private buildRequestBody(
    request: ChatRequest,
    stream: boolean
  ): OpenAIChatRequest {
    const body: OpenAIChatRequest = {
      model: this.resolveModel(request),
      messages: request.messages.map((msg) => this.toOpenAIMessage(msg)),
      stream,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => this.toOpenAITool(t));
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      if (this.useMaxCompletionTokens(body.model)) {
        body.max_completion_tokens = request.maxTokens;
      } else {
        body.max_tokens = request.maxTokens;
      }
    }
    if (request.stop) {
      body.stop = request.stop;
    }

    return body;
  }

  private toOpenAIMessage(msg: Message): OpenAIMessage {
    switch (msg.role) {
      case 'system':
        return { role: 'system', content: msg.content };
      case 'user':
        return { role: 'user', content: msg.content };
      case 'assistant':
        return {
          role: 'assistant',
          content: msg.content,
          ...(msg.toolCalls && {
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: tc.function,
            })),
          }),
        };
      case 'tool':
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId,
        };
    }
  }

  private toOpenAITool(tool: ToolDefinition): OpenAITool {
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    };
  }

  private parseChatResponse(data: OpenAIChatResponse): ChatResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('OpenAI returned empty choices');
    }

    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map(
      (tc) => ({
        id: tc.id,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })
    );

    return {
      id: data.id,
      content: choice.message.content,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  /**
   * 手动解析 SSE（Server-Sent Events）流
   * SSE 协议格式: 每行以 "data: " 开头，消息之间用空行分隔
   */
  private async *parseSSEStream(
    response: Response
  ): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    // 用于累积流式 tool_call 的数据
    const toolCallAccumulator = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const chunk = JSON.parse(data) as OpenAIStreamChunk;
            yield* this.processStreamChunk(chunk, toolCallAccumulator);
          } catch {
            // skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private *processStreamChunk(
    chunk: OpenAIStreamChunk,
    toolCallAccumulator: Map<
      number,
      { id: string; name: string; arguments: string }
    >
  ): Iterable<StreamChunk> {
    const choice = chunk.choices[0];

    if (chunk.usage) {
      yield {
        type: 'usage',
        usage: {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        },
      };
    }

    if (!choice) return;

    if (choice.delta.content) {
      yield { type: 'text_delta', content: choice.delta.content };
    }

    if (choice.delta.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        let acc = toolCallAccumulator.get(tc.index);
        if (!acc) {
          acc = { id: tc.id ?? '', name: '', arguments: '' };
          toolCallAccumulator.set(tc.index, acc);
        }
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;

        yield {
          type: 'tool_call_delta',
          toolCall: {
            id: acc.id,
            function: {
              name: acc.name,
              arguments: acc.arguments,
            },
          },
        };
      }
    }

    if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
      yield { type: 'done' };
    }
  }

  private mapFinishReason(
    reason: string
  ): ChatResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      default:
        return 'error';
    }
  }

  /**
   * GPT-5 系列及 o1/o3 等推理模型不支持旧版 max_tokens 参数，
   * 需要使用 max_completion_tokens 替代。
   * 参考: https://platform.openai.com/docs/api-reference/chat/create
   */
  private useMaxCompletionTokens(model: string): boolean {
    const newParamModels = ['o1', 'o3', 'o4', 'gpt-5', 'chatgpt-4o-latest', 'kimi-k2'];
    return newParamModels.some((prefix) => model.startsWith(prefix));
  }
}
