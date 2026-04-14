/**
 * EvalRunner -- 评估运行器
 *
 * 将 Agent 运行、评估器、黄金数据集串联起来，
 * 批量执行评估并生成结构化报告。
 *
 * 流程：
 *   GoldenDataset → Agent.run(case.input) → Evaluators → EvalReport
 *
 * 支持：
 * 1. 批量评估
 * 2. 并发控制
 * 3. 超时处理
 * 4. 多维度评估报告
 * 5. 评估结果的文本输出
 */

import type { Evaluator, EvalInput, EvalResult } from './evaluator.js';
import type { GoldenCase, GoldenDataset } from './golden-dataset.js';

// ============================================================
// Agent 接口（轻量，不直接依赖 Agent 类）
// ============================================================

export interface EvalTarget {
  run(input: string): Promise<{ content: string; usage?: { totalTokens: number } }>;
}

// ============================================================
// 评估报告
// ============================================================

export interface CaseResult {
  caseId: string;
  input: string;
  expected: string;
  actual: string;
  evaluations: EvalResult[];
  passed: boolean;
  avgScore: number;
  durationMs: number;
  error?: string;
}

export interface EvalReport {
  datasetName: string;
  timestamp: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  passRate: number;
  avgScore: number;
  evaluatorBreakdown: Record<string, {
    avgScore: number;
    passRate: number;
    passCount: number;
    failCount: number;
  }>;
  caseResults: CaseResult[];
  totalDurationMs: number;
}

// ============================================================
// 配置
// ============================================================

export interface EvalRunnerOptions {
  /** 被评估的 Agent */
  target: EvalTarget;
  /** 评估器列表 */
  evaluators: Evaluator[];
  /** 并发数，默认 1（串行） */
  concurrency?: number;
  /** 单个 case 超时（ms），默认 30000 */
  timeoutMs?: number;
  /** 进度回调 */
  onProgress?: (completed: number, total: number, caseResult: CaseResult) => void;
}

// ============================================================
// EvalRunner
// ============================================================

export class EvalRunner {
  private target: EvalTarget;
  private evaluators: Evaluator[];
  private concurrency: number;
  private timeoutMs: number;
  private onProgress?: (completed: number, total: number, caseResult: CaseResult) => void;

  constructor(options: EvalRunnerOptions) {
    this.target = options.target;
    this.evaluators = options.evaluators;
    this.concurrency = options.concurrency ?? 1;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.onProgress = options.onProgress;
  }

  // ============================================================
  // 批量评估
  // ============================================================

