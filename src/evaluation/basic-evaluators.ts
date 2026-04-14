/**
 * 基础评估器 -- 不依赖 LLM 的确定性评估
 *
 * 1. ExactMatchEvaluator   -- 精确匹配
 * 2. ContainsEvaluator     -- 包含关键词
 * 3. RegexEvaluator        -- 正则匹配
 * 4. LengthEvaluator       -- 长度检查
 * 5. JsonValidEvaluator    -- JSON 格式校验
 * 6. LatencyEvaluator      -- 延迟阈值检查
 * 7. CostEvaluator         -- 成本阈值检查
 * 8. CompositeEvaluator    -- 组合多个评估器
 */

import type { Evaluator, EvalInput, EvalResult } from './evaluator.js';

// ============================================================
// ExactMatch -- 精确匹配
// ============================================================

export interface ExactMatchOptions {
  /** 是否忽略大小写，默认 false */
  ignoreCase?: boolean;
  /** 是否忽略首尾空白，默认 true */
  trim?: boolean;
}

export class ExactMatchEvaluator implements Evaluator {
  readonly name = 'exact_match';
  private ignoreCase: boolean;
  private trim: boolean;

  constructor(options: ExactMatchOptions = {}) {
    this.ignoreCase = options.ignoreCase ?? false;
    this.trim = options.trim ?? true;
  }

  async evaluate(input: EvalInput): Promise<EvalResult> {
    if (!input.expected) {
      return {
        evaluatorName: this.name,
        score: 0,
        passed: false,
        reason: 'No expected value provided',
      };
    }

    let output = input.output;
    let expected = input.expected;

    if (this.trim) {
      output = output.trim();
      expected = expected.trim();
    }
    if (this.ignoreCase) {
      output = output.toLowerCase();
      expected = expected.toLowerCase();
    }

    const match = output === expected;
    return {
      evaluatorName: this.name,
      score: match ? 1 : 0,
      passed: match,
      reason: match
        ? 'Output exactly matches expected'
        : `Output does not match expected. Got "${input.output.slice(0, 100)}"`,
    };
  }
}

// ============================================================
// Contains -- 包含关键词
// ============================================================

export interface ContainsOptions {
  /** 必须包含的所有关键词 */
  keywords: string[];
  /** 是否忽略大小写，默认 true */
  ignoreCase?: boolean;
  /** 需要匹配的最少关键词数量（默认全部） */
  minMatches?: number;
}

export class ContainsEvaluator implements Evaluator {
  readonly name = 'contains';
  private keywords: string[];
  private ignoreCase: boolean;
  private minMatches: number;

  constructor(options: ContainsOptions) {
    this.keywords = options.keywords;
    this.ignoreCase = options.ignoreCase ?? true;
    this.minMatches = options.minMatches ?? options.keywords.length;
  }

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const output = this.ignoreCase ? input.output.toLowerCase() : input.output;
    const matched: string[] = [];
    const missed: string[] = [];

    for (const kw of this.keywords) {
      const target = this.ignoreCase ? kw.toLowerCase() : kw;
      if (output.includes(target)) {
        matched.push(kw);
      } else {
        missed.push(kw);
      }
    }

    const score = this.keywords.length > 0
      ? matched.length / this.keywords.length
      : 1;
    const passed = matched.length >= this.minMatches;

    return {
      evaluatorName: this.name,
      score,
      passed,
      reason: passed
        ? `Found ${matched.length}/${this.keywords.length} keywords`
        : `Missing keywords: ${missed.join(', ')}`,
      metadata: { matched, missed },
    };
  }
}

// ============================================================
// Regex -- 正则匹配
// ============================================================

export interface RegexOptions {
  /** 正则表达式模式 */
  pattern: string;
  /** 正则标志，默认 'i' */
  flags?: string;
}

export class RegexEvaluator implements Evaluator {
  readonly name = 'regex';
  private regex: RegExp;

  constructor(options: RegexOptions) {
    this.regex = new RegExp(options.pattern, options.flags ?? 'i');
  }

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const match = this.regex.test(input.output);
    return {
      evaluatorName: this.name,
      score: match ? 1 : 0,
      passed: match,
      reason: match
        ? `Output matches pattern /${this.regex.source}/${this.regex.flags}`
        : `Output does not match pattern /${this.regex.source}/${this.regex.flags}`,
    };
  }
}

// ============================================================
// Length -- 长度检查
// ============================================================

export interface LengthOptions {
  minLength?: number;
  maxLength?: number;
}

export class LengthEvaluator implements Evaluator {
  readonly name = 'length';
  private minLength: number;
  private maxLength: number;

  constructor(options: LengthOptions = {}) {
    this.minLength = options.minLength ?? 0;
    this.maxLength = options.maxLength ?? Infinity;
  }

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const len = input.output.length;
    const passed = len >= this.minLength && len <= this.maxLength;

