/**
 * CostTracker -- 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { CostTracker } from '../cost-tracker.js';

describe('CostTracker', () => {
  it('应正确计算单次调用成本', () => {
    const tracker = new CostTracker();
    const record = tracker.record('gpt-4o', 1000, 500);

    // gpt-4o: prompt $2.5/1M, completion $10/1M
    const expected = (1000 / 1e6) * 2.5 + (500 / 1e6) * 10;
    expect(record.costUsd).toBeCloseTo(expected, 6);
  });

  it('应累计总成本', () => {
    const tracker = new CostTracker();
    tracker.record('gpt-4o', 1000, 500);
    tracker.record('gpt-4o', 2000, 1000);

    const expected =
      (1000 / 1e6) * 2.5 + (500 / 1e6) * 10 +
      (2000 / 1e6) * 2.5 + (1000 / 1e6) * 10;
    expect(tracker.getTotalCost()).toBeCloseTo(expected, 6);
  });

  it('应支持自定义模型定价', () => {
    const tracker = new CostTracker();
    tracker.setModelPricing('custom-model', { promptPer1M: 1, completionPer1M: 5 });

    const record = tracker.record('custom-model', 1_000_000, 1_000_000);
    expect(record.costUsd).toBe(6); // $1 + $5
  });

  it('getCostByModel 应按模型分组', () => {
    const tracker = new CostTracker();
    tracker.record('gpt-4o', 1000, 500);
    tracker.record('gpt-4o-mini', 2000, 1000);
    tracker.record('gpt-4o', 3000, 1500);

    const byModel = tracker.getCostByModel();
    expect(byModel['gpt-4o']!.calls).toBe(2);
    expect(byModel['gpt-4o-mini']!.calls).toBe(1);
    expect(byModel['gpt-4o']!.tokens).toBe(1000 + 500 + 3000 + 1500);
  });

  describe('预算控制', () => {
    it('超过总预算应触发 exceeded 告警', () => {
      const alertFn = vi.fn();
      const tracker = new CostTracker({ totalBudget: 0.001 }, alertFn);

      tracker.record('gpt-4o', 100000, 50000);
      expect(alertFn).toHaveBeenCalled();

      const alert = alertFn.mock.calls[0]![0];
      expect(alert.type).toBe('exceeded');
    });

    it('接近总预算应触发 warning 告警', () => {
      const alertFn = vi.fn();
      const tracker = new CostTracker({
        totalBudget: 1.0,
        alertThreshold: 0.5,
      }, alertFn);

      // 制造一笔较大的费用：2M tokens at $2.5/1M = $5 (超过 $0.5 threshold)
      tracker.record('gpt-4o', 200000, 0);
      expect(alertFn).toHaveBeenCalled();
    });

    it('isBudgetExceeded 应正确判断', () => {
      const tracker = new CostTracker({ totalBudget: 0.0001 });
      expect(tracker.isBudgetExceeded()).toBe(false);

      tracker.record('gpt-4o', 1000000, 500000);
      expect(tracker.isBudgetExceeded()).toBe(true);
    });
  });

  it('getSummary 应返回完整摘要', () => {
    const tracker = new CostTracker({ totalBudget: 10 });
    tracker.record('gpt-4o', 1000, 500);
    tracker.record('gpt-4o-mini', 2000, 1000);

    const summary = tracker.getSummary();
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalTokens).toBe(1000 + 500 + 2000 + 1000);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.avgCostPerCall).toBeGreaterThan(0);
    expect(summary.budgetRemaining).toBeDefined();
    expect(summary.budgetRemaining).toBeLessThan(10);
  });

  it('reset 应清空所有数据', () => {
    const tracker = new CostTracker();
    tracker.record('gpt-4o', 1000, 500);

    tracker.reset();
    expect(tracker.getTotalCost()).toBe(0);
    expect(tracker.getAlerts()).toHaveLength(0);
  });

  it('getCostSince 应只统计指定时间之后的记录', async () => {
    const tracker = new CostTracker();
    tracker.record('gpt-4o', 1000, 500);

    await new Promise((r) => setTimeout(r, 15));
    const mid = Date.now();
    await new Promise((r) => setTimeout(r, 15));

    tracker.record('gpt-4o', 2000, 1000);

    const recentCost = tracker.getCostSince(mid);
    const totalCost = tracker.getTotalCost();
    expect(recentCost).toBeLessThan(totalCost);
    expect(recentCost).toBeGreaterThan(0);
  });
});
