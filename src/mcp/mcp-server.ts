/**
 * MCP Server -- 将 TinyAgent 的工具暴露为 MCP 服务
 *
 * MCP Server 接收 Client 的 JSON-RPC 请求并执行相应操作。
 * 它可以：
 * 1. 暴露工具（tools）
 * 2. 暴露资源（resources）
 * 3. 处理初始化握手
 *
 * 设计：Server 是纯协议层，不关心传输方式。
 * 通过传入不同的 Transport 实现支持 stdio / HTTP / 内存通信。
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18
 */

import type { Transport } from './stdio-transport.js';
import type { Tool, ToolExecutionResult } from '../tools/tool.js';
import { toolToDefinition } from '../tools/tool.js';
import {
  isRequest,
  isNotification,
  createResponse,
  createErrorResponse,
  JSON_RPC_ERRORS,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcId,
} from './json-rpc.js';
import {
  MCP_PROTOCOL_VERSION,
  type InitializeParams,
  type InitializeResult,
  type ServerCapabilities,
  type MCPToolDefinition,
  type ToolCallResult,
  type MCPResource,
  type ResourceReadResult,
} from './mcp-types.js';

// ============================================================
// Server 配置
// ============================================================

export interface MCPServerOptions {
  name: string;
  version: string;
  /** 自定义指令，会在初始化时发送给 Client */
  instructions?: string;
}

// ============================================================
// 资源处理器
// ============================================================

export interface ResourceHandler {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  read: () => Promise<string>;
}

// ============================================================
// MCP Server 实现
// ============================================================

export class MCPServer {
  private transport: Transport | null = null;
  private options: MCPServerOptions;
  private tools = new Map<string, Tool<any, any>>();
  private resources = new Map<string, ResourceHandler>();
  private initialized = false;

  constructor(options: MCPServerOptions) {
    this.options = options;
  }

  // ============================================================
  // 注册工具和资源
  // ============================================================

  /**
   * 注册一个工具。利用 Chapter 02 的 Tool 系统，无缝对接。
   */
  addTool(tool: Tool<any, any>): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * 批量注册工具
   */
  addTools(tools: Tool<any, any>[]): this {
    for (const tool of tools) {
      this.addTool(tool);
    }
    return this;
  }

  /**
   * 注册一个资源
   */
  addResource(handler: ResourceHandler): this {
    this.resources.set(handler.uri, handler);
    return this;
  }

  // ============================================================
  // 启动服务
  // ============================================================

  /**
   * 连接到传输层并开始处理消息
   */
  connect(transport: Transport): void {
    this.transport = transport;
    this.transport.on('message', (msg: JsonRpcMessage) => {
      this.handleMessage(msg).catch((err) => {
        console.error('[MCPServer] Error handling message:', err);
      });
    });
  }

  /**
   * 停止服务
   */
  close(): void {
    this.transport?.close();
    this.transport = null;
    this.initialized = false;
  }

  // ============================================================
  // 消息处理路由
  // ============================================================

  private async handleMessage(msg: JsonRpcMessage): Promise<void> {
    if (isNotification(msg)) {
      this.handleNotification(msg.method);
      return;
    }

    if (!isRequest(msg)) return;

    const request = msg as JsonRpcRequest;

    try {
      const result = await this.routeRequest(request);
      this.send(createResponse(request.id, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send(createErrorResponse(request.id, JSON_RPC_ERRORS.INTERNAL_ERROR, message));
    }
  }

  private async routeRequest(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request.params as unknown as InitializeParams);
      case 'tools/list':
        return this.handleToolsList();
      case 'tools/call':
        return this.handleToolCall(request.params as unknown as { name: string; arguments?: Record<string, unknown> });
      case 'resources/list':
        return this.handleResourcesList();
      case 'resources/read':
        return this.handleResourceRead(request.params as unknown as { uri: string });
      case 'ping':
        return {};
      default:
        throw Object.assign(
          new Error(`Unknown method: ${request.method}`),
          { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND }
        );
    }
  }

  private handleNotification(method: string): void {
    if (method === 'notifications/initialized') {
      this.initialized = true;
    }
  }

  // ============================================================
  // 协议处理
  // ============================================================

  private handleInitialize(_params: InitializeParams): InitializeResult {
    const capabilities: ServerCapabilities = {};

    if (this.tools.size > 0) {
      capabilities.tools = { listChanged: false };
    }
    if (this.resources.size > 0) {
      capabilities.resources = { subscribe: false, listChanged: false };
    }

    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities,
      serverInfo: {
        name: this.options.name,
        version: this.options.version,
      },
      instructions: this.options.instructions,
    };
  }

  private handleToolsList(): { tools: MCPToolDefinition[] } {
    const tools: MCPToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      const def = toolToDefinition(tool);
      tools.push({
        name: def.function.name,
        description: def.function.description,
        inputSchema: def.function.parameters,
      });
    }
    return { tools };
  }

  private async handleToolCall(params: { name: string; arguments?: Record<string, unknown> }): Promise<ToolCallResult> {
    const tool = this.tools.get(params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${params.name}` }],
        isError: true,
      };
    }

    // Zod 参数校验
    const parseResult = tool.parameters.safeParse(params.arguments ?? {});
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return {
        content: [{ type: 'text', text: `Parameter validation failed: ${issues}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.execute(parseResult.data);
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      return {
        content: [{ type: 'text', text }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  }

  private handleResourcesList(): { resources: MCPResource[] } {
    const resources: MCPResource[] = [];
    for (const handler of this.resources.values()) {
      resources.push({
        uri: handler.uri,
        name: handler.name,
        description: handler.description,
        mimeType: handler.mimeType,
      });
    }
    return { resources };
  }

  private async handleResourceRead(params: { uri: string }): Promise<ResourceReadResult> {
    const handler = this.resources.get(params.uri);
    if (!handler) {
      throw new Error(`Resource not found: ${params.uri}`);
    }

    const text = await handler.read();
    return {
      contents: [{
        uri: params.uri,
        mimeType: handler.mimeType ?? 'text/plain',
        text,
      }],
    };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private send(msg: JsonRpcMessage): void {
    this.transport?.send(msg);
  }
}
