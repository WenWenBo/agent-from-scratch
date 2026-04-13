/**
 * LLM Provider 抽象基类
 * 定义所有 Provider 必须实现的接口契约
 */

import type {
  ChatRequest,
  ChatResponse,
  StreamChunk,
} from '../types.js';

export interface LLMProviderOptions {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

export abstract class LLMProvider {
  protected apiKey: string;
  protected baseUrl: string;
  protected defaultModel: string;

  constructor(options: LLMProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.defaultModel = options.defaultModel;
  }

  abstract chat(request: ChatRequest): Promise<ChatResponse>;

  abstract stream(
    request: ChatRequest
  ): AsyncIterable<StreamChunk>;

  protected resolveModel(request: ChatRequest): string {
    return request.model || this.defaultModel;
  }
}
