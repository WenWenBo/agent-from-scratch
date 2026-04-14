/**
 * RAG Pipeline -- 检索增强生成
 * 将 VectorStore 的检索结果注入 Agent 的上下文中
 *
 * 流程：Query → Retrieve → Augment → Generate
 */

import type { Message } from '../types.js';
import type { VectorStore, SearchResult } from './vector-store.js';
import type { ChunkStrategy, DocumentChunk } from './chunker.js';

// ============================================================
// RAG Pipeline 配置
// ============================================================

export interface RAGPipelineOptions {
  /** 向量存储 */
  vectorStore: VectorStore;

  /** 检索的文档块数量，默认 3 */
  topK?: number;

  /** 最低相似度阈值，默认 0.3 */
  minScore?: number;

  /** 上下文模板 -- 控制检索结果如何注入 prompt */
  contextTemplate?: (chunks: SearchResult[]) => string;
}

export class RAGPipeline {
  private vectorStore: VectorStore;
  private topK: number;
  private minScore: number;
  private contextTemplate: (chunks: SearchResult[]) => string;

  constructor(options: RAGPipelineOptions) {
    this.vectorStore = options.vectorStore;
    this.topK = options.topK ?? 3;
    this.minScore = options.minScore ?? 0.3;
    this.contextTemplate = options.contextTemplate ?? defaultContextTemplate;
  }

  // ============================================================
  // 文档索引
  // ============================================================

  /** 索引单段文本 */
  async indexText(text: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.vectorStore.add(text, metadata);
  }

  /** 使用分块策略索引长文档 */
  async indexDocument(
    text: string,
    chunker: ChunkStrategy,
    metadata: Record<string, unknown> = {}
  ): Promise<DocumentChunk[]> {
    const chunks = chunker.chunk(text, metadata);

    if (chunks.length > 0) {
      await this.vectorStore.addBatch(
        chunks.map((c) => ({
          content: c.content,
          metadata: c.metadata,
        }))
      );
    }

    return chunks;
  }

  /** 批量索引多段文本 */
  async indexTexts(
    items: Array<{ content: string; metadata?: Record<string, unknown> }>
  ): Promise<void> {
    await this.vectorStore.addBatch(items);
  }

  // ============================================================
  // 检索
  // ============================================================

  /** 搜索相关文档块 */
  async retrieve(query: string): Promise<SearchResult[]> {
    return this.vectorStore.search(query, this.topK, this.minScore);
  }

  // ============================================================
  // 增强（Augment）
  // ============================================================

  /**
   * 将检索结果增强到消息列表中
   * 在 system 消息后注入检索到的上下文
   */
  async augment(query: string, messages: Message[]): Promise<Message[]> {
    const results = await this.retrieve(query);

    if (results.length === 0) {
      return messages;
    }

    const contextText = this.contextTemplate(results);

    // 找到 system 消息并增强
    const augmented = [...messages];
    const systemIdx = augmented.findIndex((m) => m.role === 'system');

    if (systemIdx >= 0) {
      const sys = augmented[systemIdx]!;
      if (sys.role === 'system') {
        augmented[systemIdx] = {
          role: 'system',
          content: `${sys.content}\n\n${contextText}`,
        };
      }
    } else {
      // 没有 system 消息，创建一个
      augmented.unshift({
        role: 'system',
        content: contextText,
      });
    }

    return augmented;
  }

  // ============================================================
  // 完整 RAG 流程（供外部调用）
  // ============================================================

  /**
   * Query → Retrieve → 返回格式化的上下文文本
   */
  async getContext(query: string): Promise<string> {
    const results = await this.retrieve(query);
    if (results.length === 0) return '';
    return this.contextTemplate(results);
  }

  /** 获取底层 VectorStore */
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }
}

// ============================================================
// 默认上下文模板
// ============================================================

function defaultContextTemplate(chunks: SearchResult[]): string {
  const lines = chunks.map((r, i) => {
    const score = (r.score * 100).toFixed(1);
    return `[${i + 1}] (relevance: ${score}%)\n${r.entry.content}`;
  });

  return `[Retrieved Context]\nThe following information was retrieved from the knowledge base. Use it to answer the user's question.\n\n${lines.join('\n\n')}`;
}
