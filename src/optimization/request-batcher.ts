/**
 * Request Batcher -- 请求批量合并
 *
 * 将短时间内到达的多个 LLM 请求合并为更少的调用。
 * 适用场景：
 * 1. Multi-Agent 并行时，多个 Agent 同时需要 LLM
 * 2. 评估阶段大量相似请求
 * 3. 高并发 API 服务
 *
 * 策略：
 * - 时间窗口内收集请求
 * - 去重（相同请求只调用一次）
 * - 并发控制（限制同时进行的 LLM 调用数）
 *
 * 参考:
 * - OpenAI Batch API: https://platform.openai.com/docs/guides/batch
 */

import type { ChatRequest, ChatResponse } from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import { LLMCache } from './cache.js';

// ============================================================
// 配置
// ============================================================

export interface RequestBatcherOptions {
  provider: LLMProvider;
  /** 最大并发 LLM 调用数，默认 3 */
  maxConcurrency?: number;
  /** 是否启用去重缓存，默认 true */
  deduplication?: boolean;
  /** 去重缓存 TTL（ms），默认 60000 */
  cacheTtlMs?: number;
}

// ============================================================
// 排队任务
// ============================================================

interface QueuedRequest {
  request: ChatRequest;
  resolve: (response: ChatResponse) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

// ============================================================
// RequestBatcher
// ============================================================

export class RequestBatcher {
  private provider: LLMProvider;
  private maxConcurrency: number;
  private queue: QueuedRequest[] = [];
  private activeCount = 0;
  private cache: LLMCache | undefined;

  private _totalRequests = 0;
  private _deduplicated = 0;
  private _completed = 0;
  private _failed = 0;

  constructor(options: RequestBatcherOptions) {
    this.provider = options.provider;
    this.maxConcurrency = options.maxConcurrency ?? 3;

    if (options.deduplication !== false) {
      this.cache = new LLMCache({
        ttlMs: options.cacheTtlMs ?? 60000,
        maxSize: 50,
      });
    }
  }

  // ============================================================
  // 提交请求
  // ============================================================

  async submit(request: ChatRequest): Promise<ChatResponse> {
    this._totalRequests++;

    // 检查去重缓存
    if (this.cache) {
      const cached = this.cache.get(request);
      if (cached) {
        this._deduplicated++;
        return cached;
      }
    }

    return new Promise<ChatResponse>((resolve, reject) => {
      this.queue.push({
        request,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      });
      this.processQueue();
    });
  }

  /**
   * 批量提交多个请求
   */
  async submitBatch(requests: ChatRequest[]): Promise<ChatResponse[]> {
    return Promise.all(requests.map((r) => this.submit(r)));
  }

  // ============================================================
  // 队列处理
  // ============================================================

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrency) {
      const item = this.queue.shift()!;
      this.activeCount++;

      this.executeRequest(item).finally(() => {
        this.activeCount--;
        this.processQueue();
      });
    }
  }

  private async executeRequest(item: QueuedRequest): Promise<void> {
    try {
      const response = await this.provider.chat(item.request);
      this._completed++;

      if (this.cache) {
        this.cache.set(item.request, response);
      }

      item.resolve(response);
    } catch (err) {
      this._failed++;
      item.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ============================================================
  // 统计
  // ============================================================

  get pendingCount(): number {
    return this.queue.length;
  }

  get activeRequestCount(): number {
    return this.activeCount;
  }

  getStats() {
    return {
      totalRequests: this._totalRequests,
      completed: this._completed,
      failed: this._failed,
      deduplicated: this._deduplicated,
      pending: this.queue.length,
      active: this.activeCount,
      cacheStats: this.cache?.getStats(),
    };
  }

  reset(): void {
    this._totalRequests = 0;
    this._deduplicated = 0;
    this._completed = 0;
    this._failed = 0;
    this.cache?.clear();
  }
}
