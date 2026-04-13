/**
 * TinyAgent 核心类型定义
 * 所有模块共享的基础类型
 */

// ============================================================
// 消息类型 -- LLM 对话的基本单元
// ============================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  toolCalls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  toolCallId: string;
  content: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// ============================================================
// 工具调用类型
// ============================================================

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ============================================================
// LLM Provider 类型
// ============================================================

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

export interface ChatResponse {
  id: string;
  content: string | null;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamChunk {
  type: 'text_delta' | 'tool_call_delta' | 'usage' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
  usage?: TokenUsage;
}
