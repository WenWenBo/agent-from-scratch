/**
 * Tracer -- 单元测试
 */

import { describe, it, expect } from 'vitest';
import { Tracer } from '../tracer.js';
import { InMemoryExporter } from '../exporters.js';

describe('Tracer', () => {
  it('应创建 Trace 并管理生命周期', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ exporters: [exporter] });

    const trace = tracer.startTrace('test');
    expect(tracer.activeTrace).toBe(trace);

    await tracer.endTrace('ok');
    expect(tracer.activeTrace).toBeNull();
    expect(exporter.traceCount).toBe(1);
  });

  it('应自动建立 Span 父子关系', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ exporters: [exporter] });

    tracer.startTrace('test');

    const parent = tracer.startSpan('parent', 'agent');
    const child = tracer.startSpan('child', 'llm');
    tracer.endSpan('ok');
    tracer.endSpan('ok');

    await tracer.endTrace('ok');

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(2);
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);
  });

  it('应支持深层嵌套 Span', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ exporters: [exporter] });

    tracer.startTrace('test');

    tracer.startSpan('level-1', 'agent');
    tracer.startSpan('level-2', 'llm');
    tracer.startSpan('level-3', 'tool');
    tracer.endSpan('ok');
    tracer.endSpan('ok');
    tracer.endSpan('ok');

    await tracer.endTrace('ok');

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(3);
    expect(spans[0].parentSpanId).toBeUndefined();
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);
    expect(spans[2].parentSpanId).toBe(spans[1].spanId);
  });

  it('withSpan 应自动管理 Span 生命周期', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ exporters: [exporter] });

    tracer.startTrace('test');

    const result = await tracer.withSpan('compute', 'custom', async (span) => {
      span.setAttribute('input', 42);
      return 42 * 2;
    });

    await tracer.endTrace('ok');

    expect(result).toBe(84);
    const span = exporter.getSpans()[0]!;
    expect(span.name).toBe('compute');
    expect(span.status).toBe('ok');
    expect(span.attributes.input).toBe(42);
  });

  it('withSpan 应在异常时标记 error', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ exporters: [exporter] });

    tracer.startTrace('test');

    await expect(
      tracer.withSpan('fail', 'custom', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    await tracer.endTrace('error');

    const span = exporter.getSpans()[0]!;
    expect(span.status).toBe('error');
    expect(span.error).toBe('boom');
  });

  it('disabled 模式下不应记录任何数据', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ enabled: false, exporters: [exporter] });

    tracer.startTrace('test');
    tracer.startSpan('span1', 'agent');
    tracer.endSpan('ok');
    await tracer.endTrace('ok');

    expect(exporter.traceCount).toBe(0);
  });

  it('应保留已完成的 Trace', async () => {
    const tracer = new Tracer();

    tracer.startTrace('trace-1');
    await tracer.endTrace('ok');

    tracer.startTrace('trace-2');
    await tracer.endTrace('ok');

    expect(tracer.getCompletedTraces()).toHaveLength(2);

    tracer.clearCompletedTraces();
    expect(tracer.getCompletedTraces()).toHaveLength(0);
  });

  it('应正确获取 activeSpan', () => {
    const tracer = new Tracer();
    tracer.startTrace('test');

    expect(tracer.activeSpan).toBeUndefined();

    tracer.startSpan('s1', 'agent');
    expect(tracer.activeSpan?.name).toBe('s1');

    tracer.startSpan('s2', 'llm');
    expect(tracer.activeSpan?.name).toBe('s2');

    tracer.endSpan('ok');
    expect(tracer.activeSpan?.name).toBe('s1');

    tracer.endSpan('ok');
    expect(tracer.activeSpan).toBeUndefined();
  });

  it('应支持添加和移除 Exporter', async () => {
    const tracer = new Tracer();
    const exporter = new InMemoryExporter();

    tracer.addExporter(exporter);
    tracer.startTrace('test');
    await tracer.endTrace('ok');
    expect(exporter.traceCount).toBe(1);

    tracer.removeExporter(exporter);
    tracer.startTrace('test2');
    await tracer.endTrace('ok');
    expect(exporter.traceCount).toBe(1);
  });

  it('Exporter 异常不应影响主流程', async () => {
    const badExporter = {
      name: 'bad',
      export: async () => { throw new Error('export failed'); },
    };
    const goodExporter = new InMemoryExporter();

    const tracer = new Tracer({ exporters: [badExporter, goodExporter] });

    tracer.startTrace('test');
    await tracer.endTrace('ok');

    expect(goodExporter.traceCount).toBe(1);
  });
});
