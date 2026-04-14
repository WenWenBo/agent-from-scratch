/**
 * 文本分块器单元测试
 */

import { describe, it, expect } from 'vitest';
import { FixedSizeChunker, ParagraphChunker, MarkdownChunker } from '../chunker.js';

// ============================================================
// FixedSizeChunker
// ============================================================

describe('FixedSizeChunker', () => {
  it('短文本不应分块', () => {
    const chunker = new FixedSizeChunker({ chunkSize: 100 });
    const chunks = chunker.chunk('Hello world');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('Hello world');
    expect(chunks[0]!.index).toBe(0);
  });

  it('长文本应正确分块', () => {
    const chunker = new FixedSizeChunker({ chunkSize: 10, overlap: 0 });
    const text = 'ABCDEFGHIJ1234567890abcdefghij';
    const chunks = chunker.chunk(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.content).toBe('ABCDEFGHIJ');
  });

  it('重叠应正确工作', () => {
    const chunker = new FixedSizeChunker({ chunkSize: 10, overlap: 3 });
    const text = 'ABCDEFGHIJKLMNOPQ';
    const chunks = chunker.chunk(text);
    // 第 1 块: 0-9 (ABCDEFGHIJ), 第 2 块: 7-16 (HIJKLMNOPQ)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // 验证重叠区域存在
    if (chunks.length >= 2) {
      const overlap = chunks[0]!.content.slice(-3);
      expect(chunks[1]!.content.startsWith(overlap)).toBe(true);
    }
  });

  it('空文本应返回空', () => {
    const chunker = new FixedSizeChunker();
    expect(chunker.chunk('')).toHaveLength(0);
    expect(chunker.chunk('   ')).toHaveLength(0);
  });

  it('应传递元数据', () => {
    const chunker = new FixedSizeChunker({ chunkSize: 100 });
    const chunks = chunker.chunk('test', { source: 'file.txt' });
    expect(chunks[0]!.metadata.source).toBe('file.txt');
    expect(chunks[0]!.metadata.chunkIndex).toBe(0);
  });
});

// ============================================================
// ParagraphChunker
// ============================================================

describe('ParagraphChunker', () => {
  it('多段落应按段落分块', () => {
    const chunker = new ParagraphChunker({ maxChunkSize: 200 });
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = chunker.chunk(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('短段落应合并', () => {
    const chunker = new ParagraphChunker({ maxChunkSize: 200 });
    const text = 'Short1.\n\nShort2.\n\nShort3.';
    const chunks = chunker.chunk(text);
    // 三个短段落合并后不超过 200，应只有 1 块
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain('Short1.');
    expect(chunks[0]!.content).toContain('Short3.');
  });

  it('超长段落应分为子块', () => {
    const chunker = new ParagraphChunker({ maxChunkSize: 50 });
    const longParagraph = 'x'.repeat(120);
    const chunks = chunker.chunk(longParagraph);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('空文本应返回空', () => {
    const chunker = new ParagraphChunker();
    expect(chunker.chunk('')).toHaveLength(0);
  });
});

// ============================================================
// MarkdownChunker
// ============================================================

describe('MarkdownChunker', () => {
  const sampleMd = `# Title

Introduction paragraph.

## Section One

Content of section one.
More content here.

## Section Two

Content of section two.

### Subsection

Subsection content.
`;

  it('应按标题分块', () => {
    const chunker = new MarkdownChunker(500);
    const chunks = chunker.chunk(sampleMd);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('块应包含标题元数据', () => {
    const chunker = new MarkdownChunker(500);
    const chunks = chunker.chunk(sampleMd);
    const h1Chunk = chunks.find((c) => c.metadata.headingLevel === 1);
    expect(h1Chunk).toBeDefined();
    expect(h1Chunk!.metadata.heading).toBe('Title');
  });

  it('超长 section 应进一步分块', () => {
    const longMd = `# Big Section\n\n${'x'.repeat(500)}\n\n${'y'.repeat(500)}`;
    const chunker = new MarkdownChunker(200);
    const chunks = chunker.chunk(longMd);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('空文本应返回空', () => {
    const chunker = new MarkdownChunker();
    expect(chunker.chunk('')).toHaveLength(0);
  });
});
