/**
 * VectorStore -- 向量存储与语义搜索
 * 纯 TypeScript 实现的内存向量数据库
 */

import type { Vector } from './vector-math.js';
import { cosineSimilarity, normalize } from './vector-math.js';
import type { Embedder } from './embedder.js';

// ============================================================
// 向量存储条目
// ============================================================

export interface VectorEntry {
  id: string;
  content: string;
  vector: Vector;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number;
}

export interface VectorStoreOptions {
  /** Embedding 提供者 */
  embedder: Embedder;

  /** 是否在存储时归一化向量（加速搜索） */
  normalizeVectors?: boolean;
}

// ============================================================
// VectorStore 实现
// ============================================================

let storeCounter = 0;

export class VectorStore {
  private embedder: Embedder;
  private entries: Map<string, VectorEntry> = new Map();
  private normalizeOnStore: boolean;

  constructor(options: VectorStoreOptions) {
    this.embedder = options.embedder;
    this.normalizeOnStore = options.normalizeVectors ?? true;
  }

  /** 添加单条文本 */
  async add(content: string, metadata: Record<string, unknown> = {}): Promise<VectorEntry> {
    const vector = await this.embedder.embed(content);
    return this.addWithVector(content, vector, metadata);
  }

  /** 批量添加文本 */
  async addBatch(
    items: Array<{ content: string; metadata?: Record<string, unknown> }>
  ): Promise<VectorEntry[]> {
    const texts = items.map((i) => i.content);
    const vectors = await this.embedder.embedBatch(texts);

    return items.map((item, i) =>
      this.addWithVector(item.content, vectors[i]!, item.metadata ?? {})
    );
  }

  /** 直接添加带向量的条目（跳过 embedding） */
  addWithVector(
    content: string,
    vector: Vector,
    metadata: Record<string, unknown> = {}
  ): VectorEntry {
    const id = `vec_${Date.now()}_${++storeCounter}`;
    const storedVector = this.normalizeOnStore ? normalize(vector) : vector;

    const entry: VectorEntry = {
      id,
      content,
      vector: storedVector,
      metadata,
      createdAt: Date.now(),
    };

    this.entries.set(id, entry);
    return entry;
  }

  /**
   * 语义搜索 -- RAG 的核心
   * @param query 查询文本
   * @param topK 返回前 K 个最相似的结果
   * @param minScore 最低相似度阈值（过滤噪音）
   */
  async search(query: string, topK: number = 5, minScore: number = 0): Promise<SearchResult[]> {
    let queryVector = await this.embedder.embed(query);

    if (this.normalizeOnStore) {
      queryVector = normalize(queryVector);
    }

    return this.searchByVector(queryVector, topK, minScore);
  }

  /** 直接用向量搜索 */
  searchByVector(queryVector: Vector, topK: number = 5, minScore: number = 0): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      const score = cosineSimilarity(queryVector, entry.vector);
      if (score >= minScore) {
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** 获取条目 */
  get(id: string): VectorEntry | null {
    return this.entries.get(id) ?? null;
  }

  /** 删除条目 */
  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /** 清空 */
  clear(): void {
    this.entries.clear();
  }

  /** 条目数 */
  size(): number {
    return this.entries.size;
  }

  /** 列出全部条目（不含向量，减少内存） */
  list(): Array<{ id: string; content: string; metadata: Record<string, unknown> }> {
    return Array.from(this.entries.values()).map(({ id, content, metadata }) => ({
      id,
      content,
      metadata,
    }));
  }
}
