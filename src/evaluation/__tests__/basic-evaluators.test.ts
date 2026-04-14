/**
 * 基础评估器 -- 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  ExactMatchEvaluator,
  ContainsEvaluator,
  RegexEvaluator,
  LengthEvaluator,
  JsonValidEvaluator,
  LatencyEvaluator,
  CostEvaluator,
  CompositeEvaluator,
} from '../basic-evaluators.js';
import type { EvalInput } from '../evaluator.js';

const makeInput = (output: string, expected?: string, metadata?: Record<string, unknown>): EvalInput => ({
  input: 'test question',
  output,
  expected,
  metadata,
});

// ============================================================
// ExactMatch
// ============================================================

describe('ExactMatchEvaluator', () => {
  it('应精确匹配', async () => {
    const ev = new ExactMatchEvaluator();
    const r = await ev.evaluate(makeInput('42', '42'));
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
  });

  it('不匹配时 score 为 0', async () => {
    const ev = new ExactMatchEvaluator();
    const r = await ev.evaluate(makeInput('41', '42'));
    expect(r.score).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('应自动 trim 空白', async () => {
    const ev = new ExactMatchEvaluator({ trim: true });
    const r = await ev.evaluate(makeInput('  42  ', '42'));
    expect(r.passed).toBe(true);
  });

  it('应支持忽略大小写', async () => {
    const ev = new ExactMatchEvaluator({ ignoreCase: true });
    const r = await ev.evaluate(makeInput('Hello World', 'hello world'));
    expect(r.passed).toBe(true);
  });

  it('无 expected 时应返回 score 0', async () => {
    const ev = new ExactMatchEvaluator();
    const r = await ev.evaluate(makeInput('42'));
    expect(r.passed).toBe(false);
  });
});

// ============================================================
// Contains
// ============================================================

describe('ContainsEvaluator', () => {
  it('应检查所有关键词', async () => {
    const ev = new ContainsEvaluator({ keywords: ['python', 'javascript'] });
    const r = await ev.evaluate(makeInput('I know Python and JavaScript'));
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });

  it('缺失部分关键词时应降分', async () => {
    const ev = new ContainsEvaluator({ keywords: ['python', 'javascript', 'rust'] });
    const r = await ev.evaluate(makeInput('I know Python'));
    expect(r.score).toBeCloseTo(1 / 3, 2);
    expect(r.passed).toBe(false);
  });

  it('应支持 minMatches', async () => {
    const ev = new ContainsEvaluator({ keywords: ['a', 'b', 'c'], minMatches: 2 });
    const r = await ev.evaluate(makeInput('has a and b'));
    expect(r.passed).toBe(true);
  });

  it('应默认忽略大小写', async () => {
    const ev = new ContainsEvaluator({ keywords: ['HELLO'] });
    const r = await ev.evaluate(makeInput('hello world'));
    expect(r.passed).toBe(true);
  });
});

// ============================================================
// Regex
// ============================================================

describe('RegexEvaluator', () => {
  it('应匹配正则模式', async () => {
    const ev = new RegexEvaluator({ pattern: '\\d+\\.\\d+' });
    const r = await ev.evaluate(makeInput('The answer is 3.14'));
    expect(r.passed).toBe(true);
  });

  it('不匹配时应失败', async () => {
    const ev = new RegexEvaluator({ pattern: '^\\d+$' });
    const r = await ev.evaluate(makeInput('not a number'));
    expect(r.passed).toBe(false);
  });
});

// ============================================================
// Length
// ============================================================

describe('LengthEvaluator', () => {
  it('应检查最小长度', async () => {
    const ev = new LengthEvaluator({ minLength: 10 });
    const r = await ev.evaluate(makeInput('short'));
    expect(r.passed).toBe(false);
  });

  it('应检查最大长度', async () => {
    const ev = new LengthEvaluator({ maxLength: 5 });
    const r = await ev.evaluate(makeInput('too long text'));
    expect(r.passed).toBe(false);
  });

  it('在范围内应通过', async () => {
    const ev = new LengthEvaluator({ minLength: 5, maxLength: 20 });
    const r = await ev.evaluate(makeInput('just right'));
    expect(r.passed).toBe(true);
  });
});

// ============================================================
// JsonValid
// ============================================================

describe('JsonValidEvaluator', () => {
  it('有效 JSON 应通过', async () => {
    const ev = new JsonValidEvaluator();
    const r = await ev.evaluate(makeInput('{"key": "value"}'));
    expect(r.passed).toBe(true);
  });

  it('无效 JSON 应失败', async () => {
    const ev = new JsonValidEvaluator();
    const r = await ev.evaluate(makeInput('not json'));
    expect(r.passed).toBe(false);
  });

  it('JSON 数组应通过', async () => {
    const ev = new JsonValidEvaluator();
    const r = await ev.evaluate(makeInput('[1, 2, 3]'));
    expect(r.passed).toBe(true);
  });
});

// ============================================================
// Latency
// ============================================================

describe('LatencyEvaluator', () => {
  it('延迟在阈值内应通过', async () => {
    const ev = new LatencyEvaluator({ maxMs: 1000 });
    const r = await ev.evaluate(makeInput('ok', undefined, { durationMs: 500 }));
    expect(r.passed).toBe(true);
    expect(r.score).toBe(0.5);
  });

  it('延迟超过阈值应失败', async () => {
    const ev = new LatencyEvaluator({ maxMs: 1000 });
    const r = await ev.evaluate(makeInput('ok', undefined, { durationMs: 1500 }));
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
  });
});

// ============================================================
// Cost
// ============================================================

describe('CostEvaluator', () => {
  it('成本在预算内应通过', async () => {
    const ev = new CostEvaluator({ maxCostUsd: 0.01 });
    const r = await ev.evaluate(makeInput('ok', undefined, { costUsd: 0.005 }));
    expect(r.passed).toBe(true);
  });

  it('成本超预算应失败', async () => {
    const ev = new CostEvaluator({ maxCostUsd: 0.01 });
    const r = await ev.evaluate(makeInput('ok', undefined, { costUsd: 0.05 }));
    expect(r.passed).toBe(false);
  });
});

// ============================================================
// Composite
// ============================================================

describe('CompositeEvaluator', () => {
  it('all 策略：全部通过才通过', async () => {
    const ev = new CompositeEvaluator({
      evaluators: [
        new ExactMatchEvaluator(),
        new ContainsEvaluator({ keywords: ['42'] }),
      ],
      strategy: 'all',
    });
    const r = await ev.evaluate(makeInput('42', '42'));
    expect(r.passed).toBe(true);
  });

  it('all 策略：一个失败就失败', async () => {
    const ev = new CompositeEvaluator({
      evaluators: [
        new ExactMatchEvaluator(),
        new ContainsEvaluator({ keywords: ['missing'] }),
      ],
      strategy: 'all',
    });
    const r = await ev.evaluate(makeInput('42', '42'));
    expect(r.passed).toBe(false);
  });

  it('any 策略：有一个通过就通过', async () => {
    const ev = new CompositeEvaluator({
      evaluators: [
        new ExactMatchEvaluator(),
        new ContainsEvaluator({ keywords: ['missing'] }),
      ],
      strategy: 'any',
    });
    const r = await ev.evaluate(makeInput('42', '42'));
    expect(r.passed).toBe(true);
  });

  it('weighted 策略：加权平均', async () => {
    const ev = new CompositeEvaluator({
      evaluators: [
        new ExactMatchEvaluator(),
        new ContainsEvaluator({ keywords: ['missing'] }),
      ],
      strategy: 'weighted',
      weights: [3, 1],
    });
    const r = await ev.evaluate(makeInput('42', '42'));
    // exact_match score=1 weight=3, contains score=0 weight=1 → (3*1 + 1*0) / 4 = 0.75
    expect(r.score).toBeCloseTo(0.75, 2);
    expect(r.passed).toBe(true);
  });

  it('average 策略：简单平均', async () => {
    const ev = new CompositeEvaluator({
      evaluators: [
        new ExactMatchEvaluator(),
        new ContainsEvaluator({ keywords: ['missing'] }),
      ],
      strategy: 'average',
    });
    const r = await ev.evaluate(makeInput('42', '42'));
    expect(r.score).toBeCloseTo(0.5, 2);
    expect(r.passed).toBe(true);
  });
});
