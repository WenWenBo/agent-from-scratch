/**
 * Embedding Provider -- 将文本转换为向量
 *
 * 两个实现：
 * 1. OpenAIEmbedder -- 调用 OpenAI Embedding API
 * 2. SimpleEmbedder -- 纯本地的词频向量（用于测试和理解原理）
 */

import type { Vector } from './vector-math.js';

// ============================================================
// Embedder 接口
// ============================================================

export interface Embedder {
  readonly name: string;

  /** 将单段文本转换为向量 */
  embed(text: string): Promise<Vector>;

  /** 批量 embedding（更高效） */
  embedBatch(texts: string[]): Promise<Vector[]>;

  /** 返回向量维度 */
  getDimension(): number;
}

// ============================================================
// 1. OpenAIEmbedder -- 调用 OpenAI Embedding API
// ============================================================

export interface OpenAIEmbedderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAIEmbedder implements Embedder {
  readonly name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private dimension: number;

  constructor(options: OpenAIEmbedderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = options.model ?? 'text-embedding-3-small';
    // text-embedding-3-small: 1536, text-embedding-3-large: 3072, text-embedding-ada-002: 1536
    this.dimension = this.model.includes('large') ? 3072 : 1536;
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(text: string): Promise<Vector> {
    const result = await this.embedBatch([text]);
    return result[0]!;
  }

  async embedBatch(texts: string[]): Promise<Vector[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
      error?: { message: string };
    };

    if (!data.data || !Array.isArray(data.data)) {
      const msg = data.error?.message ?? JSON.stringify(data);
      throw new Error(`Embedding API returned invalid data: ${msg}`);
    }

    // 按 index 排序确保顺序正确
    const sorted = [...data.data].sort((a, b) => a.index - b.index);

    // 更新维度信息
    if (sorted.length > 0) {
      this.dimension = sorted[0]!.embedding.length;
    }

    return sorted.map((d) => d.embedding);
  }
}

// ============================================================
// 2. SimpleEmbedder -- 基于词频的本地 Embedding（教学用）
// ============================================================

/**
 * 纯本地的 Embedding 实现，不需要 API
 * 使用 Bag-of-Words + TF 权重，生成稀疏向量后降维
 *
 * 适合：测试、理解 Embedding 原理、离线场景
 * 不适合：生产级语义搜索（精度远低于神经网络 Embedding）
 */
export class SimpleEmbedder implements Embedder {
  readonly name = 'simple';
  private dimension: number;
  private vocabulary: Map<string, number> = new Map();
  private vocabIndex = 0;

  constructor(dimension: number = 128) {
    this.dimension = dimension;
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(text: string): Promise<Vector> {
    const tokens = this.tokenize(text);
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    // 构建稠密向量（通过哈希降维）
    const vector = new Array<number>(this.dimension).fill(0);

    for (const [term, freq] of termFreq) {
      // 确保词汇被索引
      if (!this.vocabulary.has(term)) {
        this.vocabulary.set(term, this.vocabIndex++);
      }

      // 使用多个哈希位置分散到向量中（类似 feature hashing）
      const hashes = this.multiHash(term, 3);
      for (const h of hashes) {
        const idx = Math.abs(h) % this.dimension;
        const sign = h >= 0 ? 1 : -1;
        vector[idx]! += sign * (freq / tokens.length);
      }
    }

    // L2 归一化
    const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (mag > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i]! /= mag;
      }
    }

    return vector;
  }

  async embedBatch(texts: string[]): Promise<Vector[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  /**
   * 简单的多哈希函数
   * 用不同种子生成多个哈希值，减少碰撞
   */
  private multiHash(str: string, count: number): number[] {
    const hashes: number[] = [];
    for (let seed = 0; seed < count; seed++) {
      let hash = seed * 2654435761; // Knuth's multiplicative hash
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
      }
      hashes.push(hash);
    }
    return hashes;
  }
}
