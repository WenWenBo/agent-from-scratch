/**
 * 代码审查 Agent 专用工具集
 *
 * 工具列表：
 * 1. list_files     -- 列出目录下的源码文件
 * 2. read_file      -- 读取文件内容（带行号）
 * 3. count_lines    -- 统计文件行数和函数数量
 * 4. search_pattern -- 在代码中搜索正则模式
 */

import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defineTool } from '../../src/tools/tool.js';

let codeDir = '';

export function setCodeDir(dir: string): void {
  codeDir = dir;
}

// ============================================================
// list_files -- 列出源码文件
// ============================================================

export const listFilesTool = defineTool({
  name: 'list_files',
  description: 'List all source code files in the project directory. Returns filenames with size and line count.',
  parameters: z.object({
    extension: z.string().optional().describe('File extension filter, e.g. ".ts", ".js"'),
  }),
  execute: async ({ extension }) => {
    if (!codeDir) throw new Error('Code directory not set');

    const entries = await fs.readdir(codeDir, { withFileTypes: true });
    const files: Array<{ name: string; size: number; lines: number }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (extension && !entry.name.endsWith(extension)) continue;

      const filePath = path.join(codeDir, entry.name);
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').length;

      files.push({ name: entry.name, size: stat.size, lines });
    }

    return files;
  },
});

// ============================================================
// read_file -- 读取文件（带行号）
// ============================================================

export const readFileTool = defineTool({
  name: 'read_file',
  description: 'Read the content of a source code file with line numbers. Useful for code review.',
  parameters: z.object({
    filename: z.string().describe('Name of the file to read'),
    startLine: z.number().optional().describe('Starting line number (1-based)'),
    endLine: z.number().optional().describe('Ending line number (inclusive)'),
  }),
  execute: async ({ filename, startLine, endLine }) => {
    if (!codeDir) throw new Error('Code directory not set');

    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Access denied: path traversal detected');
    }

    const safeName = path.basename(filename);
    const filePath = path.join(codeDir, safeName);

    const content = await fs.readFile(filePath, 'utf-8');
    const allLines = content.split('\n');

    const start = (startLine ?? 1) - 1;
    const end = endLine ?? allLines.length;
    const lines = allLines.slice(start, end);

    return lines.map((line, i) => `${start + i + 1} | ${line}`).join('\n');
  },
});

// ============================================================
// count_lines -- 统计代码指标
// ============================================================

export const countLinesTool = defineTool({
  name: 'count_lines',
  description: 'Count lines, functions, and complexity metrics of a source code file.',
  parameters: z.object({
    filename: z.string().describe('Name of the file to analyze'),
  }),
  execute: async ({ filename }) => {
    if (!codeDir) throw new Error('Code directory not set');

    const filePath = path.join(codeDir, path.basename(filename));
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const totalLines = lines.length;
    const codeLines = lines.filter((l) => l.trim() && !l.trim().startsWith('//')).length;
    const commentLines = lines.filter((l) => l.trim().startsWith('//')).length;
    const blankLines = lines.filter((l) => !l.trim()).length;

    // 简易函数检测
    const functionMatches = content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+/g) ?? [];
    const arrowFunctions = content.match(/(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*\w+)?\s*=>/g) ?? [];
    const methodMatches = content.match(/^\s+(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/gm) ?? [];

    // 简易嵌套深度检测
    let maxNesting = 0;
    let currentNesting = 0;
    for (const line of lines) {
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      currentNesting += opens - closes;
      if (currentNesting > maxNesting) maxNesting = currentNesting;
    }

    return {
      totalLines,
      codeLines,
      commentLines,
      blankLines,
      functions: functionMatches.length + arrowFunctions.length + methodMatches.length,
      maxNestingDepth: maxNesting,
    };
  },
});

// ============================================================
// search_pattern -- 在代码中搜索模式
// ============================================================

export const searchPatternTool = defineTool({
  name: 'search_pattern',
  description: 'Search for a regex pattern across all source files. Returns matching lines with file name and line number.',
  parameters: z.object({
    pattern: z.string().describe('Regex pattern to search for, e.g. "eval\\\\(" or "any"'),
    fileExtension: z.string().optional().describe('Only search in files with this extension'),
  }),
  execute: async ({ pattern, fileExtension }) => {
    if (!codeDir) throw new Error('Code directory not set');

    const regex = new RegExp(pattern, 'gi');
    const entries = await fs.readdir(codeDir, { withFileTypes: true });
    const results: Array<{ file: string; line: number; content: string }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (fileExtension && !entry.name.endsWith(fileExtension)) continue;

      const content = await fs.readFile(path.join(codeDir, entry.name), 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i]!)) {
          results.push({
            file: entry.name,
            line: i + 1,
            content: lines[i]!.trim(),
          });
        }
      }
    }

    return results.length > 0
      ? results
      : `No matches found for pattern: ${pattern}`;
  },
});
