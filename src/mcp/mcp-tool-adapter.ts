/**
 * MCP Tool Adapter -- 将 MCP Server 的远程工具适配为本地 Tool
 *
 * 这是整个 MCP 集成的关键桥梁：
 * - 从 MCP Server 发现远程工具（tools/list）
 * - 将远程工具转换为 Chapter 02 的 Tool 接口
 * - 注册到 ToolRegistry，让 Agent 可以无缝使用
 *
 * Agent 完全不知道工具是本地的还是远程 MCP Server 提供的。
 *
 * 架构图：
 *   Agent → ToolRegistry → [LocalTool, MCPTool, MCPTool, ...]
 *                                       ↓          ↓
 *                                   MCP Client → MCP Server A
 *                                   MCP Client → MCP Server B
 */

import { z } from 'zod';
import type { Tool } from '../tools/tool.js';
import type { MCPClient } from './mcp-client.js';
import type { MCPToolDefinition, ToolCallResult } from './mcp-types.js';

// ============================================================
// JSON Schema → Zod 转换（反向）
// ============================================================

/**
 * 将 JSON Schema 转换为 Zod Schema
 * 与 Chapter 02 的 zodToJsonSchema 互为逆操作
 *
 * 覆盖 Agent 场景常用的子集：
 * object, string, number, boolean, array, enum
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string | undefined;

  switch (type) {
    case 'object':
      return convertObjectSchema(schema);
    case 'string': {
      let s: z.ZodType = z.string();
      if (schema.enum) {
        s = z.enum(schema.enum as [string, ...string[]]);
      }
      if (schema.description) {
        s = s.describe(schema.description as string);
      }
      return s;
    }
    case 'number':
    case 'integer': {
      let n: z.ZodType = z.number();
      if (schema.description) {
        n = n.describe(schema.description as string);
      }
      return n;
    }
    case 'boolean': {
      let b: z.ZodType = z.boolean();
      if (schema.description) {
        b = b.describe(schema.description as string);
      }
      return b;
    }
    case 'array': {
      const items = (schema.items as Record<string, unknown>) ?? {};
      let a: z.ZodType = z.array(jsonSchemaToZod(items));
      if (schema.description) {
        a = a.describe(schema.description as string);
      }
      return a;
    }
    default:
      return z.any();
  }
}

function convertObjectSchema(schema: Record<string, unknown>): z.ZodObject<any> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);

  const shape: Record<string, z.ZodType> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    let zodType = jsonSchemaToZod(propSchema);
    if (!required.has(key)) {
      zodType = zodType.optional();
    }
    shape[key] = zodType;
  }

  let obj = z.object(shape);
  if (schema.description) {
    obj = obj.describe(schema.description as string) as any;
  }
  return obj;
}

// ============================================================
// MCP Tool → Local Tool 适配
// ============================================================

/**
 * 将单个 MCP Tool 定义转换为本地 Tool 对象
 * 调用时通过 MCPClient 远程执行
 */
export function adaptMCPTool(
  client: MCPClient,
  mcpTool: MCPToolDefinition,
  namePrefix?: string
): Tool<any, string> {
  const toolName = namePrefix
    ? `${namePrefix}_${mcpTool.name}`
    : mcpTool.name;

  return {
    name: toolName,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
    parameters: jsonSchemaToZod(mcpTool.inputSchema),
    execute: async (params: Record<string, unknown>): Promise<string> => {
      const result: ToolCallResult = await client.callTool(mcpTool.name, params);

      if (result.isError) {
        const errorText = result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        throw new Error(errorText || 'MCP tool execution failed');
      }

      return result.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
    },
  };
}

/**
 * 从 MCPClient 发现所有远程工具，并批量适配为本地 Tool
 * 可指定 namePrefix 避免多个 Server 的工具名冲突
 */
export async function discoverMCPTools(
  client: MCPClient,
  namePrefix?: string
): Promise<Tool<any, string>[]> {
  const mcpTools = await client.listTools();
  return mcpTools.map((t) => adaptMCPTool(client, t, namePrefix));
}
