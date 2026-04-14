/**
 * JSON-RPC 2.0 消息类型与工具函数
 *
 * MCP 基于 JSON-RPC 2.0 通信。这里定义所有消息结构并提供
 * 序列化/反序列化方法。
 *
 * @see https://www.jsonrpc.org/specification
 * @see https://modelcontextprotocol.io/specification/2025-06-18
 */

// ============================================================
// JSON-RPC 2.0 基础类型
// ============================================================

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ============================================================
// 标准错误码
// ============================================================

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ============================================================
// 工具函数
// ============================================================

let nextId = 1;

export function createRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params,
  };
}

export function createNotification(method: string, params?: Record<string, unknown>): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}

export function createResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function createErrorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && 'method' in msg;
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return !('id' in msg) && 'method' in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && !('method' in msg);
}

/**
 * 解析一行 JSON 为 JsonRpcMessage
 * MCP stdio 传输中，每行是一条独立的 JSON-RPC 消息
 */
export function parseMessage(line: string): JsonRpcMessage {
  const data = JSON.parse(line);
  if (data.jsonrpc !== '2.0') {
    throw new Error('Not a JSON-RPC 2.0 message');
  }
  return data as JsonRpcMessage;
}

/**
 * 将消息序列化为单行 JSON（不含换行符）
 */
export function serializeMessage(msg: JsonRpcMessage): string {
  return JSON.stringify(msg);
}

/**
 * 重置 ID 计数器（用于测试）
 */
export function resetIdCounter(): void {
  nextId = 1;
}
