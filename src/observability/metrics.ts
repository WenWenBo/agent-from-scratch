/**
 * Metrics Collector -- Agent 运行指标收集器
 *
 * 收集四类核心指标：
 * 1. Token 用量  -- 每次 LLM 调用的 prompt/completion tokens
 * 2. 延迟分布   -- LLM 调用、工具执行、端到端延迟
 * 3. 成功/失败率 -- 各阶段的成功与失败计数
 * 4. 成本估算   -- 基于 Token 用量的费用计算
 *
 * 参考:
 * - OpenTelemetry Metrics: https://opentelemetry.io/docs/concepts/signals/metrics/
 * - LangSmith Monitoring: https://docs.smith.langchain.com/monitoring
 */

// ============================================================
// 指标数据结构
// ============================================================

export interface TokenMetrics {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  callCount: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
}

export interface LatencyMetrics {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface CounterMetrics {
  success: number;
  failure: number;
  total: number;
  successRate: number;
}

export interface CostEstimate {
  model: string;
  promptCost: number;
  completionCost: number;
  totalCost: number;
  currency: string;
}

// ============================================================
// 价格表（每 1M tokens，USD）
// ============================================================

export interface ModelPricing {
  promptPer1M: number;
  completionPer1M: number;
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { promptPer1M: 2.5, completionPer1M: 10 },
  'gpt-4o-mini': { promptPer1M: 0.15, completionPer1M: 0.6 },
  'gpt-4-turbo': { promptPer1M: 10, completionPer1M: 30 },
  'gpt-3.5-turbo': { promptPer1M: 0.5, completionPer1M: 1.5 },
  'claude-3-opus': { promptPer1M: 15, completionPer1M: 75 },
  'claude-3-sonnet': { promptPer1M: 3, completionPer1M: 15 },
  'claude-3-haiku': { promptPer1M: 0.25, completionPer1M: 1.25 },
};

// ============================================================
// MetricsCollector
// ============================================================

export class MetricsCollector {
  private tokenRecords: Array<{ promptTokens: number; completionTokens: number; model: string; timestamp: number }> = [];
  private latencyRecords: Map<string, number[]> = new Map();
  private counters: Map<string, { success: number; failure: number }> = new Map();
  private customPricing: Record<string, ModelPricing> = {};

  // ============================================================
  // Token 记录
  // ============================================================

  recordTokenUsage(promptTokens: number, completionTokens: number, model: string): void {
    this.tokenRecords.push({
      promptTokens,
      completionTokens,
      model,
      timestamp: Date.now(),
    });
  }

  getTokenMetrics(model?: string): TokenMetrics {
    const records = model
      ? this.tokenRecords.filter((r) => r.model === model)
      : this.tokenRecords;

    if (records.length === 0) {
      return {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        callCount: 0,
        avgPromptTokens: 0,
        avgCompletionTokens: 0,
      };
    }

    const totalPrompt = records.reduce((sum, r) => sum + r.promptTokens, 0);
    const totalCompletion = records.reduce((sum, r) => sum + r.completionTokens, 0);

    return {
      totalPromptTokens: totalPrompt,
      totalCompletionTokens: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      callCount: records.length,
      avgPromptTokens: Math.round(totalPrompt / records.length),
      avgCompletionTokens: Math.round(totalCompletion / records.length),
    };
  }

  // ============================================================
  // 延迟记录
  // ============================================================

  recordLatency(category: string, durationMs: number): void {
    if (!this.latencyRecords.has(category)) {
      this.latencyRecords.set(category, []);
    }
    this.latencyRecords.get(category)!.push(durationMs);
  }

