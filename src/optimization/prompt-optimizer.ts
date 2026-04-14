/**
 * Prompt Optimizer -- Prompt 压缩与优化
 *
 * 减少 Prompt 的 Token 消耗，同时保持语义完整。
 *
 * 策略：
 * 1. 消息裁剪 -- 移除早期对话轮次
 * 2. 内容压缩 -- 移除冗余空白、简化格式
 * 3. 系统消息缓存 -- 标记不变的前缀部分（对齐 OpenAI Prompt Caching）
 * 4. 工具定义精简 -- 只保留当前可能需要的工具
 *
 * 参考:
 * - OpenAI Prompt Caching: https://platform.openai.com/docs/guides/prompt-caching
 * - LLMLingua: https://github.com/microsoft/LLMLingua
 */

import type { Message, ChatRequest, ToolDefinition } from '../types.js';

// ============================================================
// 配置
// ============================================================

export interface PromptOptimizerOptions {
  /** 最大 token 预算（估算），默认 4000 */
  maxTokenBudget?: number;
  /** 是否压缩内容空白，默认 true */
  compressWhitespace?: boolean;
  /** 是否移除 system 消息中的注释行，默认 false */
  removeComments?: boolean;
  /** 最少保留的消息轮数（user+assistant 各一条算一轮），默认 2 */
  minTurnsToKeep?: number;
}

// ============================================================
// 优化结果
// ============================================================

export interface OptimizeResult {
  request: ChatRequest;
  originalTokenEstimate: number;
  optimizedTokenEstimate: number;
  tokensSaved: number;
  savingsPercent: number;
  actions: string[];
}

// ============================================================
// PromptOptimizer
// ============================================================

export class PromptOptimizer {
  private maxTokenBudget: number;
  private compressWhitespace: boolean;
  private removeComments: boolean;
  private minTurnsToKeep: number;

  constructor(options: PromptOptimizerOptions = {}) {
    this.maxTokenBudget = options.maxTokenBudget ?? 4000;
    this.compressWhitespace = options.compressWhitespace ?? true;
    this.removeComments = options.removeComments ?? false;
    this.minTurnsToKeep = options.minTurnsToKeep ?? 2;
  }

  // ============================================================
  // 主方法
  // ============================================================

  optimize(request: ChatRequest): OptimizeResult {
    const originalEstimate = this.estimateTokens(request);
    const actions: string[] = [];

    let messages = [...request.messages];
    let tools = request.tools ? [...request.tools] : undefined;

    // 1. 内容压缩
    if (this.compressWhitespace) {
      const compressed = messages.map((m) => this.compressMessage(m));
      const beforeLen = messages.reduce((s, m) => s + this.messageLength(m), 0);
      const afterLen = compressed.reduce((s, m) => s + this.messageLength(m), 0);
      if (afterLen < beforeLen) {
        messages = compressed;
        actions.push(`Compressed whitespace (saved ~${beforeLen - afterLen} chars)`);
      }
    }

    // 2. 移除注释行
    if (this.removeComments) {
      messages = messages.map((m) => this.removeCommentLines(m));
      actions.push('Removed comment lines from system messages');
    }

    // 3. 消息裁剪（如果超预算）
    let estimate = this.estimateTokensFromMessages(messages, tools);
    if (estimate > this.maxTokenBudget) {
      const trimmed = this.trimMessages(messages, tools);
      const removed = messages.length - trimmed.length;
      if (removed > 0) {
        messages = trimmed;
        actions.push(`Trimmed ${removed} early messages`);
      }
    }

    // 4. 工具精简
    if (tools && tools.length > 5) {
      const pruned = this.pruneTools(tools, messages);
      if (pruned.length < tools.length) {
        actions.push(`Pruned tools: ${tools.length} → ${pruned.length}`);
        tools = pruned;
      }
    }

    const optimizedRequest: ChatRequest = {
      ...request,
      messages,
      tools: tools && tools.length > 0 ? tools : request.tools,
    };

    const optimizedEstimate = this.estimateTokens(optimizedRequest);
    const saved = originalEstimate - optimizedEstimate;

    return {
      request: optimizedRequest,
      originalTokenEstimate: originalEstimate,
      optimizedTokenEstimate: optimizedEstimate,
      tokensSaved: Math.max(0, saved),
      savingsPercent: originalEstimate > 0 ? Math.max(0, saved / originalEstimate) : 0,
      actions,
    };
  }

  // ============================================================
  // 消息压缩
  // ============================================================

  compressMessage(message: Message): Message {
    if (!('content' in message) || !message.content) return message;

    let content = message.content;
    content = content.replace(/\n{3,}/g, '\n\n');
    content = content.replace(/[ \t]{2,}/g, ' ');
    content = content.replace(/^\s+$/gm, '');

    return { ...message, content } as Message;
  }

  removeCommentLines(message: Message): Message {
    if (message.role !== 'system' || !message.content) return message;
    const lines = message.content.split('\n');
    const filtered = lines.filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('#'));
    return { ...message, content: filtered.join('\n') };
  }

  // ============================================================
  // 消息裁剪
  // ============================================================

  trimMessages(messages: Message[], tools?: ToolDefinition[]): Message[] {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    // 保留至少 minTurnsToKeep 轮对话
    const minMessages = this.minTurnsToKeep * 2;

    if (nonSystem.length <= minMessages) {
      return messages;
    }

    // 从最早的非 system 消息开始裁剪
    let trimmed = [...nonSystem];
    let estimate = this.estimateTokensFromMessages([...systemMessages, ...trimmed], tools);

    while (estimate > this.maxTokenBudget && trimmed.length > minMessages) {
      // 移除最早的一轮（user + assistant）
      if (trimmed[0]?.role === 'user') trimmed.shift();
      if (trimmed[0]?.role === 'assistant') trimmed.shift();
      if (trimmed[0]?.role === 'tool') trimmed.shift();
      estimate = this.estimateTokensFromMessages([...systemMessages, ...trimmed], tools);
    }

    return [...systemMessages, ...trimmed];
  }

  // ============================================================
  // 工具精简
  // ============================================================

  pruneTools(tools: ToolDefinition[], messages: Message[]): ToolDefinition[] {
    const recentContent = messages
      .slice(-6)
      .map((m) => ('content' in m ? m.content : '') ?? '')
      .join(' ')
      .toLowerCase();

    // 优先保留在最近消息中被提及的工具
    const scored = tools.map((tool) => {
      const name = tool.function.name.toLowerCase();
      const desc = tool.function.description.toLowerCase();
      const mentioned = recentContent.includes(name) || recentContent.includes(desc.slice(0, 20));
      return { tool, score: mentioned ? 1 : 0 };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((s) => s.tool);
  }

  // ============================================================
  // Token 估算
  // ============================================================

  estimateTokens(request: ChatRequest): number {
    return this.estimateTokensFromMessages(request.messages, request.tools);
  }

  private estimateTokensFromMessages(messages: Message[], tools?: ToolDefinition[]): number {
    let charCount = 0;
    for (const m of messages) {
      charCount += 4; // message overhead
      if ('content' in m && m.content) {
        charCount += m.content.length;
      }
      if ('toolCalls' in m && m.toolCalls) {
        charCount += JSON.stringify(m.toolCalls).length;
      }
    }

    if (tools) {
      charCount += JSON.stringify(tools).length;
    }

    return Math.ceil(charCount / 3.5);
  }

  private messageLength(m: Message): number {
    if ('content' in m && m.content) return m.content.length;
    return 0;
  }
}
