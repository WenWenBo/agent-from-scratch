/**
 * 智能文档助手 -- 专用工具集
 *
 * 提供文档管理相关的工具：
 * - 列出文档
 * - 读取文档内容
 * - 搜索文档（基于 RAG）
 * - 生成摘要
 * - 提取关键信息
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from '../../src/tools/tool.js';
import type { RAGPipeline } from '../../src/rag/rag-pipeline.js';

// ============================================================
// 文档存储目录
// ============================================================

let docsDir = '';

export function setDocsDir(dir: string) {
  docsDir = dir;
}

export function getDocsDir(): string {
  return docsDir;
}

// ============================================================
// RAG Pipeline 引用
// ============================================================

let ragPipeline: RAGPipeline | null = null;

export function setRAGPipeline(pipeline: RAGPipeline) {
  ragPipeline = pipeline;
}

// ============================================================
// 工具定义
// ============================================================

/**
 * 列出文档目录中的所有文件
 */
export const listDocsTool = defineTool({
  name: 'list_documents',
  description: 'List all documents in the knowledge base. Returns filenames, sizes and last modified dates.',
  parameters: z.object({
    pattern: z.string().optional().describe('Optional filename filter pattern, e.g. ".md" to filter markdown files'),
  }),
  execute: async ({ pattern }) => {
    const files = await fs.readdir(docsDir);
    const results = [];

    for (const file of files) {
      if (pattern && !file.includes(pattern)) continue;
      const filePath = path.join(docsDir, file);
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        results.push({
          name: file,
          size: stat.size,
          sizeFormatted: formatSize(stat.size),
          lastModified: stat.mtime.toISOString(),
        });
      }
    }

    return {
      count: results.length,
      documents: results,
    };
  },
});

/**
 * 读取指定文档的内容
 */
export const readDocTool = defineTool({
  name: 'read_document',
  description: 'Read the full content of a specific document from the knowledge base.',
  parameters: z.object({
    filename: z.string().describe('The filename to read, e.g. "readme.md"'),
    maxLength: z.number().optional().describe('Maximum characters to return. Defaults to 5000.'),
  }),
  execute: async ({ filename, maxLength }) => {
    const limit = maxLength ?? 5000;
    const filePath = path.join(docsDir, filename);

    // 安全检查：防止路径穿越
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(docsDir))) {
      throw new Error('Access denied: path traversal detected');
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const truncated = content.length > limit;

    return {
      filename,
      content: truncated ? content.slice(0, limit) + '\n...[truncated]' : content,
      totalLength: content.length,
      truncated,
    };
  },
});

/**
 * 通过 RAG 语义搜索文档
 */
export const searchDocsTool = defineTool({
  name: 'search_documents',
  description: 'Search the knowledge base using semantic search. Returns the most relevant document passages for a given query.',
  parameters: z.object({
    query: z.string().describe('The search query describing what information you are looking for'),
    topK: z.number().optional().describe('Number of results to return. Defaults to 3.'),
  }),
  execute: async ({ query, topK }) => {
    if (!ragPipeline) {
      throw new Error('RAG pipeline not initialized');
    }

    const results = await ragPipeline.retrieve(query);
    const limited = results.slice(0, topK ?? 3);

    return {
      query,
      resultCount: limited.length,
      results: limited.map((r, i) => ({
        rank: i + 1,
        score: Math.round(r.score * 100) / 100,
        content: r.entry.content,
        source: r.entry.metadata?.source ?? 'unknown',
      })),
    };
  },
});

/**
 * 写入新文档（笔记功能）
 */
export const writeNoteTool = defineTool({
  name: 'write_note',
  description: 'Write a new note or summary document to the knowledge base.',
  parameters: z.object({
    filename: z.string().describe('Filename for the note, e.g. "meeting-notes-0410.md"'),
    content: z.string().describe('The content to write'),
  }),
  execute: async ({ filename, content }) => {
    // 安全检查
    if (filename.includes('..') || filename.includes('/')) {
      throw new Error('Invalid filename: must not contain path separators');
    }

    const filePath = path.join(docsDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    const stat = await fs.stat(filePath);

    return {
      filename,
      size: stat.size,
      sizeFormatted: formatSize(stat.size),
      message: `Note "${filename}" saved successfully`,
    };
  },
});

// ============================================================
// 工具函数
// ============================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
