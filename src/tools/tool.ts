/**
 * Tool 定义与创建
 * 使用 Zod 定义参数 Schema，实现类型安全的工具系统
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

// ============================================================
// 核心类型
// ============================================================

export interface Tool<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<TParams>;
  execute: (params: TParams) => Promise<TResult>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

// ============================================================
// 工具创建函数 -- defineTool
// ============================================================

/**
 * 类型安全的工具定义函数
 * 通过 Zod Schema 同时获得：
 *   1. 运行时参数校验
 *   2. TypeScript 类型推导
 *   3. JSON Schema 导出（给 LLM 看）
 *
 * @example
 * const calculator = defineTool({
 *   name: 'calculator',
 *   description: '计算数学表达式',
 *   parameters: z.object({
 *     expression: z.string().describe('数学表达式'),
 *   }),
 *   execute: async ({ expression }) => {
 *     return eval(expression);
 *   },
 * });
 */
export function defineTool<TParams, TResult>(
  config: Tool<TParams, TResult>
): Tool<TParams, TResult> {
  return config;
}

// ============================================================
// Zod → JSON Schema 转换
// ============================================================

/**
 * 将 Zod Schema 转换为 JSON Schema（LLM Function Calling 要求的格式）
 *
 * 为什么不用 zod-to-json-schema 库？
 * 教学目的：手写让你理解 JSON Schema 的结构，且覆盖 Agent 场景常用的子集即可。
 * 生产环境中可以替换为 zod-to-json-schema 获得更完整的支持。
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convertZodType(schema);
}

function convertZodType(schema: z.ZodType): Record<string, unknown> {
  const def = schema._def as Record<string, any>;
  const typeName = def.typeName as string;

  switch (typeName) {
    case 'ZodObject':
      return convertZodObject(schema as z.ZodObject<any>);
    case 'ZodString':
      return withDescription({ type: 'string' }, schema);
    case 'ZodNumber':
      return withDescription({ type: 'number' }, schema);
    case 'ZodBoolean':
      return withDescription({ type: 'boolean' }, schema);
    case 'ZodArray':
      return withDescription(
        { type: 'array', items: convertZodType((def as any).type) },
        schema
      );
    case 'ZodEnum':
      return withDescription(
        { type: 'string', enum: (def as any).values },
        schema
      );
    case 'ZodOptional': {
      const inner = convertZodType((def as any).innerType);
      return withDescription(inner, schema);
    }
    case 'ZodDefault':
      return convertZodType((def as any).innerType);
    case 'ZodNullable': {
      const inner = convertZodType((def as any).innerType);
      return { ...inner, nullable: true };
    }
    case 'ZodLiteral':
      return withDescription(
        { type: typeof (def as any).value, const: (def as any).value },
        schema
      );
    case 'ZodUnion': {
      const options = (def as any).options.map((o: z.ZodType) => convertZodType(o));
      return { anyOf: options };
    }
    default:
      return { type: 'string' };
  }
}

function convertZodObject(schema: z.ZodObject<any>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodValue = value as z.ZodType;
    properties[key] = convertZodType(zodValue);

    if (!isOptional(zodValue)) {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return withDescription(result, schema);
}

function isOptional(schema: z.ZodType): boolean {
  const typeName = (schema._def as Record<string, any>).typeName as string;
  if (typeName === 'ZodOptional') return true;
  if (typeName === 'ZodDefault') return true;
  return false;
}

function withDescription(
  obj: Record<string, unknown>,
  schema: z.ZodType
): Record<string, unknown> {
  const description = schema._def.description;
  if (description) {
    obj.description = description;
  }
  return obj;
}

// ============================================================
// Tool → ToolDefinition 转换
// ============================================================

/**
 * 将内部 Tool 对象转换为 LLM API 需要的 ToolDefinition 格式
 */
export function toolToDefinition(tool: Tool<any, any>): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
    },
  };
}
