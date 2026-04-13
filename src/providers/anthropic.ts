/**
 * Anthropic Provider
 * 手写实现，直接调用 Anthropic Messages API
 * 注意：Anthropic 的 API 格式与 OpenAI 有显著差异
 */

import type {
  ChatRequest,
  ChatResponse,
  Message,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from '../types.js';
import { LLMProvider, type LLMProviderOptions } from './base.js';

// ============================================================
// Anthropic API 原始类型
// 参考: https://docs.anthropic.com/en/api/messages
// ============================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
  max_tokens: number;
  temperature?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// 流式事件类型
type AnthropicStreamEvent =
  | { type: 'message_start'; message: AnthropicResponse }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: AnthropicDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'ping' };

type AnthropicDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string };

// ============================================================
// Provider 实现
// ============================================================

export class AnthropicProvider extends LLMProvider {
  constructor(options?: Partial<LLMProviderOptions>) {
    super({
      apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      baseUrl: options?.baseUrl ?? 'https://api.anthropic.com',
      defaultModel: options?.defaultModel ?? 'claude-sonnet-4-20250514',
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = this.buildRequestBody(request, false);
    const response = await this.fetchAPI('/v1/messages', body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return this.parseResponse(data);
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(request, true);
    const response = await this.fetchAPI('/v1/messages', body);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    yield* this.parseSSEStream(response);
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async fetchAPI(
    path: string,
    body: AnthropicRequest
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Anthropic 与 OpenAI 的关键差异:
   * 1. system 消息是独立字段，不在 messages 数组中
   * 2. tool_calls 不是消息属性，而是 content block
   * 3. tool_result 是 user 消息中的 content block
   */
  private buildRequestBody(
    request: ChatRequest,
    stream: boolean
  ): AnthropicRequest {
    let systemPrompt: string | undefined;
    const messages: AnthropicMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
        continue;
      }
      const converted = this.toAnthropicMessage(msg);
      if (converted) messages.push(converted);
    }

    // Anthropic 要求消息必须以 user 角色开始，且 user/assistant 交替
    const mergedMessages = this.mergeConsecutiveMessages(messages);

    const body: AnthropicRequest = {
      model: this.resolveModel(request),
      messages: mergedMessages,
      max_tokens: request.maxTokens ?? 4096,
      stream,
    };

    if (systemPrompt) body.system = systemPrompt;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => this.toAnthropicTool(t));
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.stop) {
      body.stop_sequences = request.stop;
    }

    return body;
  }

  private toAnthropicMessage(msg: Message): AnthropicMessage | null {
    switch (msg.role) {
      case 'system':
        return null;
      case 'user':
        return { role: 'user', content: msg.content };
      case 'assistant': {
        const blocks: AnthropicContentBlock[] = [];
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }
        }
        return { role: 'assistant', content: blocks.length > 0 ? blocks : '' };
      }
      case 'tool':
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: msg.content,
            },
          ],
        };
    }
  }

  private toAnthropicTool(tool: ToolDefinition): AnthropicTool {
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    };
  }

  /**
   * Anthropic 要求同角色消息不能连续出现
   * 需要将连续的同角色消息合并为一条
   */
  private mergeConsecutiveMessages(
    messages: AnthropicMessage[]
  ): AnthropicMessage[] {
    const merged: AnthropicMessage[] = [];

    for (const msg of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        const lastBlocks = this.toContentBlocks(last.content);
        const currBlocks = this.toContentBlocks(msg.content);
        last.content = [...lastBlocks, ...currBlocks];
      } else {
        merged.push({ ...msg });
      }
    }

    return merged;
  }

  private toContentBlocks(
    content: string | AnthropicContentBlock[]
  ): AnthropicContentBlock[] {
    if (typeof content === 'string') {
      return content ? [{ type: 'text', text: content }] : [];
    }
    return content;
  }

  private parseResponse(data: AnthropicResponse): ChatResponse {
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      id: data.id,
      content: textContent || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      finishReason: this.mapStopReason(data.stop_reason),
    };
  }

  private async *parseSSEStream(
    response: Response
  ): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    // 累积工具调用数据
    const toolBlocks = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;
            yield* this.processStreamEvent(
              event,
              toolBlocks,
              { inputTokens, outputTokens },
              (v) => { inputTokens = v.inputTokens; outputTokens = v.outputTokens; }
            );
          } catch {
            // skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private *processStreamEvent(
    event: AnthropicStreamEvent,
    toolBlocks: Map<number, { id: string; name: string; arguments: string }>,
    tokens: { inputTokens: number; outputTokens: number },
    setTokens: (v: { inputTokens: number; outputTokens: number }) => void
  ): Iterable<StreamChunk> {
    switch (event.type) {
      case 'message_start':
        if (event.message.usage) {
          setTokens({
            inputTokens: event.message.usage.input_tokens,
            outputTokens: tokens.outputTokens,
          });
        }
        break;

      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          toolBlocks.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            arguments: '',
          });
        }
        break;

      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', content: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          const block = toolBlocks.get(event.index);
          if (block) {
            block.arguments += event.delta.partial_json;
            yield {
              type: 'tool_call_delta',
              toolCall: {
                id: block.id,
                function: { name: block.name, arguments: block.arguments },
              },
            };
          }
        }
        break;

      case 'message_delta':
        if (event.usage) {
          setTokens({
            inputTokens: tokens.inputTokens,
            outputTokens: event.usage.output_tokens,
          });
          yield {
            type: 'usage',
            usage: {
              promptTokens: tokens.inputTokens,
              completionTokens: event.usage.output_tokens,
              totalTokens: tokens.inputTokens + event.usage.output_tokens,
            },
          };
        }
        break;

      case 'message_stop':
        yield { type: 'done' };
        break;
    }
  }

  private mapStopReason(
    reason: string
  ): ChatResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      default:
        return 'error';
    }
  }
}
