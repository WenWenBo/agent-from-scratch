/**
 * MCP Tool Adapter 测试
 * 验证 JSON Schema → Zod 转换，以及 MCP 工具到本地工具的适配
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod, adaptMCPTool, discoverMCPTools } from '../mcp-tool-adapter.js';
import { MCPClient } from '../mcp-client.js';
import { MCPServer } from '../mcp-server.js';
import { InMemoryTransport } from '../stdio-transport.js';
import { ToolRegistry } from '../../tools/registry.js';
import { defineTool } from '../../tools/tool.js';

// ============================================================
// jsonSchemaToZod 测试
// ============================================================

describe('jsonSchemaToZod', () => {
  it('应转换 string 类型', () => {
    const schema = jsonSchemaToZod({ type: 'string', description: 'A name' });
    expect(schema.parse('hello')).toBe('hello');
    expect(() => schema.parse(123)).toThrow();
  });

  it('应转换 number 类型', () => {
    const schema = jsonSchemaToZod({ type: 'number' });
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse('not-a-number')).toThrow();
  });

  it('应转换 integer 类型', () => {
    const schema = jsonSchemaToZod({ type: 'integer' });
    expect(schema.parse(42)).toBe(42);
  });

  it('应转换 boolean 类型', () => {
    const schema = jsonSchemaToZod({ type: 'boolean' });
    expect(schema.parse(true)).toBe(true);
    expect(() => schema.parse('yes')).toThrow();
  });

  it('应转换 string enum', () => {
    const schema = jsonSchemaToZod({ type: 'string', enum: ['a', 'b', 'c'] });
    expect(schema.parse('a')).toBe('a');
    expect(() => schema.parse('d')).toThrow();
  });

  it('应转换 array 类型', () => {
    const schema = jsonSchemaToZod({
      type: 'array',
      items: { type: 'string' },
    });
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(() => schema.parse([1, 2])).toThrow();
  });

  it('应转换 object 类型（含 required）', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'User name' },
        age: { type: 'number' },
      },
      required: ['name'],
    });

    expect(schema.parse({ name: 'Alice' })).toEqual({ name: 'Alice' });
    expect(schema.parse({ name: 'Bob', age: 30 })).toEqual({ name: 'Bob', age: 30 });
    expect(() => schema.parse({ age: 25 })).toThrow();
  });

  it('应处理嵌套 object', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        address: {
          type: 'object',
          properties: {
            city: { type: 'string' },
          },
          required: ['city'],
        },
      },
      required: ['address'],
    });

    expect(schema.parse({ address: { city: 'NYC' } })).toEqual({ address: { city: 'NYC' } });
  });

  it('未知类型应退化为 z.any()', () => {
    const schema = jsonSchemaToZod({ type: 'custom_type' });
    expect(schema.parse('anything')).toBe('anything');
    expect(schema.parse(42)).toBe(42);
  });
});

// ============================================================
// adaptMCPTool 测试
// ============================================================

describe('adaptMCPTool', () => {
  let client: MCPClient;
  let server: MCPServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createPair();

    server = new MCPServer({ name: 'TestServer', version: '1.0.0' });
    server.addTool(defineTool({
      name: 'multiply',
      description: 'Multiplies two numbers',
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({ a, b }) => a * b,
    }));
    server.connect(serverTransport);

    client = new MCPClient(clientTransport);
    await client.connect();
  });

  afterEach(() => {
    client.disconnect();
    server.close();
  });

  it('应将 MCP 工具适配为本地 Tool', async () => {
    const tools = await client.listTools();
    const localTool = adaptMCPTool(client, tools[0]!);

    expect(localTool.name).toBe('multiply');
    expect(localTool.description).toBe('Multiplies two numbers');

    const result = await localTool.execute({ a: 6, b: 7 });
    expect(result).toBe('42');
  });

  it('带 namePrefix 时应拼接前缀', async () => {
    const tools = await client.listTools();
    const localTool = adaptMCPTool(client, tools[0]!, 'math_server');

    expect(localTool.name).toBe('math_server_multiply');
  });

  it('MCP 工具执行失败应抛异常', async () => {
    server.addTool(defineTool({
      name: 'fail',
      description: 'Fails',
      parameters: z.object({}),
      execute: async () => { throw new Error('boom'); },
    }));

    const tools = await client.listTools();
    const failTool = adaptMCPTool(client, tools.find((t) => t.name === 'fail')!);

    await expect(failTool.execute({})).rejects.toThrow('boom');
  });
});

// ============================================================
// discoverMCPTools 测试
// ============================================================

describe('discoverMCPTools', () => {
  let client: MCPClient;
  let server: MCPServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createPair();

    server = new MCPServer({ name: 'ToolServer', version: '1.0.0' });
    server.addTools([
      defineTool({
        name: 'add',
        description: 'Adds numbers',
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => a + b,
      }),
      defineTool({
        name: 'concat',
        description: 'Concatenates strings',
        parameters: z.object({ parts: z.array(z.string()) }),
        execute: async ({ parts }) => parts.join(''),
      }),
    ]);
    server.connect(serverTransport);

    client = new MCPClient(clientTransport);
    await client.connect();
  });

  afterEach(() => {
    client.disconnect();
    server.close();
  });

  it('应发现并适配所有远程工具', async () => {
    const tools = await discoverMCPTools(client);

    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(['add', 'concat']);
  });

  it('适配后的工具应能注册到 ToolRegistry', async () => {
    const tools = await discoverMCPTools(client, 'remote');
    const registry = new ToolRegistry();
    registry.registerMany(tools);

    expect(registry.size).toBe(2);
    expect(registry.has('remote_add')).toBe(true);
    expect(registry.has('remote_concat')).toBe(true);

    // 通过 ToolRegistry 执行远程工具
    const result = await registry.execute({
      id: 'call-1',
      function: { name: 'remote_add', arguments: '{"a": 10, "b": 20}' },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('30');
  });

  it('本地工具和远程工具应可共存于同一 Registry', async () => {
    const remoteTools = await discoverMCPTools(client, 'remote');

    const localTool = defineTool({
      name: 'local_greet',
      description: 'Local greeting',
      parameters: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    });

    const registry = new ToolRegistry();
    registry.register(localTool);
    registry.registerMany(remoteTools);

    expect(registry.size).toBe(3);

    // 验证 Schema 导出（给 LLM 看的 ToolDefinition）
    const definitions = registry.toDefinitions();
    expect(definitions).toHaveLength(3);
    expect(definitions.map((d) => d.function.name).sort()).toEqual([
      'local_greet', 'remote_add', 'remote_concat'
    ]);
  });
});
