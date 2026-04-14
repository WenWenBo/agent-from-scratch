/**
 * 文本分块器（Text Chunker）
 * 将长文档拆分为适合 Embedding 的小段
 *
 * 为什么需要分块？
 * - Embedding 模型对短文本效果更好（<512 tokens 最佳）
 * - 长文本的 Embedding 会"稀释"语义
 * - 检索时需要定位到具体段落，而非整篇文档
 */

// ============================================================
// 文档块
// ============================================================

export interface DocumentChunk {
  /** 块内容 */
  content: string;

  /** 块索引 */
  index: number;

  /** 来源文档元数据 */
  metadata: Record<string, unknown>;
}

// ============================================================
// 分块策略接口
// ============================================================

export interface ChunkStrategy {
  readonly name: string;
  chunk(text: string, metadata?: Record<string, unknown>): DocumentChunk[];
}

// ============================================================
// 1. 固定大小分块（带重叠）
// ============================================================

export interface FixedSizeChunkerOptions {
  /** 每块的最大字符数，默认 500 */
  chunkSize?: number;

  /** 块之间的重叠字符数，默认 50 */
  overlap?: number;
}

export class FixedSizeChunker implements ChunkStrategy {
  readonly name = 'fixed_size';
  private chunkSize: number;
  private overlap: number;

  constructor(options: FixedSizeChunkerOptions = {}) {
    this.chunkSize = options.chunkSize ?? 500;
    this.overlap = options.overlap ?? 50;
  }

  chunk(text: string, metadata: Record<string, unknown> = {}): DocumentChunk[] {
    if (!text.trim()) return [];

    const chunks: DocumentChunk[] = [];
    let start = 0;
    let index = 0;

    while (start < text.length) {
      const end = Math.min(start + this.chunkSize, text.length);
      const content = text.slice(start, end).trim();

      if (content) {
        chunks.push({ content, index, metadata: { ...metadata, chunkIndex: index } });
        index++;
      }

      // 下一块的起始位置 = 当前起始 + chunkSize - overlap
      start += this.chunkSize - this.overlap;

      // 防止无限循环
      if (this.chunkSize <= this.overlap) {
        start = end;
      }
    }

    return chunks;
  }
}

// ============================================================
// 2. 按段落分块（语义更完整）
// ============================================================

export interface ParagraphChunkerOptions {
  /** 每块的最大字符数，默认 800 */
  maxChunkSize?: number;

  /** 段落分隔符，默认连续换行 */
  separator?: RegExp;
}

export class ParagraphChunker implements ChunkStrategy {
  readonly name = 'paragraph';
  private maxChunkSize: number;
  private separator: RegExp;

  constructor(options: ParagraphChunkerOptions = {}) {
    this.maxChunkSize = options.maxChunkSize ?? 800;
    this.separator = options.separator ?? /\n\s*\n/;
  }

  chunk(text: string, metadata: Record<string, unknown> = {}): DocumentChunk[] {
    if (!text.trim()) return [];

    const paragraphs = text.split(this.separator).filter((p) => p.trim());
    const chunks: DocumentChunk[] = [];
    let current = '';
    let index = 0;

    for (const para of paragraphs) {
      const trimmed = para.trim();

      // 单段超长：切为固定大小子块
      if (trimmed.length > this.maxChunkSize) {
        if (current.trim()) {
          chunks.push({ content: current.trim(), index, metadata: { ...metadata, chunkIndex: index } });
          index++;
          current = '';
        }

        const subChunker = new FixedSizeChunker({ chunkSize: this.maxChunkSize, overlap: 50 });
        const subChunks = subChunker.chunk(trimmed, metadata);
        for (const sc of subChunks) {
          chunks.push({ content: sc.content, index, metadata: { ...metadata, chunkIndex: index } });
          index++;
        }
        continue;
      }

      // 累加段落直到超过最大块大小
      if (current.length + trimmed.length + 2 > this.maxChunkSize) {
        if (current.trim()) {
          chunks.push({ content: current.trim(), index, metadata: { ...metadata, chunkIndex: index } });
          index++;
        }
        current = trimmed;
      } else {
        current = current ? `${current}\n\n${trimmed}` : trimmed;
      }
    }

    if (current.trim()) {
      chunks.push({ content: current.trim(), index, metadata: { ...metadata, chunkIndex: index } });
    }

    return chunks;
  }
}

// ============================================================
// 3. 按 Markdown 标题分块
// ============================================================

export class MarkdownChunker implements ChunkStrategy {
  readonly name = 'markdown';

  private maxChunkSize: number;

  constructor(maxChunkSize: number = 1000) {
    this.maxChunkSize = maxChunkSize;
  }

  chunk(text: string, metadata: Record<string, unknown> = {}): DocumentChunk[] {
    if (!text.trim()) return [];

    // 按标题行分割
    const sections = text.split(/(?=^#{1,6}\s)/m);
    const chunks: DocumentChunk[] = [];
    let index = 0;

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      // 提取标题
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
      const heading = headingMatch ? headingMatch[2]!.trim() : undefined;
      const level = headingMatch ? headingMatch[1]!.length : 0;

      if (trimmed.length <= this.maxChunkSize) {
        chunks.push({
          content: trimmed,
          index,
          metadata: { ...metadata, chunkIndex: index, heading, headingLevel: level },
        });
        index++;
      } else {
        // 超长 section 用段落分块器处理
        const subChunker = new ParagraphChunker({ maxChunkSize: this.maxChunkSize });
        const subChunks = subChunker.chunk(trimmed, metadata);
        for (const sc of subChunks) {
          chunks.push({
            content: sc.content,
            index,
            metadata: { ...sc.metadata, heading, headingLevel: level },
          });
          index++;
        }
      }
    }

    return chunks;
  }
}
