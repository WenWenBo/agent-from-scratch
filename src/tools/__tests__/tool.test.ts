/**
 * Tool 定义与 Zod→JSON Schema 转换测试
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineTool, zodToJsonSchema, toolToDefinition } from '../tool.js';

// ============================================================
// zodToJsonSchema 转换测试
// ============================================================

describe('zodToJsonSchema', () => {
  it('应转换基础 string 类型', () => {
    const schema = z.string();
    expect(zodToJsonSchema(schema)).toEqual({ type: 'string' });
  });

  it('应转换带 description 的 string', () => {
    const schema = z.string().describe('用户名');
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'string',
      description: '用户名',
    });
  });

  it('应转换 number 类型', () => {
    const schema = z.number().describe('年龄');
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'number',
      description: '年龄',
    });
  });

  it('应转换 boolean 类型', () => {
    const schema = z.boolean();
    expect(zodToJsonSchema(schema)).toEqual({ type: 'boolean' });
  });

  it('应转换 enum 类型', () => {
    const schema = z.enum(['asc', 'desc']).describe('排序方向');
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'string',
      enum: ['asc', 'desc'],
      description: '排序方向',
    });
  });

  it('应转换 array 类型', () => {
    const schema = z.array(z.string()).describe('标签列表');
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: '标签列表',
    });
  });

  it('应转换简单 object', () => {
    const schema = z.object({
      name: z.string().describe('姓名'),
      age: z.number().describe('年龄'),
    });

    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', description: '姓名' },
        age: { type: 'number', description: '年龄' },
      },
      required: ['name', 'age'],
    });
  });

  it('应正确处理可选字段（不出现在 required 中）', () => {
    const schema = z.object({
      query: z.string().describe('搜索词'),
      limit: z.number().optional().describe('返回数量'),
    });

    const result = zodToJsonSchema(schema);
    expect(result.required).toEqual(['query']);
  });

  it('应转换嵌套 object', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string(),
      }),
    });

    const result = zodToJsonSchema(schema) as any;
    expect(result.properties.user.type).toBe('object');
    expect(result.properties.user.properties.name.type).toBe('string');
    expect(result.properties.user.required).toEqual(['name', 'email']);
  });

  it('应处理带默认值的字段', () => {
    const schema = z.object({
      page: z.number().default(1),
      query: z.string(),
    });

    const result = zodToJsonSchema(schema);
    expect(result.required).toEqual(['query']);
  });
});

// ============================================================
// defineTool 测试
// ============================================================

describe('defineTool', () => {
  it('应返回与输入相同的 Tool 对象', () => {
    const tool = defineTool({
      name: 'test_tool',
      description: '测试工具',
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => input.toUpperCase(),
    });

    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBe('测试工具');
    expect(typeof tool.execute).toBe('function');
  });
});

// ============================================================
// toolToDefinition 测试
// ============================================================

describe('toolToDefinition', () => {
  it('应生成 LLM 需要的 ToolDefinition 格式', () => {
    const tool = defineTool({
      name: 'get_weather',
      description: '获取天气',
      parameters: z.object({
        city: z.string().describe('城市名'),
        unit: z.enum(['celsius', 'fahrenheit']).optional().describe('温度单位'),
      }),
      execute: async () => ({ temp: 22 }),
    });

    const def = toolToDefinition(tool);

    expect(def.type).toBe('function');
    expect(def.function.name).toBe('get_weather');
    expect(def.function.description).toBe('获取天气');
    expect(def.function.parameters).toEqual({
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: '温度单位',
        },
      },
      required: ['city'],
    });
  });
});
