/**
 * MemoryStore 单元测试（InMemoryStore + FileMemoryStore）
 */

import { describe, it, expect, afterEach } from 'vitest';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryStore, FileMemoryStore } from '../memory-store.js';
import type { MemoryStore } from '../types.js';

// ============================================================
// 通用测试套件 -- 对所有 MemoryStore 实现运行相同测试
// ============================================================

function storeTestSuite(name: string, createStore: () => MemoryStore) {
  describe(name, () => {
    it('add 应创建并返回完整的 MemoryEntry', async () => {
      const store = createStore();
      const entry = await store.add({
        content: '用户喜欢 TypeScript',
        metadata: { source: 'conversation' },
        importance: 0.8,
      });

      expect(entry.id).toBeTruthy();
      expect(entry.content).toBe('用户喜欢 TypeScript');
      expect(entry.metadata.source).toBe('conversation');
      expect(entry.importance).toBe(0.8);
      expect(entry.createdAt).toBeGreaterThan(0);
      expect(entry.lastAccessedAt).toBeGreaterThan(0);
    });

    it('get 应返回存在的条目', async () => {
      const store = createStore();
      const added = await store.add({
        content: 'test',
        metadata: {},
        importance: 0.5,
      });

      const got = await store.get(added.id);
      expect(got).not.toBeNull();
      expect(got!.content).toBe('test');
    });

    it('get 不存在的 ID 应返回 null', async () => {
      const store = createStore();
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('search 应匹配包含查询词的条目', async () => {
      const store = createStore();
      await store.add({ content: 'I love TypeScript', metadata: {}, importance: 0.5 });
      await store.add({ content: 'Python is great too', metadata: {}, importance: 0.5 });
      await store.add({ content: 'TypeScript generics are powerful', metadata: {}, importance: 0.8 });

      const results = await store.search('TypeScript');
      expect(results).toHaveLength(2);
    });

    it('search 应按重要性排序', async () => {
      const store = createStore();
      await store.add({ content: 'low importance TypeScript', metadata: {}, importance: 0.1 });
      await store.add({ content: 'high importance TypeScript', metadata: {}, importance: 0.9 });

      const results = await store.search('TypeScript');
      expect(results).toHaveLength(2);
      expect(results[0]!.content).toContain('high importance');
    });

    it('search 应支持 limit', async () => {
      const store = createStore();
      for (let i = 0; i < 10; i++) {
        await store.add({ content: `item ${i}`, metadata: {}, importance: 0.5 });
      }

      const results = await store.search('item', 3);
      expect(results).toHaveLength(3);
    });

    it('search 无匹配时应返回空', async () => {
      const store = createStore();
      await store.add({ content: 'hello', metadata: {}, importance: 0.5 });
      const results = await store.search('nonexistent');
      expect(results).toHaveLength(0);
    });

    it('list 应返回全部条目', async () => {
      const store = createStore();
      await store.add({ content: 'a', metadata: {}, importance: 0.5 });
      await store.add({ content: 'b', metadata: {}, importance: 0.5 });

      const all = await store.list();
      expect(all).toHaveLength(2);
    });

    it('delete 应删除指定条目', async () => {
      const store = createStore();
      const entry = await store.add({ content: 'to delete', metadata: {}, importance: 0.5 });

      const deleted = await store.delete(entry.id);
      expect(deleted).toBe(true);
      expect(await store.get(entry.id)).toBeNull();
      expect(await store.size()).toBe(0);
    });

    it('delete 不存在的 ID 应返回 false', async () => {
      const store = createStore();
      const result = await store.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('clear 应清空全部', async () => {
      const store = createStore();
      await store.add({ content: 'a', metadata: {}, importance: 0.5 });
      await store.add({ content: 'b', metadata: {}, importance: 0.5 });
      await store.clear();

      expect(await store.size()).toBe(0);
      expect(await store.list()).toHaveLength(0);
    });

    it('size 应返回正确计数', async () => {
      const store = createStore();
      expect(await store.size()).toBe(0);
      await store.add({ content: 'a', metadata: {}, importance: 0.5 });
      expect(await store.size()).toBe(1);
      await store.add({ content: 'b', metadata: {}, importance: 0.5 });
      expect(await store.size()).toBe(2);
    });
  });
}

// ============================================================
// 运行通用测试
// ============================================================

storeTestSuite('InMemoryStore', () => new InMemoryStore());

const tempFiles: string[] = [];

storeTestSuite('FileMemoryStore', () => {
  const filePath = join(tmpdir(), `tiny-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tempFiles.push(filePath);
  return new FileMemoryStore(filePath);
});

// ============================================================
// FileMemoryStore 特有测试
// ============================================================

describe('FileMemoryStore 持久化', () => {
  const filePath = join(tmpdir(), `tiny-agent-persist-test-${Date.now()}.json`);

  afterEach(async () => {
    try { await unlink(filePath); } catch { /* ignore */ }
  });

  it('数据应在新实例中持久化', async () => {
    const store1 = new FileMemoryStore(filePath, 'store1');
    await store1.add({ content: 'persistent data', metadata: { key: 'value' }, importance: 0.7 });
    expect(await store1.size()).toBe(1);

    // 创建新实例读取同一文件
    const store2 = new FileMemoryStore(filePath, 'store2');
    expect(await store2.size()).toBe(1);
    const results = await store2.search('persistent');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('persistent data');
    expect(results[0]!.metadata.key).toBe('value');
  });

  it('文件不存在时应从空开始', async () => {
    const store = new FileMemoryStore('/tmp/nonexistent-file-12345.json');
    expect(await store.size()).toBe(0);
  });
});

// 清理临时文件
afterEach(async () => {
  for (const f of tempFiles) {
    try { await unlink(f); } catch { /* ignore */ }
  }
  tempFiles.length = 0;
});
