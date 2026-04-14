/**
 * Embedder 单元测试
 * 主要测试 SimpleEmbedder（不需要 API）
 * OpenAIEmbedder 在集成测试中验证
 */

import { describe, it, expect } from 'vitest';
import { SimpleEmbedder } from '../embedder.js';
import { cosineSimilarity } from '../vector-math.js';

describe('SimpleEmbedder', () => {
  const embedder = new SimpleEmbedder(64);

  it('应返回正确维度的向量', async () => {
    const vector = await embedder.embed('hello world');
    expect(vector).toHaveLength(64);
  });

  it('getDimension 应返回配置的维度', () => {
    expect(embedder.getDimension()).toBe(64);
  });

  it('相同文本应产生相同向量', async () => {
    const v1 = await embedder.embed('typescript is great');
    const v2 = await embedder.embed('typescript is great');
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1);
  });

  it('相似文本的相似度应高于不相关文本', async () => {
    const vTs = await embedder.embed('typescript programming language');
    const vJs = await embedder.embed('javascript programming language');
    const vCook = await embedder.embed('cooking recipes and food');

    const simTsJs = cosineSimilarity(vTs, vJs);
    const simTsCook = cosineSimilarity(vTs, vCook);

    // TypeScript 和 JavaScript 共享 "programming" 和 "language"，应更相似
    expect(simTsJs).toBeGreaterThan(simTsCook);
  });

  it('embedBatch 应返回正确数量的向量', async () => {
    const vectors = await embedder.embedBatch(['hello', 'world', 'test']);
    expect(vectors).toHaveLength(3);
    vectors.forEach((v) => expect(v).toHaveLength(64));
  });

  it('向量应被归一化（模长约为 1）', async () => {
    const v = await embedder.embed('some text here');
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 1);
  });

  it('空文本应产生零向量', async () => {
    const v = await embedder.embed('');
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(0);
  });
});
