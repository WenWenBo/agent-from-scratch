/**
 * ToolRegistry -- 工具注册中心
 * 管理所有可用工具的注册、查找、Schema 导出和安全执行
 */

import { z } from 'zod';
import type { ToolDefinition, ToolCall } from '../types.js';
import type { Tool, ToolExecutionResult } from './tool.js';
import { toolToDefinition } from './tool.js';

export interface ToolRegistryOptions {
  /** 单个工具执行的超时时间（毫秒），默认 30000 */
  executionTimeout?: number;
}

export class ToolRegistry {
  private tools = new Map<string, Tool<any, any>>();
  private executionTimeout: number;

  constructor(options?: ToolRegistryOptions) {
    this.executionTimeout = options?.executionTimeout ?? 30_000;
  }

  // ============================================================
  // 注册与查找
  // ============================================================

  register(tool: Tool<any, any>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerMany(tools: Tool<any, any>[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  get(name: string): Tool<any, any> | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool<any, any>[] {
    return Array.from(this.tools.values());
  }

  get size(): number {
    return this.tools.size;
  }

  // ============================================================
  // Schema 导出 -- 生成 LLM 需要的 ToolDefinition[]
  // ============================================================

  toDefinitions(): ToolDefinition[] {
    return this.list().map(toolToDefinition);
  }

  // ============================================================
  // 工具执行 -- 带参数校验、超时控制、错误捕获
  // ============================================================

  /**
   * 执行一个工具调用
   * 完整流程：查找工具 → 解析参数 JSON → Zod 校验 → 执行 → 捕获异常
   */
  async execute(toolCall: ToolCall): Promise<ToolExecutionResult> {
    const start = Date.now();
    const toolName = toolCall.function.name;

    // 1. 查找工具
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${toolName}" not found. Available tools: ${this.listNames().join(', ')}`,
        durationMs: Date.now() - start,
      };
    }

    // 2. 解析参数 JSON
    let rawParams: unknown;
    try {
      rawParams = JSON.parse(toolCall.function.arguments);
    } catch {
      return {
        success: false,
        error: `Invalid JSON in tool arguments: ${toolCall.function.arguments}`,
        durationMs: Date.now() - start,
      };
    }

    // 3. Zod 参数校验
    const parseResult = tool.parameters.safeParse(rawParams);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return {
        success: false,
        error: `Parameter validation failed: ${issues}`,
        durationMs: Date.now() - start,
      };
    }

    // 4. 带超时的执行
    try {
      const result = await this.executeWithTimeout(
        tool.execute(parseResult.data),
        this.executionTimeout,
        toolName
      );
      return {
        success: true,
        result,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 批量执行多个工具调用（并行）
   * 当 LLM 在一轮中返回多个 tool_calls 时使用
   */
  async executeMany(
    toolCalls: ToolCall[]
  ): Promise<Map<string, ToolExecutionResult>> {
    const results = new Map<string, ToolExecutionResult>();
    const executions = toolCalls.map(async (tc) => {
      const result = await this.execute(tc);
      results.set(tc.id, result);
    });
    await Promise.all(executions);
    return results;
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  private executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    toolName: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool "${toolName}" execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
