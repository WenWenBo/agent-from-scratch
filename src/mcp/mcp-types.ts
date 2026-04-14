/**
 * MCP 协议类型定义
 *
 * 定义 MCP 协议中 Client ↔ Server 之间交换的所有结构化数据。
 * 遵循 MCP Specification 2025-06-18。
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18
 */

// ============================================================
// 协议常量
// ============================================================

export const MCP_PROTOCOL_VERSION = '2025-06-18';

// ============================================================
// 能力协商 (Capabilities)
// ============================================================

export interface ClientCapabilities {
  roots?: { listChanged?: boolean };
  sampling?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

// ============================================================
// 初始化 (Initialize)
// ============================================================

export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: ImplementationInfo;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: ImplementationInfo;
  instructions?: string;
}

export interface ImplementationInfo {
  name: string;
  version: string;
}

// ============================================================
// 工具 (Tools)
// ============================================================

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolsListResult {
  tools: MCPToolDefinition[];
  nextCursor?: string;
}

export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolCallResult {
  content: ToolContent[];
  isError?: boolean;
}

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } };

// ============================================================
// 资源 (Resources)
// ============================================================

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourcesListResult {
  resources: MCPResource[];
  nextCursor?: string;
}

export interface ResourceReadParams {
  uri: string;
}

export interface ResourceReadResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

// ============================================================
// Prompts
// ============================================================

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface PromptsListResult {
  prompts: MCPPrompt[];
  nextCursor?: string;
}
