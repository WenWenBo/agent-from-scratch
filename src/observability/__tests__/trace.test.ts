/**
 * Trace & Span -- 单元测试
 */

import { describe, it, expect } from 'vitest';
import { Trace, Span, generateId } from '../trace.js';

describe('generateId', () => {
  it('应生成唯一 ID', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('应支持前缀', () => {
    const id = generateId('test-');
    expect(id).toMatch(/^test-/);
  });
});

describe('Span', () => {
  it('应正确创建 Span', () => {
    const span = new Span({
      traceId: 'trace-1',
      name: 'test-span',
      kind: 'llm',
    });

    expect(span.spanId).toMatch(/^span-/);
    expect(span.traceId).toBe('trace-1');
    expect(span.name).toBe('test-span');
    expect(span.kind).toBe('llm');
    expect(span.status).toBe('running');
    expect(span.startTime).toBeLessThanOrEqual(Date.now());
  });

  it('应支持父 Span', () => {
    const span = new Span({
      traceId: 'trace-1',
      parentSpanId: 'parent-1',
      name: 'child-span',
      kind: 'tool',
    });

    expect(span.parentSpanId).toBe('parent-1');
  });

  it('应支持设置属性', () => {
    const span = new Span({ traceId: 't', name: 's', kind: 'agent' });
    span.setAttribute('key1', 'value1');
    span.setAttributes({ key2: 42, key3: true });

    expect(span.attributes.key1).toBe('value1');
    expect(span.attributes.key2).toBe(42);
    expect(span.attributes.key3).toBe(true);
  });

  it('应支持添加事件', () => {
    const span = new Span({ traceId: 't', name: 's', kind: 'agent' });
    span.addEvent('fetch-start', { url: 'http://example.com' });
    span.addEvent('fetch-end');

    expect(span.events).toHaveLength(2);
    expect(span.events[0].name).toBe('fetch-start');
    expect(span.events[0].attributes?.url).toBe('http://example.com');
    expect(span.events[1].name).toBe('fetch-end');
  });

  it('应正确结束 Span', () => {
    const span = new Span({ traceId: 't', name: 's', kind: 'llm' });
    expect(span.durationMs).toBeUndefined();

    span.end('ok');
    expect(span.status).toBe('ok');
    expect(span.endTime).toBeDefined();
    expect(span.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('应支持 error 状态结束', () => {
    const span = new Span({ traceId: 't', name: 's', kind: 'tool' });
    span.end('error', 'Something failed');

    expect(span.status).toBe('error');
    const data = span.toData();
    expect(data.error).toBe('Something failed');
  });

  it('不应重复结束', () => {
    const span = new Span({ traceId: 't', name: 's', kind: 'agent' });
    span.end('ok');
    const firstEnd = span.endTime;

    span.end('error', 'Should not apply');
    expect(span.status).toBe('ok');
    expect(span.endTime).toBe(firstEnd);
  });

  it('toData() 应返回完整快照', () => {
    const span = new Span({
      traceId: 'trace-1',
      parentSpanId: 'parent-1',
      name: 'test',
      kind: 'retrieval',
    });
    span.setAttribute('key', 'value');
    span.addEvent('ev');
    span.end('ok');

    const data = span.toData();
    expect(data.spanId).toBe(span.spanId);
    expect(data.traceId).toBe('trace-1');
    expect(data.parentSpanId).toBe('parent-1');
    expect(data.name).toBe('test');
    expect(data.kind).toBe('retrieval');
    expect(data.status).toBe('ok');
    expect(data.startTime).toBeDefined();
    expect(data.endTime).toBeDefined();
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
    expect(data.attributes.key).toBe('value');
    expect(data.events).toHaveLength(1);
  });
});

describe('Trace', () => {
  it('应正确创建 Trace', () => {
    const trace = new Trace('test-trace');

    expect(trace.traceId).toMatch(/^trace-/);
    expect(trace.name).toBe('test-trace');
    expect(trace.status).toBe('running');
    expect(trace.spanCount).toBe(0);
  });

  it('应支持添加 Span', () => {
    const trace = new Trace('test');
    const span = new Span({ traceId: trace.traceId, name: 's1', kind: 'llm' });
    trace.addSpan(span);

    expect(trace.spanCount).toBe(1);
    expect(trace.spans[0].spanId).toBe(span.spanId);
  });

  it('结束时应自动结束未关闭的 Span', () => {
    const trace = new Trace('test');
    const span1 = new Span({ traceId: trace.traceId, name: 's1', kind: 'llm' });
    const span2 = new Span({ traceId: trace.traceId, name: 's2', kind: 'tool' });
    span1.end('ok');
    trace.addSpan(span1);
    trace.addSpan(span2);

    trace.end('ok');

    expect(span1.status).toBe('ok');
    expect(span2.status).toBe('ok');
    expect(trace.status).toBe('ok');
  });

  it('toData() 应返回完整快照', () => {
    const trace = new Trace('test');
    trace.setAttribute('env', 'test');
    const span = new Span({ traceId: trace.traceId, name: 's1', kind: 'agent' });
    span.end('ok');
    trace.addSpan(span);
    trace.end('ok');

    const data = trace.toData();
    expect(data.traceId).toBe(trace.traceId);
    expect(data.name).toBe('test');
    expect(data.status).toBe('ok');
    expect(data.spans).toHaveLength(1);
    expect(data.attributes.env).toBe('test');
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('不应重复结束', () => {
    const trace = new Trace('test');
    trace.end('ok');
    trace.end('error');

    expect(trace.status).toBe('ok');
  });
});