  async run(dataset: GoldenDataset): Promise<EvalReport> {
    const cases = dataset.getAll();
    const startTime = Date.now();
    const caseResults: CaseResult[] = [];

    if (this.concurrency <= 1) {
      for (let i = 0; i < cases.length; i++) {
        const result = await this.evaluateCase(cases[i]!);
        caseResults.push(result);
        this.onProgress?.(i + 1, cases.length, result);
      }
    } else {
      let completed = 0;
      const queue = [...cases];
      const workers: Promise<void>[] = [];

      for (let w = 0; w < Math.min(this.concurrency, queue.length); w++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              const c = queue.shift()!;
              const result = await this.evaluateCase(c);
              caseResults.push(result);
              completed++;
              this.onProgress?.(completed, cases.length, result);
            }
          })()
        );
      }

      await Promise.all(workers);
    }

    return this.buildReport(dataset.name, caseResults, Date.now() - startTime);
  }

  /**
   * 运行数据集的子集（按 tag 过滤）
   */
  async runByTag(dataset: GoldenDataset, tag: string): Promise<EvalReport> {
    const subset = new (dataset.constructor as any)(dataset.name + `[${tag}]`) as GoldenDataset;
    for (const c of dataset.filterByTag(tag)) {
      subset.add(c);
    }
    return this.run(subset);
  }

  // ============================================================
  // 单条评估
  // ============================================================

  async evaluateCase(goldenCase: GoldenCase): Promise<CaseResult> {
    const startTime = Date.now();

    let actual = '';
    let error: string | undefined;

    try {
      const result = await this.runWithTimeout(goldenCase.input);
      actual = result.content;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      actual = '';
    }

    const durationMs = Date.now() - startTime;

    if (error) {
      return {
        caseId: goldenCase.id,
        input: goldenCase.input,
        expected: goldenCase.expected,
        actual,
        evaluations: [],
        passed: false,
        avgScore: 0,
        durationMs,
        error,
      };
    }

    const evalInput: EvalInput = {
      input: goldenCase.input,
      output: actual,
      expected: goldenCase.expected,
      context: goldenCase.context,
      metadata: {
        ...goldenCase.metadata,
        durationMs,
      },
    };

    const evaluations = await Promise.all(
      this.evaluators.map((e) => e.evaluate(evalInput))
    );

    const avgScore = evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length
      : 0;
    const passed = evaluations.length > 0
      ? evaluations.every((e) => e.passed)
      : false;

    return {
      caseId: goldenCase.id,
      input: goldenCase.input,
      expected: goldenCase.expected,
      actual,
      evaluations,
      passed,
      avgScore,
      durationMs,
    };
  }

  // ============================================================
  // 超时控制
  // ============================================================

  private async runWithTimeout(
    input: string
  ): Promise<{ content: string }> {
    return Promise.race([
      this.target.run(input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Evaluation timeout after ${this.timeoutMs}ms`)), this.timeoutMs)
      ),
    ]);
  }

  // ============================================================
  // 报告构建
  // ============================================================

  private buildReport(
    datasetName: string,
    caseResults: CaseResult[],
    totalDurationMs: number
  ): EvalReport {
    const passedCases = caseResults.filter((r) => r.passed).length;
    const errorCases = caseResults.filter((r) => r.error).length;
    const failedCases = caseResults.length - passedCases - errorCases;

    const avgScore = caseResults.length > 0
      ? caseResults.reduce((sum, r) => sum + r.avgScore, 0) / caseResults.length
      : 0;

    // 按评估器分解
    const evaluatorBreakdown: EvalReport['evaluatorBreakdown'] = {};
    for (const evaluator of this.evaluators) {
      const results = caseResults.flatMap((cr) =>
        cr.evaluations.filter((e) => e.evaluatorName === evaluator.name)
      );
      const passCount = results.filter((r) => r.passed).length;
      evaluatorBreakdown[evaluator.name] = {
        avgScore: results.length > 0
          ? results.reduce((s, r) => s + r.score, 0) / results.length
          : 0,
        passRate: results.length > 0 ? passCount / results.length : 0,
        passCount,
        failCount: results.length - passCount,
      };
    }

    return {
      datasetName,
      timestamp: Date.now(),
      totalCases: caseResults.length,
      passedCases,
      failedCases,
      errorCases,
      passRate: caseResults.length > 0 ? passedCases / caseResults.length : 0,
      avgScore: Math.round(avgScore * 100) / 100,
      evaluatorBreakdown,
      caseResults,
      totalDurationMs,
    };
  }

  // ============================================================
  // 报告文本输出
  // ============================================================

  static formatReport(report: EvalReport): string {
    const lines: string[] = [];

    lines.push('╔══════════════════════════════════════════════════╗');
    lines.push('║            Agent Evaluation Report               ║');
    lines.push('╚══════════════════════════════════════════════════╝');
    lines.push('');
    lines.push(`Dataset:    ${report.datasetName}`);
    lines.push(`Timestamp:  ${new Date(report.timestamp).toISOString()}`);
    lines.push(`Duration:   ${(report.totalDurationMs / 1000).toFixed(1)}s`);
    lines.push('');

    // 总览
    lines.push('📊 Overview');
    lines.push(`  Total Cases:  ${report.totalCases}`);
    lines.push(`  Passed:       ${report.passedCases} (${(report.passRate * 100).toFixed(1)}%)`);
    lines.push(`  Failed:       ${report.failedCases}`);
    lines.push(`  Errors:       ${report.errorCases}`);
    lines.push(`  Avg Score:    ${(report.avgScore * 100).toFixed(1)}%`);

    // 按评估器分解
    const evaluators = Object.entries(report.evaluatorBreakdown);
    if (evaluators.length > 0) {
      lines.push('');
      lines.push('📋 Evaluator Breakdown');
      for (const [name, stats] of evaluators) {
        const bar = EvalRunner.progressBar(stats.passRate);
        lines.push(
          `  [${name}]  ${(stats.avgScore * 100).toFixed(0)}% avg  |  ` +
          `${stats.passCount}/${stats.passCount + stats.failCount} passed  ${bar}`
        );
      }
    }

    // 失败的 Case
    const failedCases = report.caseResults.filter((r) => !r.passed);
    if (failedCases.length > 0) {
      lines.push('');
      lines.push('❌ Failed Cases');
      for (const c of failedCases.slice(0, 10)) {
        lines.push(`  [${c.caseId}] Score: ${(c.avgScore * 100).toFixed(0)}% | ${c.durationMs}ms`);
        lines.push(`    Input:    ${c.input.slice(0, 80)}`);
        lines.push(`    Expected: ${c.expected.slice(0, 80)}`);
        lines.push(`    Actual:   ${c.actual.slice(0, 80)}`);
        if (c.error) {
          lines.push(`    Error:    ${c.error}`);
        }
        const failedEvals = c.evaluations.filter((e) => !e.passed);
        for (const fe of failedEvals) {
          lines.push(`    ✗ ${fe.evaluatorName}: ${fe.reason}`);
        }
      }
      if (failedCases.length > 10) {
        lines.push(`  ... and ${failedCases.length - 10} more`);
      }
    }

    lines.push('');
    lines.push('─'.repeat(50));

    return lines.join('\n');
  }

  private static progressBar(rate: number): string {
    const width = 15;
    const filled = Math.round(rate * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
  }
}