  getLatencyMetrics(category: string): LatencyMetrics {
    const records = this.latencyRecords.get(category) ?? [];

    if (records.length === 0) {
      return {
        count: 0,
        totalMs: 0,
        minMs: 0,
        maxMs: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      };
    }

    const sorted = [...records].sort((a, b) => a - b);
    const total = sorted.reduce((sum, v) => sum + v, 0);

    return {
      count: sorted.length,
      totalMs: total,
      minMs: sorted[0]!,
      maxMs: sorted[sorted.length - 1]!,
      avgMs: Math.round(total / sorted.length),
      p50Ms: this.percentile(sorted, 50),
      p95Ms: this.percentile(sorted, 95),
      p99Ms: this.percentile(sorted, 99),
    };
  }

  getLatencyCategories(): string[] {
    return [...this.latencyRecords.keys()];
  }

  // ============================================================
  // 成功/失败计数
  // ============================================================

  recordSuccess(category: string): void {
    this.ensureCounter(category);
    this.counters.get(category)!.success++;
  }

  recordFailure(category: string): void {
    this.ensureCounter(category);
    this.counters.get(category)!.failure++;
  }

  getCounterMetrics(category: string): CounterMetrics {
    const counter = this.counters.get(category) ?? { success: 0, failure: 0 };
    const total = counter.success + counter.failure;
    return {
      success: counter.success,
      failure: counter.failure,
      total,
      successRate: total > 0 ? counter.success / total : 0,
    };
  }

  getCounterCategories(): string[] {
    return [...this.counters.keys()];
  }

  // ============================================================
  // 成本估算
  // ============================================================

  setModelPricing(model: string, pricing: ModelPricing): void {
    this.customPricing[model] = pricing;
  }

  estimateCost(model?: string): CostEstimate {
    const tokens = this.getTokenMetrics(model);
    const targetModel = model ?? this.getMostUsedModel() ?? 'gpt-4o';
    const pricing = this.customPricing[targetModel]
      ?? DEFAULT_PRICING[targetModel]
      ?? { promptPer1M: 2.5, completionPer1M: 10 };

    const promptCost = (tokens.totalPromptTokens / 1_000_000) * pricing.promptPer1M;
    const completionCost = (tokens.totalCompletionTokens / 1_000_000) * pricing.completionPer1M;

    return {
      model: targetModel,
      promptCost: Math.round(promptCost * 10000) / 10000,
      completionCost: Math.round(completionCost * 10000) / 10000,
      totalCost: Math.round((promptCost + completionCost) * 10000) / 10000,
      currency: 'USD',
    };
  }

  // ============================================================
  // 汇总报表
  // ============================================================

  getSummary(): {
    tokens: TokenMetrics;
    latency: Record<string, LatencyMetrics>;
    counters: Record<string, CounterMetrics>;
    cost: CostEstimate;
  } {
    const latency: Record<string, LatencyMetrics> = {};
    for (const cat of this.getLatencyCategories()) {
      latency[cat] = this.getLatencyMetrics(cat);
    }

    const counters: Record<string, CounterMetrics> = {};
    for (const cat of this.getCounterCategories()) {
      counters[cat] = this.getCounterMetrics(cat);
    }

    return {
      tokens: this.getTokenMetrics(),
      latency,
      counters,
      cost: this.estimateCost(),
    };
  }

  reset(): void {
    this.tokenRecords = [];
    this.latencyRecords.clear();
    this.counters.clear();
  }

  // ============================================================
  // 内部工具
  // ============================================================

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
  }

  private ensureCounter(category: string): void {
    if (!this.counters.has(category)) {
      this.counters.set(category, { success: 0, failure: 0 });
    }
  }

  private getMostUsedModel(): string | undefined {
    const modelCount = new Map<string, number>();
    for (const r of this.tokenRecords) {
      modelCount.set(r.model, (modelCount.get(r.model) ?? 0) + 1);
    }
    let maxModel: string | undefined;
    let maxCount = 0;
    for (const [model, count] of modelCount) {
      if (count > maxCount) {
        maxCount = count;
        maxModel = model;
      }
    }
    return maxModel;
  }
}
