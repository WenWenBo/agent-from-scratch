/**
 * EvalRunner -- 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { EvalRunner } from '../eval-runner.js';
import { GoldenDataset } from '../golden-dataset.js';
import { ExactMatchEvaluator, ContainsEvaluator } from '../basic-evaluators.js';
import type { CaseResult } from '../eval-runner.js';

function createMockTarget(answers: Record<string, string>) {
  return {
    run: vi.fn().mockImplementation(async (input: string) => ({
      content: answers[input] ?? 'unknown',
      usage: { totalTokens: 100 },
    })),
  };
}

function createDataset(): GoldenDataset {
  const ds = new GoldenDataset('test-suite');
  ds.addMany([
    { id: 'c1', input: 'What is 2+2?', expected: '4', tags: ['math'] },
    { id: 'c2', input: 'Capital of France?', expected: 'Paris', tags: ['geography'] },
    { id: 'c3', input: 'What color is the sky?', expected: 'blue', tags: ['science'] },
  ]);
  return ds;
}

describe('EvalRunner', () => {
  it('应正确执行批量评估', async () => {
    const target = createMockTarget({
      'What is 2+2?': '4',
      'Capital of France?': 'Paris',
      'What color is the sky?': 'blue',
    });

    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
    });

    const report = await runner.run(createDataset());

    expect(report.totalCases).toBe(3);
    expect(report.passedCases).toBe(3);
    expect(report.passRate).toBe(1);
    expect(report.avgScore).toBe(1);
    expect(report.datasetName).toBe('test-suite');
  });

  it('应统计失败的 case', async () => {
    const target = createMockTarget({
      'What is 2+2?': '4',
      'Capital of France?': 'Berlin',
      'What color is the sky?': 'green',
    });

    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
    });

    const report = await runner.run(createDataset());

    expect(report.passedCases).toBe(1);
    expect(report.failedCases).toBe(2);
    expect(report.passRate).toBeCloseTo(1 / 3, 2);
  });

  it('应支持多个评估器', async () => {
    const target = createMockTarget({
      'What is 2+2?': 'The answer is 4',
      'Capital of France?': 'Paris is the capital',
      'What color is the sky?': 'The sky is blue',
    });

    const runner = new EvalRunner({
      target,
      evaluators: [
        new ContainsEvaluator({ keywords: ['4'] }),
        new ContainsEvaluator({ keywords: ['Paris'] }),
      ],
    });

    const report = await runner.run(createDataset());
    expect(report.evaluatorBreakdown).toBeDefined();
  });

  it('应处理 Agent 异常', async () => {
    const target = {
      run: vi.fn().mockRejectedValue(new Error('Agent crashed')),
    };

    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
    });

    const report = await runner.run(createDataset());

    expect(report.errorCases).toBe(3);
    expect(report.passedCases).toBe(0);
    for (const r of report.caseResults) {
      expect(r.error).toContain('Agent crashed');
    }
  });

  it('应支持超时控制', async () => {
    const target = {
      run: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'late' }), 500))
      ),
    };

    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
      timeoutMs: 100,
    });

    const ds = new GoldenDataset('timeout-test');
    ds.add({ id: '1', input: 'Q', expected: 'A' });

    const report = await runner.run(ds);
    expect(report.errorCases).toBe(1);
    expect(report.caseResults[0].error).toContain('timeout');
  });

  it('应触发进度回调', async () => {
    const target = createMockTarget({
      'What is 2+2?': '4',
      'Capital of France?': 'Paris',
      'What color is the sky?': 'blue',
    });

    const progress: Array<{ completed: number; total: number }> = [];
    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
      onProgress: (completed, total) => {
        progress.push({ completed, total });
      },
    });

    await runner.run(createDataset());

    expect(progress).toHaveLength(3);
    expect(progress[0].completed).toBe(1);
    expect(progress[2].completed).toBe(3);
    expect(progress[2].total).toBe(3);
  });

  it('应生成可读的报告文本', async () => {
    const target = createMockTarget({
      'What is 2+2?': '4',
      'Capital of France?': 'Berlin',
      'What color is the sky?': 'blue',
    });

    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
    });

    const report = await runner.run(createDataset());
    const text = EvalRunner.formatReport(report);

    expect(text).toContain('Evaluation Report');
    expect(text).toContain('test-suite');
    expect(text).toContain('Passed');
    expect(text).toContain('Failed Cases');
    expect(text).toContain('exact_match');
  });

  it('evaluatorBreakdown 应按评估器分解', async () => {
    const target = createMockTarget({
      'What is 2+2?': '4',
      'Capital of France?': 'Berlin',
      'What color is the sky?': 'blue',
    });

    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
    });

    const report = await runner.run(createDataset());

    const breakdown = report.evaluatorBreakdown['exact_match']!;
    expect(breakdown.passCount).toBe(2);
    expect(breakdown.failCount).toBe(1);
    expect(breakdown.passRate).toBeCloseTo(2 / 3, 2);
  });

  it('应支持并发执行', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const target = {
      run: vi.fn().mockImplementation(async (input: string) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
        return { content: input === 'What is 2+2?' ? '4' : 'answer' };
      }),
    };

    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
      concurrency: 3,
    });

    const report = await runner.run(createDataset());

    expect(report.totalCases).toBe(3);
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
  });

  it('runByTag 应只运行匹配的 case', async () => {
    const target = createMockTarget({
      'What is 2+2?': '4',
    });

    const runner = new EvalRunner({
      target,
      evaluators: [new ExactMatchEvaluator()],
    });

    const report = await runner.runByTag(createDataset(), 'math');
    expect(report.totalCases).toBe(1);
    expect(report.passedCases).toBe(1);
  });
});
