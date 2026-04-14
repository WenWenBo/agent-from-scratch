/**
 * RateLimiter -- 速率限制护栏
 *
 * 限制单位时间内的请求次数和 Token 消耗。
 * 支持两种维度：
 * 1. 请求次数限制（RPM -- Requests Per Minute）
 * 2. Token 预算限制（TPM -- Tokens Per Minute）
 *
 * 采用滑动窗口算法，精确计算时间段内的消耗。
 */

import type {
  Guardrail,
  GuardrailResult,
  GuardrailContext,
  Violation,
} from './guardrail.js';

// ============================================================
// 配置
// ============================================================

export interface RateLimiterOptions {
  /** 每分钟最大请求数（0 = 不限） */
  maxRequestsPerMinute?: number;

  /** 每分钟最大 Token 数（0 = 不限），基于输入字符数估算 */
  maxTokensPerMinute?: number;

  /** 每次对话最大轮次 */
  maxTurnsPerSession?: number;

  /** Token 估算系数（1 token ≈ N 个字符），默认 4 */
  charsPerToken?: number;
}

// ============================================================
// RateLimiter 实现
// ============================================================

export class RateLimiter implements Guardrail {
  readonly name = 'rate-limiter';
  readonly stage = 'input' as const;

  private maxRPM: number;
  private maxTPM: number;
  private maxTurns: number;
  private charsPerToken: number;

  // 滑动窗口记录
  private requestLog: Array<{ time: number; userId?: string }> = [];
  private tokenLog: Array<{ time: number; tokens: number; userId?: string }> = [];
  private turnCounters = new Map<string, number>();

  constructor(options?: RateLimiterOptions) {
    this.maxRPM = options?.maxRequestsPerMinute ?? 0;
    this.maxTPM = options?.maxTokensPerMinute ?? 0;
    this.maxTurns = options?.maxTurnsPerSession ?? 0;
    this.charsPerToken = options?.charsPerToken ?? 4;
  }

  async check(content: string, context?: GuardrailContext): Promise<GuardrailResult> {
    const start = Date.now();
    const violations: Violation[] = [];
    const userId = context?.userId ?? 'anonymous';

    // 清理过期记录
    this.cleanup();

    // 1. RPM 检查
    if (this.maxRPM > 0) {
      const recentRequests = this.requestLog.filter(
        (r) => !context?.userId || r.userId === userId
      ).length;

      if (recentRequests >= this.maxRPM) {
        violations.push({
          type: 'rate_limit_rpm',
          detail: `Request rate limit exceeded: ${recentRequests}/${this.maxRPM} requests per minute`,
          severity: 'high',
        });
      }
    }

    // 2. TPM 检查
    if (this.maxTPM > 0) {
      const estimatedTokens = Math.ceil(content.length / this.charsPerToken);
      const recentTokens = this.tokenLog
        .filter((r) => !context?.userId || r.userId === userId)
        .reduce((sum, r) => sum + r.tokens, 0);

      if (recentTokens + estimatedTokens > this.maxTPM) {
        violations.push({
          type: 'rate_limit_tpm',
          detail: `Token rate limit exceeded: ${recentTokens + estimatedTokens}/${this.maxTPM} tokens per minute`,
          severity: 'high',
        });
      }
    }

    // 3. 轮次限制
    if (this.maxTurns > 0) {
      const currentTurns = this.turnCounters.get(userId) ?? 0;
      if (currentTurns >= this.maxTurns) {
        violations.push({
          type: 'rate_limit_turns',
          detail: `Session turn limit exceeded: ${currentTurns}/${this.maxTurns} turns`,
          severity: 'medium',
        });
      }
    }

    // 通过检查时记录
    if (violations.length === 0) {
      this.recordRequest(content, userId);
    }

    return {
      passed: violations.length === 0,
      guardrailName: this.name,
      reason: violations.length > 0
        ? violations.map((v) => v.detail).join('; ')
        : undefined,
      violations: violations.length > 0 ? violations : undefined,
      durationMs: Date.now() - start,
    };
  }

  /** 记录一次请求 */
  private recordRequest(content: string, userId: string): void {
    const now = Date.now();
    const tokens = Math.ceil(content.length / this.charsPerToken);

    this.requestLog.push({ time: now, userId });
    this.tokenLog.push({ time: now, tokens, userId });
    this.turnCounters.set(userId, (this.turnCounters.get(userId) ?? 0) + 1);
  }

  /** 清理一分钟前的记录 */
  private cleanup(): void {
    const cutoff = Date.now() - 60_000;
    this.requestLog = this.requestLog.filter((r) => r.time > cutoff);
    this.tokenLog = this.tokenLog.filter((r) => r.time > cutoff);
  }

  /** 重置所有计数器 */
  reset(): void {
    this.requestLog = [];
    this.tokenLog = [];
    this.turnCounters.clear();
  }

  /** 重置指定用户的轮次计数 */
  resetSession(userId: string): void {
    this.turnCounters.delete(userId);
  }
}
