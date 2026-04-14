/**
 * GoldenDataset -- 单元测试
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { GoldenDataset } from '../golden-dataset.js';

describe('GoldenDataset', () => {
  const testFile = path.join(os.tmpdir(), `golden-test-${Date.now()}.json`);

  afterAll(async () => {
    await fs.rm(testFile, { force: true });
  });

  it('应正确添加和获取 case', () => {
    const ds = new GoldenDataset('test');
    ds.add({ id: '1', input: 'Q1', expected: 'A1' });
    ds.add({ id: '2', input: 'Q2', expected: 'A2' });

    expect(ds.size).toBe(2);
    expect(ds.get('1')?.input).toBe('Q1');
    expect(ds.get('3')).toBeUndefined();
  });

  it('应支持批量添加', () => {
    const ds = new GoldenDataset('test');
    ds.addMany([
      { id: '1', input: 'Q1', expected: 'A1' },
      { id: '2', input: 'Q2', expected: 'A2' },
    ]);
    expect(ds.size).toBe(2);
  });

  it('应支持删除', () => {
    const ds = new GoldenDataset('test');
    ds.add({ id: '1', input: 'Q', expected: 'A' });
    expect(ds.remove('1')).toBe(true);
    expect(ds.size).toBe(0);
    expect(ds.remove('nonexistent')).toBe(false);
  });

  it('应按标签过滤', () => {
    const ds = new GoldenDataset('test');
    ds.addMany([
      { id: '1', input: 'Q1', expected: 'A1', tags: ['math'] },
      { id: '2', input: 'Q2', expected: 'A2', tags: ['science'] },
      { id: '3', input: 'Q3', expected: 'A3', tags: ['math', 'science'] },
    ]);

    expect(ds.filterByTag('math')).toHaveLength(2);
    expect(ds.filterByTag('science')).toHaveLength(2);
    expect(ds.filterByTag('history')).toHaveLength(0);
  });

  it('filterByTags 应支持 all/any 模式', () => {
    const ds = new GoldenDataset('test');
    ds.addMany([
      { id: '1', input: 'Q1', expected: 'A1', tags: ['a', 'b'] },
      { id: '2', input: 'Q2', expected: 'A2', tags: ['a'] },
      { id: '3', input: 'Q3', expected: 'A3', tags: ['b', 'c'] },
    ]);

    expect(ds.filterByTags(['a', 'b'], 'any')).toHaveLength(3);
    expect(ds.filterByTags(['a', 'b'], 'all')).toHaveLength(1);
  });

  it('getTags 应返回所有唯一标签', () => {
    const ds = new GoldenDataset('test');
    ds.addMany([
      { id: '1', input: 'Q', expected: 'A', tags: ['b', 'a'] },
      { id: '2', input: 'Q', expected: 'A', tags: ['a', 'c'] },
    ]);

    expect(ds.getTags()).toEqual(['a', 'b', 'c']);
  });

  it('getStats 应返回正确统计', () => {
    const ds = new GoldenDataset('test');
    ds.addMany([
      { id: '1', input: 'Hello', expected: 'World', tags: ['t1'] },
      { id: '2', input: 'Hi', expected: 'There', tags: ['t1', 't2'] },
    ]);

    const stats = ds.getStats();
    expect(stats.totalCases).toBe(2);
    expect(stats.tags.t1).toBe(2);
    expect(stats.tags.t2).toBe(1);
    expect(stats.avgInputLength).toBe(4); // (5+2)/2 = 3.5 → 4
    expect(stats.avgExpectedLength).toBe(5); // (5+5)/2 = 5
  });

  it('应保存和加载文件', async () => {
    const ds = new GoldenDataset('persist-test');
    ds.addMany([
      { id: '1', input: 'Q1', expected: 'A1', tags: ['t1'] },
      { id: '2', input: 'Q2', expected: 'A2' },
    ]);

    await ds.saveToFile(testFile);
    const loaded = await GoldenDataset.loadFromFile(testFile);

    expect(loaded.name).toBe('persist-test');
    expect(loaded.size).toBe(2);
    expect(loaded.get('1')?.tags).toEqual(['t1']);
  });

  it('应支持 toJSON / fromJSON', () => {
    const ds = new GoldenDataset('json-test');
    ds.add({ id: '1', input: 'Q', expected: 'A' });

    const json = ds.toJSON();
    const restored = GoldenDataset.fromJSON(json);

    expect(restored.name).toBe('json-test');
    expect(restored.size).toBe(1);
  });

  it('clear 应清空所有数据', () => {
    const ds = new GoldenDataset('test');
    ds.add({ id: '1', input: 'Q', expected: 'A' });
    ds.clear();
    expect(ds.size).toBe(0);
  });
});
