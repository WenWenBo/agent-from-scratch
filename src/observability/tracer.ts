/**
 * Tracer -- 追踪管理器
 *
 * 职责：
 * 1. 创建和管理 Trace / Span
 * 2. 维护 Span 栈（自动建立父子关系）
 * 3. 结束时将 Trace 推送给所有注册的 Exporter
 *
 * 设计参考: OpenTelemetry TracerProvider
 * https://opentelemetry.io/docs/specs/otel/trace/api/#tracerprovider
 */

import { Trace, Span } from './trace.js';
import type { SpanKind, SpanAttributes, TraceData } from './trace.js';
import type { SpanExporter } from './exporters.js';

// ============================================================
// Tracer 配置
// ============================================================

export interface TracerOptions {
  serviceName?: string;
  exporters?: SpanExporter[];
  /** 是否启用追踪（生产环境可关闭减少开销） */
  enabled?: boolean;
}

// ============================================================
// Tracer
// ============================================================

export class Tracer {
  readonly serviceName: string;
  private exporters: SpanExporter[];
  private enabled: boolean;

  private currentTrace: Trace | null = null;
  private spanStack: Span[] = [];
  private completedTraces: TraceData[] = [];

  constructor(options: TracerOptions = {}) {
    this.serviceName = options.serviceName ?? 'tiny-agent';
    this.exporters = options.exporters ?? [];
    this.enabled = options.enabled ?? true;
  }

  // ============================================================
  // Trace 生命周期
  // ============================================================

  startTrace(name: string, attributes?: SpanAttributes): Trace {
    if (!this.enabled) {
      return new Trace(name);
    }

    const trace = new Trace(name);
    trace.setAttribute('service.name', this.serviceName);
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) {
        if (v !== undefined) trace.setAttribute(k, v);
      }
    }

    this.currentTrace = trace;
    this.spanStack = [];
    return trace;
  }

  async endTrace(status: 'ok' | 'error' = 'ok'): Promise<void> {
    if (!this.enabled || !this.currentTrace) return;

    this.currentTrace.end(status);
    const data = this.currentTrace.toData();
    this.completedTraces.push(data);

    for (const exporter of this.exporters) {
      try {
        await exporter.export(data);
      } catch {
        // exporter 失败不应中断主流程
      }
    }

    this.currentTrace = null;
    this.spanStack = [];
  }

  // ============================================================
  // Span 生命周期
  // ============================================================

  startSpan(name: string, kind: SpanKind, attributes?: SpanAttributes): Span {
    if (!this.enabled || !this.currentTrace) {
      return new Span({ traceId: 'noop', name, kind });
    }

    const parentSpan = this.spanStack.length > 0
      ? this.spanStack[this.spanStack.length - 1]
      : undefined;

    const span = new Span({
      traceId: this.currentTrace.traceId,
      parentSpanId: parentSpan?.spanId,
      name,
      kind,
    });

    if (attributes) span.setAttributes(attributes);

    this.currentTrace.addSpan(span);
    this.spanStack.push(span);

    return span;
  }

  endSpan(status: 'ok' | 'error' = 'ok', error?: string): void {
    if (!this.enabled || this.spanStack.length === 0) return;

    const span = this.spanStack.pop()!;
    span.end(status, error);
  }

  /**
   * 包装一个异步操作，自动创建 Span 并在结束时关闭
   */
  async withSpan<T>(
    name: string,
    kind: SpanKind,
    fn: (span: Span) => Promise<T>,
    attributes?: SpanAttributes
  ): Promise<T> {
    const span = this.startSpan(name, kind, attributes);
    try {
      const result = await fn(span);
      this.endSpan('ok');
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.endSpan('error', errorMsg);
      throw err;
    }
  }

  // ============================================================
  // 查询
  // ============================================================

  get activeTrace(): Trace | null {
    return this.currentTrace;
  }

  get activeSpan(): Span | undefined {
    return this.spanStack.length > 0
      ? this.spanStack[this.spanStack.length - 1]
      : undefined;
  }

  getCompletedTraces(): TraceData[] {
    return [...this.completedTraces];
  }

  clearCompletedTraces(): void {
    this.completedTraces = [];
  }

  // ============================================================
  // Exporter 管理
  // ============================================================

  addExporter(exporter: SpanExporter): void {
    this.exporters.push(exporter);
  }

  removeExporter(exporter: SpanExporter): void {
    this.exporters = this.exporters.filter((e) => e !== exporter);
  }
}
