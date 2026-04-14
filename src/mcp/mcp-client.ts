/**
 * MCP Client -- 连接外部 MCP Server，发现并调用其工具
 *
 * MCP Client 是 Host（LLM 应用）与 MCP Server 之间的桥梁。
 * 它负责：
 * 1. 建立连接并完成初始化握手
 * 2. 发现 Server 暴露的工具、资源、提示词
 * 3. 调用工具并返回结果
 *
 * 流程：
 *   connect() → initialize handshake → listTools() → callTool()
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
 */

import type { Transport } from './stdio-transport.js';
import {
  createRequest,
  createNotification,
  isResponse,
  type JsonRpcMessage,
  type JsonRpcResponse,
  type JsonRpcId,
} from './json-rpc.js';
import {
  MCP_PROTOCOL_VERSION,
  type InitializeParams,
  type InitializeResult,
  type ServerCapabilities,
  type MCPToolDefinition,
  type ToolCallParams,
  type ToolCallResult,
  type MCPResource,
  type ResourceReadResult,
} from './mcp-types.js';

// ============================================================
// MCP Client 配置
// ============================================================

export interface MCPClientOptions {
  /** Client 名称（用于 initialize 握手） */
  clientName?: string;
  /** Client 版本 */
  clientVersion?: string;
  /** 请求超时时间（毫秒），默认 30000 */
  requestTimeout?: number;
}

// ============================================================
// MCP Client 实现
// ============================================================

export class MCPClient {
  private transport: Transport;
  private options: MCPClientOptions;
  private serverCapabilities: ServerCapabilities | null = null;
  private serverInfo: { name: string; version: string } | null = null;
  private pendingRequests = new Map<JsonRpcId, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private connected = false;

  constructor(transport: Transport, options?: MCPClientOptions) {
    this.transport = transport;
    this.options = {
      clientName: options?.clientName ?? 'TinyAgent',
      clientVersion: options?.clientVersion ?? '0.1.0',
      requestTimeout: options?.requestTimeout ?? 30_000,
    };

    this.transport.on('message', (msg: JsonRpcMessage) => {
      this.handleMessage(msg);
    });

    this.transport.on('error', (err: Error) => {
      // 向所有等待中的请求传播错误
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(err);
      }
      this.pendingRequests.clear();
    });
  }

  // ============================================================
  // 连接生命周期
  // ============================================================

  /**
   * 初始化与 MCP Server 的连接
   * 执行完整的握手流程：initialize request → response → initialized notification
   */
  async connect(): Promise<InitializeResult> {
    const params: InitializeParams = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: false },
      },
      clientInfo: {
        name: this.options.clientName!,
        version: this.options.clientVersion!,
      },
    };

    const result = await this.sendRequest('initialize', params) as InitializeResult;

    this.serverCapabilities = result.capabilities;
    this.serverInfo = result.serverInfo;
    this.connected = true;

    // 发送 initialized 通知
    this.transport.send(createNotification('notifications/initialized'));

    return result;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.connected = false;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();
    this.transport.close();
  }

  // ============================================================
  // 工具操作
  // ============================================================

  /**
   * 列出 Server 暴露的所有工具
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    this.assertConnected();
    const result = await this.sendRequest('tools/list', {}) as { tools: MCPToolDefinition[] };
    return result.tools;
  }

  /**
   * 调用 Server 上的一个工具
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    this.assertConnected();
    const params: ToolCallParams = { name, arguments: args };
    return await this.sendRequest('tools/call', params as unknown as Record<string, unknown>) as ToolCallResult;
  }

  // ============================================================
  // 资源操作
  // ============================================================

  /**
   * 列出 Server 暴露的所有资源
   */
  async listResources(): Promise<MCPResource[]> {
    this.assertConnected();
    const result = await this.sendRequest('resources/list', {}) as { resources: MCPResource[] };
    return result.resources;
  }

  /**
   * 读取一个资源的内容
   */
  async readResource(uri: string): Promise<ResourceReadResult> {
    this.assertConnected();
    return await this.sendRequest('resources/read', { uri }) as ResourceReadResult;
  }

  // ============================================================
  // 访问器
  // ============================================================

  get isConnected(): boolean {
    return this.connected;
  }

  get capabilities(): ServerCapabilities | null {
    return this.serverCapabilities;
  }

  get server(): { name: string; version: string } | null {
    return this.serverInfo;
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const request = createRequest(method, params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request "${method}" timed out after ${this.options.requestTimeout}ms`));
      }, this.options.requestTimeout);

      this.pendingRequests.set(request.id, { resolve, reject, timer });
      this.transport.send(request);
    });
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (isResponse(msg)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);

        if (msg.error) {
          pending.reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
    // 来自 Server 的请求/通知可以在后续扩展中处理
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error('MCP Client is not connected. Call connect() first.');
    }
  }
}
