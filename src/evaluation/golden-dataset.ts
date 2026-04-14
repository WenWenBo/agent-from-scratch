/**
 * GoldenDataset -- 黄金数据集管理
 *
 * 用于存储标注好的测试用例（input → expected output），
 * 配合 EvalRunner 做批量回归评估。
 *
 * 支持：
 * 1. 内存数据集（单元测试）
 * 2. JSON 文件加载/保存
 * 3. 分类标签过滤
 * 4. 数据集统计
 */

import * as fs from 'node:fs/promises';

// ============================================================
// 数据条目
// ============================================================

export interface GoldenCase {
  /** 唯一 ID */
  id: string;
  /** 用户输入 */
  input: string;
  /** 期望输出 */
  expected: string;
  /** 分类标签 */
  tags?: string[];
  /** 额外上下文（RAG 场景） */
  context?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// GoldenDataset
// ============================================================

export class GoldenDataset {
  private cases: Map<string, GoldenCase> = new Map();
  private _name: string;

  constructor(name: string) {
    this._name = name;
  }

  get name(): string {
    return this._name;
  }

  get size(): number {
    return this.cases.size;
  }

  // ============================================================
  // CRUD
  // ============================================================

  add(goldenCase: GoldenCase): void {
    this.cases.set(goldenCase.id, goldenCase);
  }

  addMany(cases: GoldenCase[]): void {
    for (const c of cases) {
      this.add(c);
    }
  }

  get(id: string): GoldenCase | undefined {
    return this.cases.get(id);
  }

  remove(id: string): boolean {
    return this.cases.delete(id);
  }

  getAll(): GoldenCase[] {
    return [...this.cases.values()];
  }

  // ============================================================
  // 过滤
  // ============================================================

  filterByTag(tag: string): GoldenCase[] {
    return this.getAll().filter((c) => c.tags?.includes(tag));
  }

  filterByTags(tags: string[], mode: 'all' | 'any' = 'any'): GoldenCase[] {
    return this.getAll().filter((c) => {
      if (!c.tags) return false;
      return mode === 'all'
        ? tags.every((t) => c.tags!.includes(t))
        : tags.some((t) => c.tags!.includes(t));
    });
  }

  getTags(): string[] {
    const tagSet = new Set<string>();
    for (const c of this.cases.values()) {
      for (const tag of c.tags ?? []) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort();
  }

  // ============================================================
  // 统计
  // ============================================================

  getStats(): {
    totalCases: number;
    tags: Record<string, number>;
    avgInputLength: number;
    avgExpectedLength: number;
  } {
    const all = this.getAll();
    const tags: Record<string, number> = {};

    for (const c of all) {
      for (const tag of c.tags ?? []) {
        tags[tag] = (tags[tag] ?? 0) + 1;
      }
    }

    const totalInput = all.reduce((sum, c) => sum + c.input.length, 0);
    const totalExpected = all.reduce((sum, c) => sum + c.expected.length, 0);

    return {
      totalCases: all.length,
      tags,
      avgInputLength: all.length > 0 ? Math.round(totalInput / all.length) : 0,
      avgExpectedLength: all.length > 0 ? Math.round(totalExpected / all.length) : 0,
    };
  }

  // ============================================================
  // 持久化
  // ============================================================

  async saveToFile(filePath: string): Promise<void> {
    const data = {
      name: this._name,
      cases: this.getAll(),
    };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  static async loadFromFile(filePath: string): Promise<GoldenDataset> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as { name: string; cases: GoldenCase[] };
    const dataset = new GoldenDataset(data.name);
    dataset.addMany(data.cases);
    return dataset;
  }

  toJSON(): { name: string; cases: GoldenCase[] } {
    return { name: this._name, cases: this.getAll() };
  }

  static fromJSON(json: { name: string; cases: GoldenCase[] }): GoldenDataset {
    const dataset = new GoldenDataset(json.name);
    dataset.addMany(json.cases);
    return dataset;
  }

  clear(): void {
    this.cases.clear();
  }
}
