/**
 * Dashboard -- 单元测试
 */

import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '../metrics.js';
import { Dashboard } from '../dashboard.js';
import type { TraceData } from '../trace.js';

describe('Dashboard', () => {
  it('应生成完整的 Metrics 报表', () => {
    const metrics = new MetricsCollector();
    metrics.recordTokenUsage(1000, 500, 'gpt-4o');
    metrics.recordTokenUsage(800, 300, 'gpt-4o');
    metrics.recordLatency('llm.call', 200);
    metrics.recordLatency('llm.call', 400);
    metrics.recordLatency('tool.execute', 50);
    metrics.recordSuccess('agent.run');
    metrics.recordSuccess('agent.run');
    metrics.recordFailure('agent.run');

    const dashboard = new Dashboard(metrics);
    const report = dashboard.generateReport();

    expect(report).toContain('Token Usage');
    expect(report).toContain('1,800');
    expect(report).toContain('800');
    expect(report).toContain('Latency');
    expect(report).toContain('llm.call');
    expect(report).toContain('Success / Failure');
    expect(report).toContain('66.7%');
    expect(report).toContain('Cost Estimate');
    expect(report).toContain('gpt-4o');
  });

  it('空数据时不应崩溃', () => {
    const metrics = new MetricsCollector();
    const dashboard = new Dashboard(metrics);
    const report = dashboard.generateReport();

    expect(report).toContain('Token Usage');
    expect(report).toContain('Total Calls:        0');
  });

  it('应生成 Trace 时间线', () => {
    const metrics = new MetricsCollector();
    const dashboard = new Dashboard(metrics);

    const trace: TraceData = {
      traceId: 'trace-1',
      name: 'agent.run',
      startTime: 1000,
      endTime: 2000,
      durationMs: 1000,
      status: 'ok',
      spans: [
        {
          spanId: 'span-1',
          traceId: 'trace-1',
          name: 'agent.execute',
          kind: 'agent',
          status: 'ok',
          startTime: 1000,
          endTime: 2000,
          durationMs: 1000,
          attributes: {},
          events: [],
        },
        {
          spanId: 'span-2',
          traceId: 'trace-1',
          parentSpanId: 'span-1',
          name: 'tool.calculator',
          kind: 'tool',
          status: 'ok',
          startTime: 1100,
          endTime: 1200,
          durationMs: 100,
          attributes: {},
          events: [],
        },
        {
          spanId: 'span-3',
          traceId: 'trace-1',
          parentSpanId: 'span-1',
          name: 'llm.chat',
          kind: 'llm',
          status: 'error',
          startTime: 1300,
          endTime: 1500,
          durationMs: 200,
          attributes: {},
          events: [],
          error: 'Timeout',
        },
      ],
      attributes: {},
    };

    const timeline = dashboard.generateTraceTimeline(trace);
    expect(timeline).toContain('agent.run');
    expect(timeline).toContain('agent.execute');
    expect(timeline).toContain('tool.calculator');
    expect(timeline).toContain('llm.chat');
    expect(timeline).toContain('Timeout');
    expect(timeline).toContain('1000ms');
  });

  it('应生成单行状态', () => {
    const metrics = new MetricsCollector();
    metrics.recordTokenUsage(500, 200, 'gpt-4o');
    metrics.recordSuccess('agent.run');

    const dashboard = new Dashboard(metrics);
    const line = dashboard.generateStatusLine();

    expect(line).toContain('Tokens:');
    expect(line).toContain('Cost:');
    expect(line).toContain('Calls:');
    expect(line).toContain('Success:');
  });

  it('无 Span 的 Trace 时间线应显示提示', () => {
    const metrics = new MetricsCollector();
    const dashboard = new Dashboard(metrics);

    const trace: TraceData = {
      traceId: 'trace-1',
      name: 'empty-trace',
      startTime: 1000,
      status: 'ok',
      spans: [],
      attributes: {},
    };

    const timeline = dashboard.generateTraceTimeline(trace);
    expect(timeline).toContain('no spans');
  });
});
