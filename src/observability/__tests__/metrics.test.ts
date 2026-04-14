/**
 * MetricsCollector -- 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  // ============================================================
  // Token 指标
  // ============================================================

  describe('Token Metrics', () => {
    it('应记录和聚合 Token 用量', () => {
      metrics.recordTokenUsage(100, 50, 'gpt-4o');
      metrics.recordTokenUsage(200, 80, 'gpt-4o');

      const m = metrics.getTokenMetrics();
      expect(m.totalPromptTokens).toBe(300);
      expect(m.totalCompletionTokens).toBe(130);
      expect(m.totalTokens).toBe(430);
      expect(m.callCount).toBe(2);
      expect(m.avgPromptTokens).toBe(150);
      expect(m.avgCompletionTokens).toBe(65);
    });

    it('应按模型过滤', () => {
      metrics.recordTokenUsage(100, 50, 'gpt-4o');
      metrics.recordTokenUsage(200, 80, 'gpt-4o-mini');

      const m = metrics.getTokenMetrics('gpt-4o-mini');
      expect(m.callCount).toBe(1);
      expect(m.totalPromptTokens).toBe(200);
    });

    it('无记录时应返回零值', () => {
      const m = metrics.getTokenMetrics();
      expect(m.callCount).toBe(0);
      expect(m.totalTokens).toBe(0);
      expect(m.avgPromptTokens).toBe(0);
    });
  });

  // ============================================================
  // 延迟指标
  // ============================================================

  describe('Latency Metrics', () => {
    it('应记录并计算百分位数', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const v of values) {
        metrics.recordLatency('llm.call', v);
      }

      const m = metrics.getLatencyMetrics('llm.call');
      expect(m.count).toBe(10);
      expect(m.minMs).toBe(10);
      expect(m.maxMs).toBe(100);
      expect(m.avgMs).toBe(55);
      expect(m.p50Ms).toBe(50);
      expect(m.p95Ms).toBe(100);
    });

    it('单个记录时百分位数应与该值相同', () => {
      metrics.recordLatency('single', 42);
      const m = metrics.getLatencyMetrics('single');
      expect(m.p50Ms).toBe(42);
      expect(m.p95Ms).toBe(42);
      expect(m.p99Ms).toBe(42);
    });

    it('无记录时应返回零值', () => {
      const m = metrics.getLatencyMetrics('nonexistent');
      expect(m.count).toBe(0);
      expect(m.avgMs).toBe(0);
    });

    it('应列出所有延迟分类', () => {
      metrics.recordLatency('cat-a', 10);
      metrics.recordLatency('cat-b', 20);
      expect(metrics.getLatencyCategories()).toEqual(['cat-a', 'cat-b']);
    });
  });

  // ============================================================
  // 计数器
  // ============================================================

  describe('Counter Metrics', () => {
    it('应记录成功和失败次数', () => {
      metrics.recordSuccess('agent.run');
      metrics.recordSuccess('agent.run');
      metrics.recordFailure('agent.run');

      const m = metrics.getCounterMetrics('agent.run');
      expect(m.success).toBe(2);
      expect(m.failure).toBe(1);
      expect(m.total).toBe(3);
      expect(m.successRate).toBeCloseTo(0.667, 2);
    });

    it('无记录时 successRate 应为 0', () => {
      const m = metrics.getCounterMetrics('nonexistent');
      expect(m.total).toBe(0);
      expect(m.successRate).toBe(0);
    });
  });

  // ============================================================
  // 成本估算
  // ============================================================

  describe('Cost Estimation', () => {
    it('应基于默认价格表估算费用', () => {
      metrics.recordTokenUsage(1000, 500, 'gpt-4o');

      const cost = metrics.estimateCost('gpt-4o');
      expect(cost.model).toBe('gpt-4o');
      // gpt-4o: prompt $2.5/1M, completion $10/1M
      expect(cost.promptCost).toBeCloseTo(0.0025, 4);
      expect(cost.completionCost).toBeCloseTo(0.005, 4);
      expect(cost.totalCost).toBeCloseTo(0.0075, 4);
      expect(cost.currency).toBe('USD');
    });

    it('应支持自定义价格表', () => {
      metrics.recordTokenUsage(1_000_000, 500_000, 'my-model');
      metrics.setModelPricing('my-model', {
        promptPer1M: 1.0,
        completionPer1M: 2.0,
      });

      const cost = metrics.estimateCost('my-model');
      expect(cost.promptCost).toBeCloseTo(1.0, 4);
      expect(cost.completionCost).toBeCloseTo(1.0, 4);
    });

    it('未知模型应使用默认费率', () => {
      metrics.recordTokenUsage(1000, 500, 'unknown-model');
      const cost = metrics.estimateCost('unknown-model');
      expect(cost.totalCost).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // 汇总与重置
  // ============================================================

  describe('Summary & Reset', () => {
    it('getSummary 应包含所有指标', () => {
      metrics.recordTokenUsage(100, 50, 'gpt-4o');
      metrics.recordLatency('llm', 200);
      metrics.recordSuccess('agent');
      metrics.recordFailure('agent');

      const summary = metrics.getSummary();
      expect(summary.tokens.callCount).toBe(1);
      expect(summary.latency.llm).toBeDefined();
      expect(summary.counters.agent).toBeDefined();
      expect(summary.cost.totalCost).toBeGreaterThan(0);
    });

    it('reset 应清空所有数据', () => {
      metrics.recordTokenUsage(100, 50, 'gpt-4o');
      metrics.recordLatency('llm', 200);
      metrics.recordSuccess('agent');

      metrics.reset();

      expect(metrics.getTokenMetrics().callCount).toBe(0);
      expect(metrics.getLatencyCategories()).toHaveLength(0);
      expect(metrics.getCounterCategories()).toHaveLength(0);
    });
  });
});
