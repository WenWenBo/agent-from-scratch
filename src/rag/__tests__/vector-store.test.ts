/**
 * VectorStore 单元测试
 * 使用 SimpleEmbedder 测试向量存储和语义搜索
 */

import { describe, it, expect } from 'vitest';
import { VectorStore } from '../vector-store.js';
import { SimpleEmbedder } from '../embedder.js';

function createStore() {
  return new VectorStore({
    embedder: new SimpleEmbedder(64),
  });
}

describe('VectorStore', () => {
  describe('基本操作', () => {
    it('add 应存储条目', async () => {
      const store = createStore();
      const entry = await store.add('TypeScript is great', { source: 'test' });
      expect(entry.id).toBeTruthy();
      expect(entry.content).toBe('TypeScript is great');
      expect(entry.vector).toHaveLength(64);
      expect(entry.metadata.source).toBe('test');
    });

    it('addBatch 应批量存储', async () => {
      const store = createStore();
      const entries = await store.addBatch([
        { content: 'first' },
        { content: 'second', metadata: { idx: 1 } },
      ]);
      expect(entries).toHaveLength(2);
      expect(store.size()).toBe(2);
    });

    it('get 应返回存在的条目', async () => {
      const store = createStore();
      const added = await store.add('test content');
      const got = store.get(added.id);
      expect(got).not.toBeNull();
      expect(got!.content).toBe('test content');
    });

    it('get 不存在的 ID 应返回 null', () => {
      const store = createStore();
      expect(store.get('nonexistent')).toBeNull();
    });

    it('delete 应删除条目', async () => {
      const store = createStore();
      const entry = await store.add('to delete');
      expect(store.delete(entry.id)).toBe(true);
      expect(store.get(entry.id)).toBeNull();
      expect(store.size()).toBe(0);
    });

    it('clear 应清空全部', async () => {
      const store = createStore();
      await store.addBatch([{ content: 'a' }, { content: 'b' }]);
      store.clear();
      expect(store.size()).toBe(0);
    });

    it('list 应返回全部条目（不含向量）', async () => {
      const store = createStore();
      await store.addBatch([
        { content: 'first', metadata: { idx: 0 } },
        { content: 'second' },
      ]);
      const list = store.list();
      expect(list).toHaveLength(2);
      expect(list[0]!).not.toHaveProperty('vector');
    });
  });

  describe('语义搜索', () => {
    it('应按相似度排序返回结果', async () => {
      const store = createStore();
      await store.addBatch([
        { content: 'TypeScript is a typed programming language' },
        { content: 'JavaScript runs in the browser' },
        { content: 'Cooking pasta with tomato sauce' },
        { content: 'TypeScript compiles to JavaScript' },
      ]);

      const results = await store.search('TypeScript programming');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.score).toBeGreaterThan(0);

      // 检查分数降序
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
      }
    });

    it('topK 应限制结果数量', async () => {
      const store = createStore();
      for (let i = 0; i < 10; i++) {
        await store.add(`document number ${i} about programming`);
      }

      const results = await store.search('programming', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('minScore 应过滤低相似度结果', async () => {
      const store = createStore();
      await store.addBatch([
        { content: 'TypeScript programming language' },
        { content: 'Cooking delicious food recipes' },
      ]);

      const results = await store.search('TypeScript code', 10, 0.5);
      // 高阈值应过滤掉不相关的结果
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('空 store 搜索应返回空', async () => {
      const store = createStore();
      const results = await store.search('anything');
      expect(results).toHaveLength(0);
    });
  });

  describe('addWithVector', () => {
    it('应直接存储带向量的条目', () => {
      const store = createStore();
      const vector = new Array(64).fill(0);
      vector[0] = 1;
      const entry = store.addWithVector('test', vector, { manual: true });
      expect(entry.content).toBe('test');
      expect(store.size()).toBe(1);
    });
  });
});