    let reason: string;
    if (len < this.minLength) {
      reason = `Output too short: ${len} < ${this.minLength}`;
    } else if (len > this.maxLength) {
      reason = `Output too long: ${len} > ${this.maxLength}`;
    } else {
      reason = `Length ${len} within range [${this.minLength}, ${this.maxLength === Infinity ? '∞' : this.maxLength}]`;
    }

    const range = this.maxLength === Infinity
      ? Math.min(1, len / Math.max(this.minLength, 1))
      : 1 - Math.abs(len - (this.minLength + this.maxLength) / 2) / ((this.maxLength - this.minLength) / 2 || 1);
    const score = passed ? Math.max(0, Math.min(1, range)) : 0;

    return { evaluatorName: this.name, score, passed, reason };
  }
}

// ============================================================
// JsonValid -- JSON 格式校验
// ============================================================

export class JsonValidEvaluator implements Evaluator {
  readonly name = 'json_valid';

  async evaluate(input: EvalInput): Promise<EvalResult> {
    try {
      JSON.parse(input.output);
      return {
        evaluatorName: this.name,
        score: 1,
        passed: true,
        reason: 'Output is valid JSON',
      };
    } catch (err) {
      return {
        evaluatorName: this.name,
        score: 0,
        passed: false,
        reason: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// ============================================================
// Latency -- 延迟阈值
// ============================================================

export interface LatencyOptions {
  maxMs: number;
}

export class LatencyEvaluator implements Evaluator {
  readonly name = 'latency';
  private maxMs: number;

  constructor(options: LatencyOptions) {
    this.maxMs = options.maxMs;
  }

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const durationMs = (input.metadata?.durationMs as number) ?? 0;
    const passed = durationMs <= this.maxMs;
    const score = passed ? 1 - durationMs / this.maxMs : 0;

    return {
      evaluatorName: this.name,
      score: Math.max(0, score),
      passed,
      reason: passed
        ? `Latency ${durationMs}ms within ${this.maxMs}ms threshold`
        : `Latency ${durationMs}ms exceeds ${this.maxMs}ms threshold`,
      metadata: { durationMs, maxMs: this.maxMs },
    };
  }
}

// ============================================================
// Cost -- 成本阈值
// ============================================================

export interface CostOptions {
  maxCostUsd: number;
}

export class CostEvaluator implements Evaluator {
  readonly name = 'cost';
  private maxCostUsd: number;

  constructor(options: CostOptions) {
    this.maxCostUsd = options.maxCostUsd;
  }

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const cost = (input.metadata?.costUsd as number) ?? 0;
    const passed = cost <= this.maxCostUsd;

    return {
      evaluatorName: this.name,
      score: passed ? 1 : 0,
      passed,
      reason: passed
        ? `Cost $${cost.toFixed(4)} within $${this.maxCostUsd.toFixed(4)} budget`
        : `Cost $${cost.toFixed(4)} exceeds $${this.maxCostUsd.toFixed(4)} budget`,
      metadata: { cost, maxCostUsd: this.maxCostUsd },
    };
  }
}

// ============================================================
// Composite -- 组合评估器
// ============================================================

export type AggregationStrategy = 'all' | 'any' | 'average' | 'weighted';

export interface CompositeOptions {
  evaluators: Evaluator[];
  strategy?: AggregationStrategy;
  /** 当 strategy 为 'weighted' 时，每个评估器的权重 */
  weights?: number[];
}

export class CompositeEvaluator implements Evaluator {
  readonly name = 'composite';
  private evaluators: Evaluator[];
  private strategy: AggregationStrategy;
  private weights: number[];

  constructor(options: CompositeOptions) {
    this.evaluators = options.evaluators;
    this.strategy = options.strategy ?? 'all';
    this.weights = options.weights ?? options.evaluators.map(() => 1);
  }

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const results = await Promise.all(
      this.evaluators.map((e) => e.evaluate(input))
    );

    let score: number;
    let passed: boolean;

    switch (this.strategy) {
      case 'all':
        passed = results.every((r) => r.passed);
        score = results.reduce((sum, r) => sum + r.score, 0) / results.length;
        break;

      case 'any':
        passed = results.some((r) => r.passed);
        score = Math.max(...results.map((r) => r.score));
        break;

      case 'average':
        score = results.reduce((sum, r) => sum + r.score, 0) / results.length;
        passed = score >= 0.5;
        break;

      case 'weighted': {
        const totalWeight = this.weights.reduce((a, b) => a + b, 0);
        score = results.reduce((sum, r, i) => sum + r.score * (this.weights[i] ?? 1), 0) / totalWeight;
        passed = score >= 0.5;
        break;
      }
    }

    const failedNames = results.filter((r) => !r.passed).map((r) => r.evaluatorName);

    return {
      evaluatorName: this.name,
      score,
      passed,
      reason: passed
        ? `All criteria met (${results.length} evaluators, strategy: ${this.strategy})`
        : `Failed evaluators: ${failedNames.join(', ')}`,
      metadata: {
        strategy: this.strategy,
        subResults: results,
      },
    };
  }
}
