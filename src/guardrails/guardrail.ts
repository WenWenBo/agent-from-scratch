/**
 * Guardrail -- 安全护栏基础接口
 *
 * 护栏在 Agent 的输入和输出阶段执行，拦截不安全的内容。
 * 采用管道模式：多个护栏按顺序执行，任一拦截即终止。
 *
 * 执行位置：
 *   用户输入 → [Input Guardrails] → Agent 处理 → [Output Guardrails] → 最终输出
 *
 * 设计原则：
 * - 单一职责：每个 Guardrail 只检查一类风险
 * - 可组合：多个 Guardrail 组成 Pipeline
 * - 透明：返回结构化的检查结果，便于审计
 */

// ============================================================
// 核心类型
// ============================================================

/** 护栏检查结果 */
export interface GuardrailResult {
  /** 是否通过检查 */
  passed: boolean;

  /** 产出该结果的护栏名称 */
  guardrailName: string;

  /** 拦截原因（仅 passed=false 时有值） */
  reason?: string;

  /** 检测到的具体风险项 */
  violations?: Violation[];

  /** 检查耗时（毫秒） */
  durationMs: number;
}

/** 具体的违规项 */
export interface Violation {
  /** 违规类型 */
  type: string;

  /** 违规详情 */
  detail: string;

  /** 严重程度 */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** 违规出现的位置（可选） */
  position?: { start: number; end: number };
}

/** 护栏执行阶段 */
export type GuardrailStage = 'input' | 'output';

// ============================================================
// Guardrail 接口
// ============================================================

export interface Guardrail {
  /** 护栏名称 */
  readonly name: string;

  /** 该护栏适用的阶段 */
  readonly stage: GuardrailStage | 'both';

  /** 执行检查 */
  check(content: string, context?: GuardrailContext): Promise<GuardrailResult>;
}

/** 检查上下文（提供额外信息帮助决策） */
export interface GuardrailContext {
  /** 当前阶段 */
  stage: GuardrailStage;

  /** 用户 ID（可选，用于速率限制等） */
  userId?: string;

  /** 对话历史长度 */
  messageCount?: number;

  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// GuardrailPipeline -- 护栏管道
// ============================================================

export interface GuardrailPipelineResult {
  /** 所有护栏都通过 */
  passed: boolean;

  /** 每个护栏的检查结果 */
  results: GuardrailResult[];

  /** 总耗时（毫秒） */
  totalDurationMs: number;
}

export class GuardrailPipeline {
  private guardrails: Guardrail[] = [];

  add(guardrail: Guardrail): this {
    this.guardrails.push(guardrail);
    return this;
  }

  addMany(guardrails: Guardrail[]): this {
    this.guardrails.push(...guardrails);
    return this;
  }

  /**
   * 按顺序执行所有适用当前阶段的护栏
   * @param failFast 遇到第一个失败就立即返回（默认 true）
   */
  async run(
    content: string,
    stage: GuardrailStage,
    options?: { failFast?: boolean; userId?: string }
  ): Promise<GuardrailPipelineResult> {
    const start = Date.now();
    const results: GuardrailResult[] = [];
    const failFast = options?.failFast ?? true;

    const context: GuardrailContext = {
      stage,
      userId: options?.userId,
    };

    const applicable = this.guardrails.filter(
      (g) => g.stage === stage || g.stage === 'both'
    );

    for (const guardrail of applicable) {
      const result = await guardrail.check(content, context);
      results.push(result);

      if (!result.passed && failFast) {
        return {
          passed: false,
          results,
          totalDurationMs: Date.now() - start,
        };
      }
    }

    return {
      passed: results.every((r) => r.passed),
      results,
      totalDurationMs: Date.now() - start,
    };
  }

  get size(): number {
    return this.guardrails.length;
  }

  list(): Guardrail[] {
    return [...this.guardrails];
  }
}
