/**
 * 文档助手工具单元测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  listDocsTool,
  readDocTool,
  searchDocsTool,
  writeNoteTool,
  setDocsDir,
  setRAGPipeline,
} from '../tools.js';
import {
  RAGPipeline,
  VectorStore,
  SimpleEmbedder,
  MarkdownChunker,
} from '../../../src/index.js';

let testDir: string;
let rag: RAGPipeline;

beforeAll(async () => {
  // 创建临时目录 + 测试文件
  testDir = path.join(os.tmpdir(), `doc-assist-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  await fs.writeFile(
    path.join(testDir, 'readme.md'),
    '# Hello\n\nThis is a test document about TypeScript and testing.'
  );
  await fs.writeFile(
    path.join(testDir, 'notes.txt'),
    'Meeting notes: discuss project timeline and milestones.'
  );

  setDocsDir(testDir);

  // 初始化 RAG
  const embedder = new SimpleEmbedder({ dimension: 256 });
  const vectorStore = new VectorStore({ embedder });
  rag = new RAGPipeline({ vectorStore, topK: 3, minScore: 0 });
  setRAGPipeline(rag);

  // 索引测试文件
  const content = await fs.readFile(path.join(testDir, 'readme.md'), 'utf-8');
  await rag.indexDocument(content, new MarkdownChunker(), { source: 'readme.md' });

  const notes = await fs.readFile(path.join(testDir, 'notes.txt'), 'utf-8');
  await rag.indexText(notes, { source: 'notes.txt' });
});

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// ============================================================
// list_documents
// ============================================================

describe('list_documents', () => {
  it('应列出所有文件', async () => {
    const result = await listDocsTool.execute({ pattern: undefined });
    expect(result.count).toBe(2);
    const names = result.documents.map((d: any) => d.name);
    expect(names).toContain('readme.md');
    expect(names).toContain('notes.txt');
  });

  it('应按 pattern 过滤', async () => {
    const result = await listDocsTool.execute({ pattern: '.md' });
    expect(result.count).toBe(1);
    expect(result.documents[0].name).toBe('readme.md');
  });

  it('无匹配时返回空数组', async () => {
    const result = await listDocsTool.execute({ pattern: '.pdf' });
    expect(result.count).toBe(0);
  });
});

// ============================================================
// read_document
// ============================================================

describe('read_document', () => {
  it('应读取文件内容', async () => {
    const result = await readDocTool.execute({ filename: 'readme.md', maxLength: undefined });
    expect(result.content).toContain('# Hello');
    expect(result.truncated).toBe(false);
  });

  it('应支持截断', async () => {
    const result = await readDocTool.execute({ filename: 'readme.md', maxLength: 10 });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('...[truncated]');
  });

  it('应阻止路径穿越', async () => {
    await expect(
      readDocTool.execute({ filename: '../../../etc/passwd', maxLength: undefined })
    ).rejects.toThrow('path traversal');
  });
});

// ============================================================
// search_documents
// ============================================================

describe('search_documents', () => {
  it('应返回语义搜索结果', async () => {
    const result = await searchDocsTool.execute({ query: 'TypeScript', topK: undefined });
    expect(result.resultCount).toBeGreaterThan(0);
    expect(result.results[0].content).toBeTruthy();
  });

  it('应限制返回数量', async () => {
    const result = await searchDocsTool.execute({ query: 'document', topK: 1 });
    expect(result.resultCount).toBeLessThanOrEqual(1);
  });
});

// ============================================================
// write_note
// ============================================================

describe('write_note', () => {
  it('应写入新文件', async () => {
    const result = await writeNoteTool.execute({
      filename: 'test-note.md',
      content: '# Test Note\n\nHello world',
    });
    expect(result.message).toContain('saved successfully');

    const content = await fs.readFile(path.join(testDir, 'test-note.md'), 'utf-8');
    expect(content).toBe('# Test Note\n\nHello world');
  });

  it('应阻止非法文件名', async () => {
    await expect(
      writeNoteTool.execute({ filename: '../evil.txt', content: 'hacked' })
    ).rejects.toThrow('Invalid filename');
  });

  it('应阻止包含路径分隔符的文件名', async () => {
    await expect(
      writeNoteTool.execute({ filename: 'sub/file.txt', content: 'test' })
    ).rejects.toThrow('Invalid filename');
  });
});
