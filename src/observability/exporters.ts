/**
 * SpanExporter -- Trace 数据导出器
 *
 * 策略模式：不同的 Exporter 将 Trace 输出到不同目标。
 *
 * 内置实现：
 * 1. ConsoleExporter    -- 打印到控制台（开发调试）
 * 2. InMemoryExporter   -- 保留在内存（单元测试）
 * 3. JsonFileExporter   -- 写入 JSON Lines 文件（持久化）
 * 4. CallbackExporter   -- 调用自定义回调（灵活集成）
 *
 * 生产级系统中常见的 Exporter 目标：
 * - LangSmith (https://docs.smith.langchain.com/)
 * - Langfuse (https://langfuse.com/docs)
 * - OpenTelemetry Collector → Jaeger/Zipkin
 */

import type { TraceData, SpanData } from './trace.js';
import * as fs from 'node:fs/promises';

// ============================================================
// 接口定义
// ============================================================

export interface SpanExporter {
  readonly name: string;
  export(trace: TraceData): Promise<void>;
  shutdown?(): Promise<void>;
}

// ============================================================
// ConsoleExporter -- 开发阶段的可视化输出
// ============================================================

export interface ConsoleExporterOptions {
  /** 是否显示 Span 详细信息 */
  verbose?: boolean;
  /** 是否使用颜色 */
  colorize?: boolean;
}

export class ConsoleExporter implements SpanExporter {
  readonly name = 'console';
  private verbose: boolean;
  private colorize: boolean;

  constructor(options: ConsoleExporterOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.colorize = options.colorize ?? true;
  }

  async export(trace: TraceData): Promise<void> {
    const statusIcon = trace.status === 'ok' ? '✓' : '✗';
    const duration = trace.durationMs ? `${trace.durationMs}ms` : 'running';

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${statusIcon} Trace: ${trace.name} [${duration}]`);
    console.log(`  ID: ${trace.traceId}`);
    console.log(`  Spans: ${trace.spans.length}`);

    if (this.verbose) {
      this.printSpanTree(trace.spans);
    } else {
      this.printSpanSummary(trace.spans);
    }

    console.log('─'.repeat(60));
  }

  private printSpanSummary(spans: SpanData[]): void {
    const byKind = new Map<string, number>();
    let totalDuration = 0;
    let errorCount = 0;

    for (const span of spans) {
      byKind.set(span.kind, (byKind.get(span.kind) ?? 0) + 1);
      if (span.durationMs) totalDuration += span.durationMs;
      if (span.status === 'error') errorCount++;
    }

    console.log(`  Breakdown:`);
    for (const [kind, count] of byKind) {
      console.log(`    ${kind}: ${count}`);
    }
    if (errorCount > 0) {
      console.log(`  Errors: ${errorCount}`);
    }
  }

  private printSpanTree(spans: SpanData[]): void {
    const roots = spans.filter((s) => !s.parentSpanId);
    const childMap = new Map<string, SpanData[]>();

    for (const span of spans) {
      if (span.parentSpanId) {
        const children = childMap.get(span.parentSpanId) ?? [];
        children.push(span);
        childMap.set(span.parentSpanId, children);
      }
    }

    const printNode = (span: SpanData, indent: string, isLast: boolean): void => {
      const connector = isLast ? '└── ' : '├── ';
      const statusIcon = span.status === 'ok' ? '✓' : span.status === 'error' ? '✗' : '⟳';
      const duration = span.durationMs ? `${span.durationMs}ms` : '...';
      console.log(`${indent}${connector}${statusIcon} ${span.name} [${span.kind}] (${duration})`);

      if (this.verbose && span.error) {
        const errorIndent = indent + (isLast ? '    ' : '│   ');
        console.log(`${errorIndent}  Error: ${span.error}`);
      }

      const children = childMap.get(span.spanId) ?? [];
      for (let i = 0; i < children.length; i++) {
        const childIndent = indent + (isLast ? '    ' : '│   ');
        printNode(children[i]!, childIndent, i === children.length - 1);
      }
    };

    console.log(`  Span Tree:`);
    for (let i = 0; i < roots.length; i++) {
      printNode(roots[i]!, '  ', i === roots.length - 1);
    }
  }
}

// ============================================================
// InMemoryExporter -- 用于测试
// ============================================================

export class InMemoryExporter implements SpanExporter {
  readonly name = 'in-memory';
  private traces: TraceData[] = [];

  async export(trace: TraceData): Promise<void> {
    this.traces.push(trace);
  }

  getTraces(): TraceData[] {
    return [...this.traces];
  }

  getLastTrace(): TraceData | undefined {
    return this.traces[this.traces.length - 1];
  }

  getSpans(): SpanData[] {
    return this.traces.flatMap((t) => t.spans);
  }

  getSpansByKind(kind: string): SpanData[] {
    return this.getSpans().filter((s) => s.kind === kind);
  }

  getSpansByName(name: string): SpanData[] {
    return this.getSpans().filter((s) => s.name === name);
  }

  getErrorSpans(): SpanData[] {
    return this.getSpans().filter((s) => s.status === 'error');
  }

  clear(): void {
    this.traces = [];
  }

  get traceCount(): number {
    return this.traces.length;
  }

  get spanCount(): number {
    return this.getSpans().length;
  }
}

// ============================================================
// JsonFileExporter -- 持久化到 JSON Lines 文件
// ============================================================

export interface JsonFileExporterOptions {
  filePath: string;
  pretty?: boolean;
}

export class JsonFileExporter implements SpanExporter {
  readonly name = 'json-file';
  private filePath: string;
  private pretty: boolean;

  constructor(options: JsonFileExporterOptions) {
    this.filePath = options.filePath;
    this.pretty = options.pretty ?? false;
  }

  async export(trace: TraceData): Promise<void> {
    const line = this.pretty
      ? JSON.stringify(trace, null, 2)
      : JSON.stringify(trace);

    await fs.appendFile(this.filePath, line + '\n', 'utf-8');
  }

  async shutdown(): Promise<void> {
    // no-op，文件已在每次 export 时写入
  }

  async readTraces(): Promise<TraceData[]> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as TraceData);
    } catch {
      return [];
    }
  }
}

// ============================================================
// CallbackExporter -- 自定义回调
// ============================================================

export class CallbackExporter implements SpanExporter {
  readonly name = 'callback';
  private callback: (trace: TraceData) => void | Promise<void>;

  constructor(callback: (trace: TraceData) => void | Promise<void>) {
    this.callback = callback;
  }

  async export(trace: TraceData): Promise<void> {
    await this.callback(trace);
  }
}
