/**
 * CostTracker -- 精细成本追踪与预算控制
 *
 * 在 MetricsCollector（Chapter 10）基础上，提供更细粒度的：
 * 1. 实时成本追踪（每次 LLM 调用后即时计算）
 * 2. 预算告警与硬限制
 * 3. 按时间窗口统计（小时/天/月）
 * 4. 成本趋势分析
 *
 * 参考:
 * - OpenAI Usage: https://platform.openai.com/usage
 */

import type { ModelPricing } from '../observability/metrics.js';

// ============================================================
// 成本记录
// ============================================================

interface CostRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  timestamp: number;
}

// ============================================================
// 预算配置
// ============================================================

export interface BudgetConfig {
  /** 每分钟最大花费（USD） */
  maxCostPerMinute?: number;
  /** 每小时最大花费（USD） */
  maxCostPerHour?: number;
  /** 每天最大花费（USD） */
  maxCostPerDay?: number;
  /** 总预算上限（USD） */
  totalBudget?: number;
  /** 告警阈值（0-1），超过此比例时触发告警，默认 0.8 */
  alertThreshold?: number;
}

// ============================================================
// 告警
// ============================================================

export interface CostAlert {
  type: 'warning' | 'exceeded';
  message: string;
  currentCost: number;
  limit: number;
  timestamp: number;
}

// ============================================================
// CostTracker
// ============================================================

export class CostTracker {
  private records: CostRecord[] = [];
  private pricing: Record<string, ModelPricing> = {};
  private budget: BudgetConfig;
  private alerts: CostAlert[] = [];
  private onAlert?: (alert: CostAlert) => void;

  private static DEFAULT_PRICING: Record<string, ModelPricing> = {
    'gpt-4o': { promptPer1M: 2.5, completionPer1M: 10 },
    'gpt-4o-mini': { promptPer1M: 0.15, completionPer1M: 0.6 },
    'gpt-4-turbo': { promptPer1M: 10, completionPer1M: 30 },
    'gpt-3.5-turbo': { promptPer1M: 0.5, completionPer1M: 1.5 },
    'claude-3-opus': { promptPer1M: 15, completionPer1M: 75 },
    'claude-3-sonnet': { promptPer1M: 3, completionPer1M: 15 },
    'claude-3-haiku': { promptPer1M: 0.25, completionPer1M: 1.25 },
  };

  constructor(budget: BudgetConfig = {}, onAlert?: (alert: CostAlert) => void) {
    this.budget = budget;
    this.onAlert = onAlert;
  }

  // ============================================================
  // 价格设置
  // ============================================================

  setModelPricing(model: string, pricing: ModelPricing): void {
    this.pricing[model] = pricing;
  }

  private getPricing(model: string): ModelPricing {
    return this.pricing[model]
      ?? CostTracker.DEFAULT_PRICING[model]
      ?? { promptPer1M: 2.5, completionPer1M: 10 };
  }

  // ============================================================
  // 记录成本
  // ============================================================

  record(model: string, promptTokens: number, completionTokens: number): CostRecord {
    const pricing = this.getPricing(model);
    const costUsd =
      (promptTokens / 1_000_000) * pricing.promptPer1M +
      (completionTokens / 1_000_000) * pricing.completionPer1M;

    const record: CostRecord = {
      model,
      promptTokens,
      completionTokens,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      timestamp: Date.now(),
    };

    this.records.push(record);
    this.checkBudget();
    return record;
  }

  // ============================================================
  // 预算检查
  // ============================================================

  checkBudget(): CostAlert | undefined {
    const threshold = this.budget.alertThreshold ?? 0.8;
    const now = Date.now();

    if (this.budget.totalBudget) {
      const total = this.getTotalCost();
      if (total >= this.budget.totalBudget) {
        return this.emitAlert('exceeded', `Total budget exceeded: $${total.toFixed(4)} / $${this.budget.totalBudget}`, total, this.budget.totalBudget);
      }
      if (total >= this.budget.totalBudget * threshold) {
        return this.emitAlert('warning', `Approaching total budget: $${total.toFixed(4)} / $${this.budget.totalBudget} (${(total / this.budget.totalBudget * 100).toFixed(0)}%)`, total, this.budget.totalBudget);
      }
    }

    if (this.budget.maxCostPerDay) {
      const dayCost = this.getCostSince(now - 24 * 60 * 60 * 1000);
      if (dayCost >= this.budget.maxCostPerDay) {
        return this.emitAlert('exceeded', `Daily budget exceeded: $${dayCost.toFixed(4)}`, dayCost, this.budget.maxCostPerDay);
      }
    }

    if (this.budget.maxCostPerHour) {
      const hourCost = this.getCostSince(now - 60 * 60 * 1000);
      if (hourCost >= this.budget.maxCostPerHour) {
        return this.emitAlert('exceeded', `Hourly budget exceeded: $${hourCost.toFixed(4)}`, hourCost, this.budget.maxCostPerHour);
      }
    }

    if (this.budget.maxCostPerMinute) {
      const minCost = this.getCostSince(now - 60 * 1000);
      if (minCost >= this.budget.maxCostPerMinute) {
        return this.emitAlert('exceeded', `Per-minute budget exceeded: $${minCost.toFixed(4)}`, minCost, this.budget.maxCostPerMinute);
      }
    }

    return undefined;
  }

  isBudgetExceeded(): boolean {
    const alert = this.checkBudget();
    return alert?.type === 'exceeded';
  }

  // ============================================================
  // 查询
  // ============================================================

  getTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.costUsd, 0);
  }

  getCostSince(since: number): number {
    return this.records
      .filter((r) => r.timestamp >= since)
      .reduce((sum, r) => sum + r.costUsd, 0);
  }

  getCostByModel(): Record<string, { cost: number; calls: number; tokens: number }> {
    const result: Record<string, { cost: number; calls: number; tokens: number }> = {};
    for (const r of this.records) {
      if (!result[r.model]) {
        result[r.model] = { cost: 0, calls: 0, tokens: 0 };
      }
      result[r.model]!.cost += r.costUsd;
      result[r.model]!.calls++;
      result[r.model]!.tokens += r.promptTokens + r.completionTokens;
    }
    return result;
  }

  getAlerts(): CostAlert[] {
    return [...this.alerts];
  }

  getSummary(): {
    totalCost: number;
    totalCalls: number;
    totalTokens: number;
    avgCostPerCall: number;
    byModel: Record<string, { cost: number; calls: number; tokens: number }>;
    budgetRemaining: number | undefined;
    alerts: CostAlert[];
  } {
    const totalCost = this.getTotalCost();
    const totalCalls = this.records.length;
    const totalTokens = this.records.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0);

    return {
      totalCost,
      totalCalls,
      totalTokens,
      avgCostPerCall: totalCalls > 0 ? totalCost / totalCalls : 0,
      byModel: this.getCostByModel(),
      budgetRemaining: this.budget.totalBudget
        ? Math.max(0, this.budget.totalBudget - totalCost)
        : undefined,
      alerts: this.alerts,
    };
  }

  reset(): void {
    this.records = [];
    this.alerts = [];
  }

  // ============================================================
  // 内部
  // ============================================================

  private emitAlert(type: CostAlert['type'], message: string, currentCost: number, limit: number): CostAlert {
    const alert: CostAlert = { type, message, currentCost, limit, timestamp: Date.now() };
    this.alerts.push(alert);
    this.onAlert?.(alert);
    return alert;
  }
}
