/**
 * 示例：MCP 协议 -- Client ↔ Server 通信
 *
 * 展示四种使用方式：
 * 1. 启动 MCP Server 暴露本地工具
 * 2. MCP Client 连接并发现/调用远程工具
 * 3. 远程工具适配为 ToolRegistry（无缝集成 Agent）
 * 4. 连接外部 MCP Server（stdio 传输）
 */

import { z } from 'zod';
import {
  defineTool,
  MCPServer,
  MCPClient,
  InMemoryTransport,
  discoverMCPTools,
  ToolRegistry,
} from '../src/index.js';

async function main() {
  // ========================================================
  // 场景 1: 创建 MCP Server
  // ========================================================
  console.log('=== 场景 1: 创建 MCP Server ===\n');

  const server = new MCPServer({
    name: 'MathServer',
    version: '1.0.0',
    instructions: 'A server providing math tools',
  });

  server.addTool(defineTool({
    name: 'add',
    description: 'Adds two numbers',
    parameters: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
    execute: async ({ a, b }) => a + b,
  }));

  server.addTool(defineTool({
    name: 'multiply',
    description: 'Multiplies two numbers',
    parameters: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
    execute: async ({ a, b }) => a * b,
  }));

  server.addResource({
    uri: 'file:///docs/readme.txt',
    name: 'readme.txt',
    description: 'Server documentation',
    mimeType: 'text/plain',
    read: async () => 'This is the MathServer readme. It provides add and multiply tools.',
  });

  console.log('Server created with 2 tools and 1 resource\n');

  // ========================================================
  // 场景 2: MCP Client 连接
  // ========================================================
  console.log('=== 场景 2: Client 连接并调用工具 ===\n');

  const [clientTransport, serverTransport] = InMemoryTransport.createPair();
  server.connect(serverTransport);

  const client = new MCPClient(clientTransport, {
    clientName: 'DemoClient',
    clientVersion: '1.0.0',
  });

  const initResult = await client.connect();
  console.log(`Connected to: ${initResult.serverInfo.name} v${initResult.serverInfo.version}`);
  console.log(`Capabilities: ${JSON.stringify(initResult.capabilities)}\n`);

  const tools = await client.listTools();
  console.log(`Found ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description}`);
  }

  const addResult = await client.callTool('add', { a: 10, b: 20 });
  console.log(`\nadd(10, 20) = ${addResult.content[0]!.type === 'text' ? addResult.content[0].text : ''}`);

  const mulResult = await client.callTool('multiply', { a: 6, b: 7 });
  console.log(`multiply(6, 7) = ${mulResult.content[0]!.type === 'text' ? mulResult.content[0].text : ''}`);

  const resources = await client.listResources();
  console.log(`\nFound ${resources.length} resource(s):`);
  for (const r of resources) {
    console.log(`  - ${r.uri}: ${r.name}`);
  }

  const readResult = await client.readResource('file:///docs/readme.txt');
  console.log(`\nResource content: ${readResult.contents[0]?.text}\n`);

  // ========================================================
  // 场景 3: 远程工具 → ToolRegistry（Agent 集成）
  // ========================================================
  console.log('=== 场景 3: 远程工具适配到 ToolRegistry ===\n');

  const remoteTools = await discoverMCPTools(client, 'math');

  const localTool = defineTool({
    name: 'greet',
    description: 'Generates a greeting',
    parameters: z.object({ name: z.string() }),
    execute: async ({ name }) => `Hello, ${name}!`,
  });

  const registry = new ToolRegistry();
  registry.register(localTool);
  registry.registerMany(remoteTools);

  console.log(`Registry has ${registry.size} tools (${remoteTools.length} remote + 1 local):`);
  const defs = registry.toDefinitions();
  for (const def of defs) {
    const isRemote = def.function.name.startsWith('math_');
    console.log(`  - ${def.function.name} [${isRemote ? 'REMOTE' : 'LOCAL'}]: ${def.function.description}`);
  }

  // Agent 通过 registry 调用远程工具（完全不知道是远程的）
  const execResult = await registry.execute({
    id: 'call-1',
    function: { name: 'math_add', arguments: '{"a": 100, "b": 200}' },
  });
  console.log(`\nAgent executes math_add(100, 200) = ${execResult.result}`);

  // 清理
  client.disconnect();
  server.close();
  console.log('\nDone!');
}

main().catch(console.error);
