/**
 * MemoryStore 实现 -- 长期记忆
 *
 * 两个实现：
 * 1. InMemoryStore -- 纯内存，适合测试和短生命周期场景
 * 2. FileMemoryStore -- 基于 JSON 文件持久化，适合单机 Agent
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MemoryEntry, MemoryStore } from './types.js';

// ============================================================
// 分词工具 -- 简易关键词提取
// ============================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'like',
  'through', 'after', 'over', 'between', 'out', 'against', 'during',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'same', 'than', 'too',
  'very', 'just', 'because', 'if', 'when', 'where', 'how', 'what',
  'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'it',
  'its', 'my', 'your', 'his', 'her', 'our', 'their', 'me', 'him',
  'us', 'them', 'i', 'you', 'he', 'she', 'we', 'they',
  'tell', 'know', 'get', 'make', 'go', 'see', 'think', 'take',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.!?;:'"()\[\]{}<>\/\\]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// ============================================================
// ID 生成器
// ============================================================

let counter = 0;
function generateId(): string {
  counter++;
  return `mem_${Date.now()}_${counter}`;
}

// ============================================================
// 1. InMemoryStore -- 纯内存实现
// ============================================================

export class InMemoryStore implements MemoryStore {
  readonly name: string;
  private entries: Map<string, MemoryEntry> = new Map();

  constructor(name: string = 'in-memory') {
    this.name = name;
  }

  async add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<MemoryEntry> {
    const now = Date.now();
    const full: MemoryEntry = {
      ...entry,
      id: generateId(),
      createdAt: now,
      lastAccessedAt: now,
    };
    this.entries.set(full.id, full);
    return full;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (entry) {
      entry.lastAccessedAt = Date.now();
    }
    return entry ?? null;
  }

  async search(query: string, limit: number = 10): Promise<MemoryEntry[]> {
    const keywords = tokenize(query);
    if (keywords.length === 0) return [];

    const results: Array<{ entry: MemoryEntry; matchScore: number }> = [];

    for (const entry of this.entries.values()) {
      const contentLower = entry.content.toLowerCase();
      const matchedKeywords = keywords.filter((kw) => contentLower.includes(kw));
      if (matchedKeywords.length > 0) {
        entry.lastAccessedAt = Date.now();
        const matchScore = matchedKeywords.length / keywords.length;
        results.push({ entry, matchScore });
      }
    }

    results.sort((a, b) => {
      const scoreA = a.matchScore * 0.4 + a.entry.importance * 0.4 + (a.entry.lastAccessedAt / Date.now()) * 0.2;
      const scoreB = b.matchScore * 0.4 + b.entry.importance * 0.4 + (b.entry.lastAccessedAt / Date.now()) * 0.2;
      return scoreB - scoreA;
    });

    return results.slice(0, limit).map((r) => r.entry);
  }

  async list(): Promise<MemoryEntry[]> {
    return Array.from(this.entries.values());
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  async size(): Promise<number> {
    return this.entries.size;
  }
}

// ============================================================
// 2. FileMemoryStore -- 文件持久化实现
// ============================================================

export class FileMemoryStore implements MemoryStore {
  readonly name: string;
  private filePath: string;
  private entries: Map<string, MemoryEntry> = new Map();
  private loaded = false;

  constructor(filePath: string, name: string = 'file-store') {
    this.filePath = filePath;
    this.name = name;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as MemoryEntry[];
      for (const entry of parsed) {
        this.entries.set(entry.id, entry);
      }
    } catch {
      // 文件不存在或解析失败，从空开始
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const data = Array.from(this.entries.values());
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<MemoryEntry> {
    await this.ensureLoaded();
    const now = Date.now();
    const full: MemoryEntry = {
      ...entry,
      id: generateId(),
      createdAt: now,
      lastAccessedAt: now,
    };
    this.entries.set(full.id, full);
    await this.persist();
    return full;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    await this.ensureLoaded();
    const entry = this.entries.get(id);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      await this.persist();
    }
    return entry ?? null;
  }

  async search(query: string, limit: number = 10): Promise<MemoryEntry[]> {
    await this.ensureLoaded();
    const keywords = tokenize(query);
    if (keywords.length === 0) return [];

    const results: Array<{ entry: MemoryEntry; matchScore: number }> = [];

    for (const entry of this.entries.values()) {
      const contentLower = entry.content.toLowerCase();
      const matchedKeywords = keywords.filter((kw) => contentLower.includes(kw));
      if (matchedKeywords.length > 0) {
        entry.lastAccessedAt = Date.now();
        const matchScore = matchedKeywords.length / keywords.length;
        results.push({ entry, matchScore });
      }
    }

    results.sort((a, b) => {
      const scoreA = a.matchScore * 0.4 + a.entry.importance * 0.4 + (a.entry.lastAccessedAt / Date.now()) * 0.2;
      const scoreB = b.matchScore * 0.4 + b.entry.importance * 0.4 + (b.entry.lastAccessedAt / Date.now()) * 0.2;
      return scoreB - scoreA;
    });

    return results.slice(0, limit).map((r) => r.entry);
  }

  async list(): Promise<MemoryEntry[]> {
    await this.ensureLoaded();
    return Array.from(this.entries.values());
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const deleted = this.entries.delete(id);
    if (deleted) await this.persist();
    return deleted;
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    this.entries.clear();
    await this.persist();
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.entries.size;
  }
}
