/**
 * MCP 模块导出
 */

// JSON-RPC 基础
export {
  createRequest,
  createNotification,
  createResponse,
  createErrorResponse,
  isRequest,
  isNotification,
  isResponse,
  parseMessage,
  serializeMessage,
  resetIdCounter,
  JSON_RPC_ERRORS,
} from './json-rpc.js';
export type {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcMessage,
} from './json-rpc.js';

// MCP 协议类型
export { MCP_PROTOCOL_VERSION } from './mcp-types.js';
export type {
  ClientCapabilities,
  ServerCapabilities,
  InitializeParams,
  InitializeResult,
  ImplementationInfo,
  MCPToolDefinition,
  ToolsListResult,
  ToolCallParams,
  ToolCallResult,
  ToolContent,
  MCPResource,
  ResourcesListResult,
  ResourceReadParams,
  ResourceReadResult,
  MCPPrompt,
  PromptsListResult,
} from './mcp-types.js';

// 传输层
export { StdioTransport, InMemoryTransport } from './stdio-transport.js';
export type { Transport, StdioTransportOptions } from './stdio-transport.js';

// Client & Server
export { MCPClient } from './mcp-client.js';
export type { MCPClientOptions } from './mcp-client.js';

export { MCPServer } from './mcp-server.js';
export type { MCPServerOptions, ResourceHandler } from './mcp-server.js';

// Tool Adapter
export { adaptMCPTool, discoverMCPTools, jsonSchemaToZod } from './mcp-tool-adapter.js';
