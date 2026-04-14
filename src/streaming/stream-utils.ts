/**
 * 流式处理工具函数
 * 将 Provider 的 StreamChunk 收集、累积为完整的 ChatResponse
 */

import type {
  StreamChunk,
  ChatResponse,
  ToolCall,
  TokenUsage,
} from '../types.js';

// ============================================================
// StreamCollector -- 将流式 chunk 累积为完整响应
// ============================================================

export class StreamCollector {
  private content = '';
  private toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
  private usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private finishReason: ChatResponse['finishReason'] = 'stop';

  /** 处理一个 chunk */
  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'text_delta':
        this.content += chunk.content ?? '';
        break;

      case 'tool_call_delta':
        if (chunk.toolCall) {
          this.mergeToolCallDelta(chunk.toolCall);
        }
        break;

      case 'usage':
        if (chunk.usage) {
          this.usage = chunk.usage;
        }
        break;

      case 'done':
        if (this.toolCalls.size > 0) {
          this.finishReason = 'tool_calls';
        }
        break;
    }
  }

  /** 获取累积的完整响应 */
  getResponse(): ChatResponse {
    const toolCalls: ToolCall[] | undefined =
      this.toolCalls.size > 0
        ? Array.from(this.toolCalls.entries())
            .sort(([a], [b]) => a - b)
            .map(([_, tc]) => ({
              id: tc.id,
              function: { name: tc.name, arguments: tc.arguments },
            }))
        : undefined;

    return {
      id: '',
      content: this.content || null,
      toolCalls,
      usage: this.usage,
      finishReason: toolCalls ? 'tool_calls' : this.finishReason,
    };
  }

  private mergeToolCallDelta(delta: Partial<ToolCall>): void {
    // Provider 层已经累积了 name 和 arguments，每次 delta 是累积值
    // 这里用覆盖（而非追加）来避免双重累积
    const existing = delta.id ? this.findByIdOrCreate(delta.id) : this.getLatestOrCreate();

    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name = delta.function.name;
    if (delta.function?.arguments) existing.arguments = delta.function.arguments;
  }

  private findByIdOrCreate(id: string): { id: string; name: string; arguments: string } {
    for (const tc of this.toolCalls.values()) {
      if (tc.id === id) return tc;
    }
    const idx = this.toolCalls.size;
    this.toolCalls.set(idx, { id, name: '', arguments: '' });
    return this.toolCalls.get(idx)!;
  }

  private getLatestOrCreate(): { id: string; name: string; arguments: string } {
    const idx = Math.max(0, this.toolCalls.size - 1);
    if (!this.toolCalls.has(idx)) {
      this.toolCalls.set(idx, { id: '', name: '', arguments: '' });
    }
    return this.toolCalls.get(idx)!;
  }
}

// ============================================================
// 便捷函数：收集整个 stream 为 ChatResponse
// ============================================================

export async function collectStream(
  stream: AsyncIterable<StreamChunk>
): Promise<ChatResponse> {
  const collector = new StreamCollector();
  for await (const chunk of stream) {
    collector.push(chunk);
  }
  return collector.getResponse();
}

// ============================================================
// 便捷函数：从 stream 中提取纯文本
// ============================================================

export async function streamToText(
  stream: AsyncIterable<StreamChunk>
): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    if (chunk.type === 'text_delta' && chunk.content) {
      text += chunk.content;
    }
  }
  return text;
}
