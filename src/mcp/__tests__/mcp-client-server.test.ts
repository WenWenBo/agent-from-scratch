/**
 * MCP Client ↔ Server 端到端测试
 * 使用 InMemoryTransport 模拟通信
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { MCPClient } from '../mcp-client.js';
import { MCPServer } from '../mcp-server.js';
import { InMemoryTransport } from '../stdio-transport.js';
import { defineTool } from '../../tools/tool.js';
import { MCP_PROTOCOL_VERSION } from '../mcp-types.js';

// ============================================================
// 测试用工具
// ============================================================

const calculatorTool = defineTool({
  name: 'calculator',
  description: 'Performs basic math',
  parameters: z.object({
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
    op: z.enum(['+', '-', '*', '/']).describe('Operator'),
  }),
  execute: async ({ a, b, op }) => {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? 'Division by zero' : a / b;
    }
  },
});

const greetTool = defineTool({
  name: 'greet',
  description: 'Generates a greeting',
  parameters: z.object({
    name: z.string().describe('Name to greet'),
    style: z.enum(['formal', 'casual']).optional().describe('Greeting style'),
  }),
  execute: async ({ name, style }) => {
    if (style === 'formal') return `Good day, ${name}.`;
    return `Hey ${name}!`;
  },
});

const failTool = defineTool({
  name: 'fail_tool',
  description: 'Always throws an error',
  parameters: z.object({}),
  execute: async () => {
    throw new Error('Intentional failure');
  },
});

// ============================================================
// 测试套件
// ============================================================

describe('MCP Client ↔ Server', () => {
  let client: MCPClient;
  let server: MCPServer;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createPair();

    server = new MCPServer({
      name: 'TestServer',
      version: '1.0.0',
      instructions: 'Test MCP server for unit testing',
    });
    server.addTools([calculatorTool, greetTool, failTool]);
    server.addResource({
      uri: 'file:///test.txt',
      name: 'test.txt',
      description: 'A test file',
      mimeType: 'text/plain',
      read: async () => 'Hello, MCP!',
    });
    server.connect(serverTransport);

    client = new MCPClient(clientTransport, {
      clientName: 'TestClient',
      clientVersion: '1.0.0',
      requestTimeout: 5000,
    });
  });

  afterEach(() => {
    client.disconnect();
    server.close();
  });

  // ============================================================
  // 初始化
  // ============================================================

  describe('初始化握手', () => {
    it('应完成完整的 initialize → initialized 流程', async () => {
      const result = await client.connect();

      expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
      expect(result.serverInfo.name).toBe('TestServer');
      expect(result.serverInfo.version).toBe('1.0.0');
      expect(result.instructions).toBe('Test MCP server for unit testing');
      expect(result.capabilities.tools).toBeDefined();
      expect(result.capabilities.resources).toBeDefined();

      expect(client.isConnected).toBe(true);
      expect(client.server?.name).toBe('TestServer');
    });
  });

  // ============================================================
  // 工具
  // ============================================================

  describe('工具操作', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('应列出所有工具', async () => {
      const tools = await client.listTools();

      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name).sort()).toEqual(['calculator', 'fail_tool', 'greet']);

      const calc = tools.find((t) => t.name === 'calculator')!;
      expect(calc.description).toBe('Performs basic math');
      expect(calc.inputSchema).toBeDefined();
      expect((calc.inputSchema as any).properties?.a).toBeDefined();
    });

    it('应正确调用 calculator 工具', async () => {
      const result = await client.callTool('calculator', { a: 6, b: 7, op: '*' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: 'text', text: '42' });
    });

    it('应正确调用 greet 工具（含可选参数）', async () => {
      const casual = await client.callTool('greet', { name: 'Alice' });
      expect(casual.content[0]).toEqual({ type: 'text', text: 'Hey Alice!' });

      const formal = await client.callTool('greet', { name: 'Bob', style: 'formal' });
      expect(formal.content[0]).toEqual({ type: 'text', text: 'Good day, Bob.' });
    });

    it('调用不存在的工具应返回 isError', async () => {
      const result = await client.callTool('nonexistent', {});
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('Unknown tool'),
      });
    });

    it('参数校验失败应返回 isError', async () => {
      const result = await client.callTool('calculator', { a: 'not-a-number', b: 2, op: '+' });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('validation failed'),
      });
    });

    it('工具执行异常应返回 isError', async () => {
      const result = await client.callTool('fail_tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: 'Intentional failure',
      });
    });
  });

  // ============================================================
  // 资源
  // ============================================================

  describe('资源操作', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('应列出所有资源', async () => {
      const resources = await client.listResources();

      expect(resources).toHaveLength(1);
      expect(resources[0]).toMatchObject({
        uri: 'file:///test.txt',
        name: 'test.txt',
        mimeType: 'text/plain',
      });
    });

    it('应读取资源内容', async () => {
      const result = await client.readResource('file:///test.txt');

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({
        uri: 'file:///test.txt',
        text: 'Hello, MCP!',
      });
    });
  });

  // ============================================================
  // 错误场景
  // ============================================================

  describe('错误处理', () => {
    it('未连接时调用应抛异常', async () => {
      await expect(client.listTools()).rejects.toThrow('not connected');
    });

    it('断开后应清理状态', async () => {
      await client.connect();
      expect(client.isConnected).toBe(true);

      client.disconnect();
      expect(client.isConnected).toBe(false);
    });
  });

  // ============================================================
  // Ping
  // ============================================================

  describe('Ping', () => {
    it('Server 应响应 ping 请求', async () => {
      await client.connect();
      // 直接发送原始请求测试 ping
      const { createRequest } = await import('../json-rpc.js');
      const pingReq = createRequest('ping');

      const responsePromise = new Promise<unknown>((resolve) => {
        clientTransport.on('message', (msg: any) => {
          if (msg.id === pingReq.id) resolve(msg.result);
        });
      });

      clientTransport.send(pingReq);
      const result = await responsePromise;
      expect(result).toEqual({});
    });
  });
});
