/**
 * ToolCallGuard -- 工具调用安全守卫
 *
 * 在 Agent 执行工具调用之前进行安全检查：
 * - 白名单/黑名单控制：限制可调用的工具
 * - 参数过滤：阻止危险参数值
 * - 调用频率限制：防止恶意轮询
 * - 危险操作确认：标记需要人工确认的操作
 *
 * 设计为独立于 Guardrail 管道的工具层防护。
 */

// ============================================================
// 类型
// ============================================================

export interface ToolCallGuardOptions {
  /** 允许调用的工具名称白名单（设置后只有这些工具可用） */
  allowedTools?: string[];

  /** 禁止调用的工具名称黑名单 */
  blockedTools?: string[];

  /** 参数安全规则 */
  parameterRules?: ParameterRule[];

  /** 需要人工确认的工具 */
  requireConfirmation?: string[];

  /** 每分钟最大调用次数（全局） */
  maxCallsPerMinute?: number;
}

export interface ParameterRule {
  /** 适用的工具名称（* 表示所有工具） */
  toolName: string;

  /** 参数路径（如 "filename" 或 "config.path"） */
  paramPath: string;

  /** 参数值的正则黑名单 */
  blockedPattern: RegExp;

  /** 拦截原因 */
  reason: string;
}

export interface ToolCallCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

// ============================================================
// ToolCallGuard 实现
// ============================================================

export class ToolCallGuard {
  private allowedTools: Set<string> | null;
  private blockedTools: Set<string>;
  private parameterRules: ParameterRule[];
  private requireConfirmation: Set<string>;
  private maxCallsPerMinute: number;
  private callLog: number[] = [];

  constructor(options?: ToolCallGuardOptions) {
    this.allowedTools = options?.allowedTools ? new Set(options.allowedTools) : null;
    this.blockedTools = new Set(options?.blockedTools ?? []);
    this.parameterRules = options?.parameterRules ?? [];
    this.requireConfirmation = new Set(options?.requireConfirmation ?? []);
    this.maxCallsPerMinute = options?.maxCallsPerMinute ?? Infinity;
  }

  /**
   * 检查一个工具调用是否允许执行
   */
  check(toolName: string, args: Record<string, unknown>): ToolCallCheckResult {
    // 1. 黑名单
    if (this.blockedTools.has(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is blocked` };
    }

    // 2. 白名单
    if (this.allowedTools && !this.allowedTools.has(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is not in the allowed list` };
    }

    // 3. 速率限制
    if (!this.checkRateLimit()) {
      return { allowed: false, reason: `Rate limit exceeded: max ${this.maxCallsPerMinute} calls/minute` };
    }

    // 4. 参数安全
    for (const rule of this.parameterRules) {
      if (rule.toolName !== '*' && rule.toolName !== toolName) continue;

      const value = this.getNestedValue(args, rule.paramPath);
      if (value !== undefined && typeof value === 'string' && rule.blockedPattern.test(value)) {
        return { allowed: false, reason: rule.reason };
      }
    }

    // 5. 记录调用
    this.callLog.push(Date.now());

    // 6. 人工确认标记
    if (this.requireConfirmation.has(toolName)) {
      return { allowed: true, requiresConfirmation: true };
    }

    return { allowed: true };
  }

  /**
   * 重置速率限制计数器
   */
  resetRateLimit(): void {
    this.callLog = [];
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private checkRateLimit(): boolean {
    if (this.maxCallsPerMinute === Infinity) return true;

    const now = Date.now();
    const oneMinuteAgo = now - 60_000;

    // 清理一分钟前的记录
    this.callLog = this.callLog.filter((t) => t > oneMinuteAgo);

    return this.callLog.length < this.maxCallsPerMinute;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
