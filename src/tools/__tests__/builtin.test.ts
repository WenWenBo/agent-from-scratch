/**
 * 内置工具测试
 */

import { describe, it, expect } from 'vitest';
import { calculatorTool, currentTimeTool, jsonExtractTool, stringTool } from '../builtin.js';

describe('calculatorTool', () => {
  it('应计算基础加法', async () => {
    const result = await calculatorTool.execute({ expression: '2 + 3' });
    expect(result.result).toBe(5);
  });

  it('应支持运算优先级', async () => {
    const result = await calculatorTool.execute({ expression: '2 + 3 * 4' });
    expect(result.result).toBe(14);
  });

  it('应支持括号', async () => {
    const result = await calculatorTool.execute({ expression: '(2 + 3) * 4' });
    expect(result.result).toBe(20);
  });

  it('应支持幂运算（^）', async () => {
    const result = await calculatorTool.execute({ expression: '2 ^ 10' });
    expect(result.result).toBe(1024);
  });

  it('应拒绝包含非法字符的表达式', async () => {
    await expect(
      calculatorTool.execute({ expression: 'require("fs")' })
    ).rejects.toThrow('invalid characters');
  });

  it('应返回原始表达式和结果', async () => {
    const result = await calculatorTool.execute({ expression: '100 / 4' });
    expect(result).toEqual({ expression: '100 / 4', result: 25 });
  });
});

describe('currentTimeTool', () => {
  it('应返回 ISO 格式时间', async () => {
    const result = await currentTimeTool.execute({});
    expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('应支持指定时区', async () => {
    const result = await currentTimeTool.execute({ timezone: 'Asia/Shanghai' });
    expect(result.formatted).toBeTruthy();
  });
});

describe('jsonExtractTool', () => {
  it('应提取顶层字段', async () => {
    const result = await jsonExtractTool.execute({
      json: '{"name":"Alice","age":30}',
      path: 'name',
    });
    expect(result.value).toBe('Alice');
    expect(result.found).toBe(true);
  });

  it('应提取嵌套字段', async () => {
    const result = await jsonExtractTool.execute({
      json: '{"user":{"profile":{"city":"北京"}}}',
      path: 'user.profile.city',
    });
    expect(result.value).toBe('北京');
  });

  it('应提取数组元素', async () => {
    const result = await jsonExtractTool.execute({
      json: '{"items":[{"title":"A"},{"title":"B"}]}',
      path: 'items.1.title',
    });
    expect(result.value).toBe('B');
  });

  it('路径不存在应返回 found=false', async () => {
    const result = await jsonExtractTool.execute({
      json: '{"a":1}',
      path: 'b.c',
    });
    expect(result.found).toBe(false);
  });
});

describe('stringTool', () => {
  it('应计算长度', async () => {
    const result = await stringTool.execute({ text: 'hello', operation: 'length' });
    expect(result.result).toBe(5);
  });

  it('应转大写', async () => {
    const result = await stringTool.execute({ text: 'hello', operation: 'uppercase' });
    expect(result.result).toBe('HELLO');
  });

  it('应转小写', async () => {
    const result = await stringTool.execute({ text: 'HELLO', operation: 'lowercase' });
    expect(result.result).toBe('hello');
  });

  it('应反转字符串', async () => {
    const result = await stringTool.execute({ text: 'abc', operation: 'reverse' });
    expect(result.result).toBe('cba');
  });

  it('应统计单词数', async () => {
    const result = await stringTool.execute({
      text: 'hello world foo bar',
      operation: 'word_count',
    });
    expect(result.result).toBe(4);
  });
});
