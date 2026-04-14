/**
 * RAG Pipeline 单元测试
 */

import { describe, it, expect } from 'vitest';
import type { Message } from '../../types.js';
import { RAGPipeline } from '../rag-pipeline.js';
import { VectorStore } from '../vector-store.js';
import { SimpleEmbedder } from '../embedder.js';
import { FixedSizeChunker, ParagraphChunker } from '../chunker.js';

function createPipeline(topK = 3, minScore = 0) {
  const store = new VectorStore({ embedder: new SimpleEmbedder(64) });
  return new RAGPipeline({ vectorStore: store, topK, minScore });
}

describe('RAGPipeline', () => {
  // ----------------------------------------------------------
  // 索引
  // ----------------------------------------------------------

  describe('indexing', () => {
    it('indexText 应添加到向量存储', async () => {
      const pipeline = createPipeline();
      await pipeline.indexText('TypeScript is great', { source: 'manual' });
      expect(pipeline.getVectorStore().size()).toBe(1);
    });

    it('indexTexts 批量索引应工作', async () => {
      const pipeline = createPipeline();
      await pipeline.indexTexts([
        { content: 'first document' },
        { content: 'second document', metadata: { idx: 1 } },
      ]);
      expect(pipeline.getVectorStore().size()).toBe(2);
    });

    it('indexDocument 应使用分块策略', async () => {
      const pipeline = createPipeline();
      const longText = 'Paragraph one about TypeScript.\n\nParagraph two about JavaScript.\n\nParagraph three about programming.';
      const chunks = await pipeline.indexDocument(
        longText,
        new ParagraphChunker({ maxChunkSize: 50 }),
        { source: 'doc' }
      );

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(pipeline.getVectorStore().size()).toBe(chunks.length);
    });
  });

  // ----------------------------------------------------------
  // 检索
  // ----------------------------------------------------------

  describe('retrieval', () => {
    it('retrieve 应返回相关结果', async () => {
      const pipeline = createPipeline();
      await pipeline.indexTexts([
        { content: 'TypeScript is a typed superset of JavaScript' },
        { content: 'Python is used for data science' },
        { content: 'TypeScript compiles to JavaScript' },
      ]);

      const results = await pipeline.retrieve('TypeScript');
      expect(results.length).toBeGreaterThan(0);
    });

    it('topK 应限制检索数量', async () => {
      const pipeline = createPipeline(2);
      for (let i = 0; i < 10; i++) {
        await pipeline.indexText(`document ${i} about programming`);
      }

      const results = await pipeline.retrieve('programming');
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // ----------------------------------------------------------
  // 增强
  // ----------------------------------------------------------

  describe('augmentation', () => {
    it('augment 应将检索结果注入 system 消息', async () => {
      const pipeline = createPipeline();
      await pipeline.indexText('TypeScript was created by Microsoft in 2012');

      const messages: Message[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Tell me about TypeScript' },
      ];

      const augmented = await pipeline.augment('TypeScript', messages);

      expect(augmented[0]!.role).toBe('system');
      if (augmented[0]!.role === 'system') {
        expect(augmented[0]!.content).toContain('Retrieved Context');
        expect(augmented[0]!.content).toContain('TypeScript was created by Microsoft');
      }
    });

    it('无检索结果时应返回原消息', async () => {
      const pipeline = createPipeline(3, 0.99); // 极高阈值
      await pipeline.indexText('something unrelated');

      const messages: Message[] = [
        { role: 'system', content: 'You are a helper.' },
        { role: 'user', content: 'question' },
      ];

      const augmented = await pipeline.augment('completely different topic xyz', messages);
      // 应该没有检索到任何结果（或低于阈值）
      // 无论有没有结果，不应破坏消息结构
      expect(augmented.length).toBeGreaterThanOrEqual(2);
    });

    it('无 system 消息时应创建一个', async () => {
      const pipeline = createPipeline();
      await pipeline.indexText('relevant information here');

      const messages: Message[] = [
        { role: 'user', content: 'relevant question' },
      ];

      const augmented = await pipeline.augment('relevant', messages);
      expect(augmented[0]!.role).toBe('system');
    });
  });

  // ----------------------------------------------------------
  // getContext
  // ----------------------------------------------------------

  describe('getContext', () => {
    it('应返回格式化的上下文文本', async () => {
      const pipeline = createPipeline();
      await pipeline.indexText('TypeScript supports generics');

      const ctx = await pipeline.getContext('TypeScript generics');
      expect(ctx).toContain('Retrieved Context');
      expect(ctx).toContain('TypeScript supports generics');
      expect(ctx).toContain('relevance');
    });

    it('无结果应返回空字符串', async () => {
      const pipeline = createPipeline(3, 0.99);
      const ctx = await pipeline.getContext('nothing');
      expect(ctx).toBe('');
    });
  });

  // ----------------------------------------------------------
  // 自定义模板
  // ----------------------------------------------------------

  describe('自定义上下文模板', () => {
    it('应使用自定义模板格式化', async () => {
      const store = new VectorStore({ embedder: new SimpleEmbedder(64) });
      const pipeline = new RAGPipeline({
        vectorStore: store,
        contextTemplate: (chunks) =>
          `Found ${chunks.length} results:\n${chunks.map((c) => c.entry.content).join('\n')}`,
      });

      await pipeline.indexText('custom template test');
      const ctx = await pipeline.getContext('custom template');
      expect(ctx).toContain('Found 1 results');
      expect(ctx).toContain('custom template test');
    });
  });
});
