/**
 * ContentFilter -- 内容过滤护栏
 *
 * 基于关键词和正则表达式的内容过滤，检测：
 * - 不当内容（暴力、色情、仇恨言论等）
 * - 自定义黑名单词汇
 * - 自定义正则模式
 *
 * 这是最基本的护栏层，速度快、确定性高。
 */

import type {
  Guardrail,
  GuardrailResult,
  GuardrailContext,
  GuardrailStage,
  Violation,
} from './guardrail.js';

// ============================================================
// 配置
// ============================================================

export interface ContentFilterOptions {
  /** 护栏名称 */
  name?: string;

  /** 适用阶段 */
  stage?: GuardrailStage | 'both';

  /** 黑名单关键词（不区分大小写匹配） */
  blockedKeywords?: string[];

  /** 自定义正则模式 */
  blockedPatterns?: Array<{
    pattern: RegExp;
    description: string;
    severity?: Violation['severity'];
  }>;

  /** 最大内容长度（字符数） */
  maxContentLength?: number;
}

// ============================================================
// ContentFilter 实现
// ============================================================

export class ContentFilter implements Guardrail {
  readonly name: string;
  readonly stage: GuardrailStage | 'both';
  private blockedKeywords: string[];
  private blockedPatterns: Array<{
    pattern: RegExp;
    description: string;
    severity: Violation['severity'];
  }>;
  private maxContentLength: number;

  constructor(options?: ContentFilterOptions) {
    this.name = options?.name ?? 'content-filter';
    this.stage = options?.stage ?? 'both';
    this.blockedKeywords = (options?.blockedKeywords ?? []).map((k) => k.toLowerCase());
    this.blockedPatterns = (options?.blockedPatterns ?? []).map((p) => ({
      ...p,
      severity: p.severity ?? 'high',
    }));
    this.maxContentLength = options?.maxContentLength ?? 100_000;
  }

  async check(content: string, _context?: GuardrailContext): Promise<GuardrailResult> {
    const start = Date.now();
    const violations: Violation[] = [];

    // 1. 内容长度检查
    if (content.length > this.maxContentLength) {
      violations.push({
        type: 'content_too_long',
        detail: `Content length ${content.length} exceeds maximum ${this.maxContentLength}`,
        severity: 'medium',
      });
    }

    // 2. 关键词匹配
    const lower = content.toLowerCase();
    for (const keyword of this.blockedKeywords) {
      const idx = lower.indexOf(keyword);
      if (idx !== -1) {
        violations.push({
          type: 'blocked_keyword',
          detail: `Blocked keyword detected: "${keyword}"`,
          severity: 'high',
          position: { start: idx, end: idx + keyword.length },
        });
      }
    }

    // 3. 正则模式匹配
    for (const { pattern, description, severity } of this.blockedPatterns) {
      const match = content.match(pattern);
      if (match) {
        violations.push({
          type: 'blocked_pattern',
          detail: description,
          severity,
          position: match.index !== undefined
            ? { start: match.index, end: match.index + match[0].length }
            : undefined,
        });
      }
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
}
