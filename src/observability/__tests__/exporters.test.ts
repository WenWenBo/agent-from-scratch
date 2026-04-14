/**
 * SpanExporter -- 单元测试
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  InMemoryExporter,
  JsonFileExporter,
  CallbackExporter,
  ConsoleExporter,
} from '../exporters.js';
import type { TraceData } from '../trace.js';

const makeTrace = (name: string, spanCount: number): TraceData => ({
  traceId: `trace-${name}`,
  name,
  startTime: Date.now(),
  endTime: Date.now() + 100,
  durationMs: 100,
  status: 'ok',
  spans: Array.from({ length: spanCount }, (_, i) => ({
    spanId: `span-${name}-${i}`,
    traceId: `trace-${name}`,
    name: `span-${i}`,
    kind: 'llm' as const,
    status: 'ok' as const,
    startTime: Date.now(),
    endTime: Date.now() + 50,
    durationMs: 50,
    attributes: { step: i },
    events: [],
  })),
  attributes: { env: 'test' },
});

// ============================================================
// InMemoryExporter
// ============================================================

describe('InMemoryExporter', () => {
  it('应存储和查询 Trace', async () => {
    const exporter = new InMemoryExporter();
    await exporter.export(makeTrace('t1', 2));
    await exporter.export(makeTrace('t2', 3));

    expect(exporter.traceCount).toBe(2);
    expect(exporter.spanCount).toBe(5);
  });

  it('应按 Kind 过滤 Span', async () => {
    const exporter = new InMemoryExporter();
    await exporter.export(makeTrace('t1', 3));

    const llmSpans = exporter.getSpansByKind('llm');
    expect(llmSpans).toHaveLength(3);
  });

  it('应按 Name 过滤 Span', async () => {
    const exporter = new InMemoryExporter();
    await exporter.export(makeTrace('t1', 3));

    const spans = exporter.getSpansByName('span-0');
    expect(spans).toHaveLength(1);
  });

  it('getLastTrace 应返回最新的 Trace', async () => {
    const exporter = new InMemoryExporter();
    await exporter.export(makeTrace('first', 1));
    await exporter.export(makeTrace('second', 1));

    expect(exporter.getLastTrace()?.name).toBe('second');
  });

  it('clear 应清空所有数据', async () => {
    const exporter = new InMemoryExporter();
    await exporter.export(makeTrace('t1', 2));
    exporter.clear();

    expect(exporter.traceCount).toBe(0);
    expect(exporter.spanCount).toBe(0);
  });
});

// ============================================================
// JsonFileExporter
// ============================================================

describe('JsonFileExporter', () => {
  const testFile = path.join(os.tmpdir(), `trace-test-${Date.now()}.jsonl`);

  afterAll(async () => {
    await fs.rm(testFile, { force: true });
  });

  it('应写入 JSON Lines 文件', async () => {
    const exporter = new JsonFileExporter({ filePath: testFile });
    await exporter.export(makeTrace('t1', 2));
    await exporter.export(makeTrace('t2', 1));

    const traces = await exporter.readTraces();
    expect(traces).toHaveLength(2);
    expect(traces[0].name).toBe('t1');
    expect(traces[1].name).toBe('t2');
  });

  it('readTraces 对不存在的文件应返回空数组', async () => {
    const exporter = new JsonFileExporter({ filePath: '/tmp/nonexistent.jsonl' });
    const traces = await exporter.readTraces();
    expect(traces).toHaveLength(0);
  });
});

// ============================================================
// CallbackExporter
// ============================================================

describe('CallbackExporter', () => {
  it('应调用自定义回调', async () => {
    const received: TraceData[] = [];
    const exporter = new CallbackExporter((trace) => {
      received.push(trace);
    });

    await exporter.export(makeTrace('t1', 1));
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('t1');
  });

  it('应支持异步回调', async () => {
    let saved = false;
    const exporter = new CallbackExporter(async () => {
      await new Promise((r) => setTimeout(r, 10));
      saved = true;
    });

    await exporter.export(makeTrace('t1', 1));
    expect(saved).toBe(true);
  });
});

// ============================================================
// ConsoleExporter
// ============================================================

describe('ConsoleExporter', () => {
  it('应正常输出不抛错（summary 模式）', async () => {
    const exporter = new ConsoleExporter({ verbose: false });
    await expect(
      exporter.export(makeTrace('test', 3))
    ).resolves.not.toThrow();
  });

  it('应正常输出不抛错（verbose 模式）', async () => {
    const trace = makeTrace('verbose-test', 2);
    // 添加父子关系
    trace.spans[1]!.parentSpanId = trace.spans[0]!.spanId;

    const exporter = new ConsoleExporter({ verbose: true });
    await expect(exporter.export(trace)).resolves.not.toThrow();
  });
});
