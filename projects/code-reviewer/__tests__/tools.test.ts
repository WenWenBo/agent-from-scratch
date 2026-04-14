/**
 * 代码审查工具 -- 单元测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  setCodeDir,
  listFilesTool,
  readFileTool,
  countLinesTool,
  searchPatternTool,
} from '../tools.js';

let testDir: string;

beforeAll(async () => {
  testDir = path.join(os.tmpdir(), `code-review-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  await fs.writeFile(
    path.join(testDir, 'sample.ts'),
    `// Sample file
export function add(a: number, b: number): number {
  return a + b;
}

export function divide(a: number, b: number): number {
  return a / b;
}

const API_KEY = "sk-secret123456789012";

export function process(data: any) {
  console.log(data);
  return eval(data.expression);
}
`
  );

  await fs.writeFile(
    path.join(testDir, 'helper.ts'),
    `export const VERSION = "1.0.0";

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`
  );

  await fs.writeFile(
    path.join(testDir, 'readme.md'),
    `# Test Project\nThis is a test.`
  );

  setCodeDir(testDir);
});

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// ============================================================
// list_files
// ============================================================

describe('list_files', () => {
  it('应列出所有文件', async () => {
    const result = await listFilesTool.execute({});
    expect(result).toHaveLength(3);
    expect(result.map((f: any) => f.name).sort()).toEqual([
      'helper.ts',
      'readme.md',
      'sample.ts',
    ]);
  });

  it('应按扩展名过滤', async () => {
    const result = await listFilesTool.execute({ extension: '.ts' });
    expect(result).toHaveLength(2);
    for (const file of result as any[]) {
      expect(file.name).toMatch(/\.ts$/);
    }
  });

  it('应包含文件大小和行数', async () => {
    const result = await listFilesTool.execute({ extension: '.ts' });
    for (const file of result as any[]) {
      expect(file.size).toBeGreaterThan(0);
      expect(file.lines).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// read_file
// ============================================================

describe('read_file', () => {
  it('应读取完整文件（带行号）', async () => {
    const result = await readFileTool.execute({ filename: 'helper.ts' }) as string;
    expect(result).toContain('1 | export const VERSION');
    expect(result).toContain('greet');
  });

  it('应支持行号范围', async () => {
    const result = await readFileTool.execute({
      filename: 'sample.ts',
      startLine: 2,
      endLine: 4,
    }) as string;
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('2 |');
    expect(lines[2]).toContain('4 |');
  });

  it('应阻止路径穿越', async () => {
    await expect(
      readFileTool.execute({ filename: '../../../etc/passwd' })
    ).rejects.toThrow('Access denied');
  });

  it('应对不存在的文件抛错', async () => {
    await expect(
      readFileTool.execute({ filename: 'nonexistent.ts' })
    ).rejects.toThrow();
  });
});

// ============================================================
// count_lines
// ============================================================

describe('count_lines', () => {
  it('应统计代码指标', async () => {
    const result = await countLinesTool.execute({ filename: 'sample.ts' }) as any;
    expect(result.totalLines).toBeGreaterThan(10);
    expect(result.codeLines).toBeGreaterThan(0);
    expect(result.commentLines).toBeGreaterThan(0);
    expect(result.functions).toBeGreaterThan(0);
    expect(result.maxNestingDepth).toBeGreaterThanOrEqual(0);
  });

  it('应区分代码行、注释行和空行', async () => {
    const result = await countLinesTool.execute({ filename: 'sample.ts' }) as any;
    expect(result.totalLines).toBe(
      result.codeLines + result.commentLines + result.blankLines
    );
  });
});

// ============================================================
// search_pattern
// ============================================================

describe('search_pattern', () => {
  it('应搜索到 eval 使用', async () => {
    const result = await searchPatternTool.execute({ pattern: 'eval\\(' }) as any[];
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].file).toBe('sample.ts');
    expect(result[0].content).toContain('eval');
  });

  it('应搜索到 any 类型', async () => {
    const result = await searchPatternTool.execute({ pattern: ':\\s*any\\b' }) as any[];
    expect(result.length).toBeGreaterThan(0);
  });

  it('应搜索到硬编码密钥', async () => {
    const result = await searchPatternTool.execute({ pattern: 'API_KEY|sk-' }) as any[];
    expect(result.length).toBeGreaterThan(0);
  });

  it('应支持文件扩展名过滤', async () => {
    const result = await searchPatternTool.execute({
      pattern: '.*',
      fileExtension: '.md',
    }) as any[];
    for (const r of result) {
      expect(r.file).toBe('readme.md');
    }
  });

  it('搜索无结果时应返回提示字符串', async () => {
    const result = await searchPatternTool.execute({ pattern: 'zzz_nonexistent_pattern' });
    expect(typeof result).toBe('string');
    expect(result).toContain('No matches found');
  });
});
