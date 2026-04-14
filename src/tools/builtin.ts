/**
 * 内置工具集合
 * 提供开箱即用的常用工具，同时作为自定义工具的参考范例
 */

import { z } from 'zod';
import { defineTool } from './tool.js';

/**
 * 计算器工具 -- 安全执行数学表达式
 * 使用 Function 构造器而非 eval，限制只能执行数学运算
 */
export const calculatorTool = defineTool({
  name: 'calculator',
  description: '计算数学表达式的结果。支持加减乘除、括号、幂运算等。输入示例: "2 + 3 * 4", "(10 - 3) ** 2"',
  parameters: z.object({
    expression: z.string().describe('要计算的数学表达式'),
  }),
  execute: async ({ expression }) => {
    const sanitized = expression.replace(/[^0-9+\-*/().%\s^]/g, '');
    if (sanitized !== expression) {
      throw new Error(`Expression contains invalid characters: ${expression}`);
    }
    const jsExpression = sanitized.replace(/\^/g, '**');
    const fn = new Function(`return (${jsExpression})`);
    const result = fn() as number;
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error(`Invalid result: ${result}`);
    }
    return { expression, result };
  },
});

/**
 * 当前时间工具
 */
export const currentTimeTool = defineTool({
  name: 'current_time',
  description: '获取当前的日期和时间',
  parameters: z.object({
    timezone: z
      .string()
      .optional()
      .describe('时区，如 "Asia/Shanghai"、"America/New_York"，默认 UTC'),
  }),
  execute: async ({ timezone }) => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: timezone ?? 'UTC',
    };
    return {
      formatted: new Intl.DateTimeFormat('zh-CN', options).format(now),
      iso: now.toISOString(),
      timestamp: now.getTime(),
    };
  },
});

/**
 * JSON 处理工具 -- 从 JSON 中提取指定路径的值
 */
export const jsonExtractTool = defineTool({
  name: 'json_extract',
  description: '从 JSON 字符串中提取指定路径的值。路径用点号分隔，如 "user.name" 或 "items.0.title"',
  parameters: z.object({
    json: z.string().describe('JSON 字符串'),
    path: z.string().describe('要提取的路径，用点号分隔'),
  }),
  execute: async ({ json, path }) => {
    const obj = JSON.parse(json);
    const parts = path.split('.');
    let current: any = obj;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return { path, value: null, found: false };
      }
      current = current[part];
    }
    return { path, value: current, found: current !== undefined };
  },
});

/**
 * 字符串处理工具
 */
export const stringTool = defineTool({
  name: 'string_utils',
  description: '字符串处理工具，支持统计字数、截取、替换、大小写转换等操作',
  parameters: z.object({
    text: z.string().describe('要处理的文本'),
    operation: z
      .enum(['length', 'uppercase', 'lowercase', 'reverse', 'trim', 'word_count'])
      .describe('操作类型'),
  }),
  execute: async ({ text, operation }) => {
    switch (operation) {
      case 'length':
        return { result: text.length };
      case 'uppercase':
        return { result: text.toUpperCase() };
      case 'lowercase':
        return { result: text.toLowerCase() };
      case 'reverse':
        return { result: [...text].reverse().join('') };
      case 'trim':
        return { result: text.trim() };
      case 'word_count':
        return { result: text.split(/\s+/).filter(Boolean).length };
    }
  },
});
