/**
 * LLM Response Cache -- LLM 响应缓存
 *
 * 相同的输入（messages + model + tools）命中缓存时直接返回，
 * 避免重复 LLM 调用，大幅降低延迟和成本。
 *
 * 策略：
 * 1. 精确匹配：messages 完全相同
 * 2. TTL 过期：缓存条目自动过期
 * 3. LRU 淘汰：超过容量时淘汰最久未访问的条目
 * 4. 语义缓存（可扩展）：相似问题命中缓存
 *
 * 参考:
 * - GPTCache: https://github.com/zilliztech/GPTCache
 * - OpenAI Prompt Caching: https://platform.openai.com/docs/guides/prompt-caching
 */

import type { ChatRequest, ChatResponse } from '../types.js';
import * as crypto from 'node:crypto';

// ============================================================
// 缓存条目
// ============================================================

interface CacheEntry {
  key: string;
  response: ChatResponse;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
}

// ============================================================
// 配置
// ============================================================

export interface LLMCacheOptions {
  /** 最大缓存条目数，默认 100 */
  maxSize?: number;
  /** TTL（毫秒），默认 5 分钟 */
  ttlMs?: number;
  /** 是否启用，默认 true */
  enabled?: boolean;
}

// ============================================================
// LLMCache
// ============================================================

export class LLMCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private ttlMs: number;
  private enabled: boolean;

  private _hits = 0;
  private _misses = 0;

  constructor(options: LLMCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.enabled = options.enabled ?? true;
  }

  // ============================================================
  // 核心操作
  // ============================================================

  get(request: ChatRequest): ChatResponse | undefined {
    if (!this.enabled) return undefined;

    const key = this.buildKey(request);
    const entry = this.cache.get(key);

    if (!entry) {
      this._misses++;
      return undefined;
    }

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this._misses++;
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    entry.accessCount++;
    this._hits++;

    return entry.response;
  }

  set(request: ChatRequest, response: ChatResponse): void {
    if (!this.enabled) return;

    const key = this.buildKey(request);

    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      key,
      response,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
    });
  }

  has(request: ChatRequest): boolean {
    if (!this.enabled) return false;
    const key = this.buildKey(request);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  invalidate(request: ChatRequest): boolean {
    const key = this.buildKey(request);
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  // ============================================================
  // 统计
  // ============================================================

  get hits(): number { return this._hits; }
  get misses(): number { return this._misses; }
  get size(): number { return this.cache.size; }

  get hitRate(): number {
    const total = this._hits + this._misses;
    return total > 0 ? this._hits / total : 0;
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: this.hitRate,
      ttlMs: this.ttlMs,
    };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  buildKey(request: ChatRequest): string {
    const keyData = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: 'content' in m ? m.content : undefined,
        toolCallId: 'toolCallId' in m ? m.toolCallId : undefined,
      })),
      tools: request.tools?.map((t) => t.function.name).sort(),
      temperature: request.temperature,
    };
    const json = JSON.stringify(keyData);
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
