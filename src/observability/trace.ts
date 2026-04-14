/**
 * Trace & Span -- 分布式追踪的核心数据结构
 *
 * 借鉴 OpenTelemetry 的概念模型：
 * - Trace: 一次完整的 Agent 执行（从用户输入到最终回复）
 * - Span:  Trace 中的一个操作单元（LLM 调用、工具执行、Pipeline 步骤...）
 *
 * OpenTelemetry 参考: https://opentelemetry.io/docs/concepts/signals/traces/
 *
 * Span 之间通过 parentSpanId 形成树形层级：
 *
 *   Trace (agent.run)
 *   ├── Span: llm.chat (step 1)
 *   ├── Span: tool.execute (step 1)
 *   │   └── Span: tool.calculator (子操作)
 *   ├── Span: llm.chat (step 2)
 *   └── Span: llm.chat (step 3) → final answer
 */

// ============================================================
// ID 生成
// ============================================================

let idCounter = 0;

export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  const seq = (++idCounter).toString(36);
  return `${prefix}${timestamp}-${random}-${seq}`;
}

// ============================================================
// Span 状态
// ============================================================

export type SpanStatus = 'running' | 'ok' | 'error';

export type SpanKind =
  | 'agent'
  | 'llm'
  | 'tool'
  | 'retrieval'
  | 'guardrail'
  | 'pipeline'
  | 'custom';

// ============================================================
// Span 属性
// ============================================================

export type SpanAttributes = Record<string, string | number | boolean | string[] | undefined>;

// ============================================================
// Span 事件（Span 内部的时间点标记）
// ============================================================

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

// ============================================================
// Span
// ============================================================

export interface SpanData {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: SpanAttributes;
  events: SpanEvent[];
  error?: string;
}

export class Span {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;

  private _status: SpanStatus = 'running';
  private _endTime?: number;
  private _attributes: SpanAttributes = {};
  private _events: SpanEvent[] = [];
  private _error?: string;

  constructor(options: {
    traceId: string;
    parentSpanId?: string;
    name: string;
    kind: SpanKind;
  }) {
    this.spanId = generateId('span-');
    this.traceId = options.traceId;
    this.parentSpanId = options.parentSpanId;
    this.name = options.name;
    this.kind = options.kind;
    this.startTime = Date.now();
  }

  get status(): SpanStatus {
    return this._status;
  }

  get endTime(): number | undefined {
    return this._endTime;
  }

  get durationMs(): number | undefined {
    return this._endTime ? this._endTime - this.startTime : undefined;
  }

  get attributes(): SpanAttributes {
    return { ...this._attributes };
  }

  get events(): SpanEvent[] {
    return [...this._events];
  }

  setAttribute(key: string, value: string | number | boolean | string[]): this {
    this._attributes[key] = value;
    return this;
  }

  setAttributes(attrs: SpanAttributes): this {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined) this._attributes[k] = v;
    }
    return this;
  }

  addEvent(name: string, attributes?: SpanAttributes): this {
    this._events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
    return this;
  }

  end(status: 'ok' | 'error' = 'ok', error?: string): void {
    if (this._status !== 'running') return;
    this._status = status;
    this._endTime = Date.now();
    if (error) this._error = error;
  }

  toData(): SpanData {
    return {
      spanId: this.spanId,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      status: this._status,
      startTime: this.startTime,
      endTime: this._endTime,
      durationMs: this.durationMs,
      attributes: { ...this._attributes },
      events: [...this._events],
      error: this._error,
    };
  }
}

// ============================================================
// Trace
// ============================================================

export interface TraceData {
  traceId: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: SpanStatus;
  spans: SpanData[];
  attributes: SpanAttributes;
}

export class Trace {
  readonly traceId: string;
  readonly name: string;
  readonly startTime: number;

  private _spans: Span[] = [];
  private _status: SpanStatus = 'running';
  private _endTime?: number;
  private _attributes: SpanAttributes = {};

  constructor(name: string) {
    this.traceId = generateId('trace-');
    this.name = name;
    this.startTime = Date.now();
  }

  get status(): SpanStatus {
    return this._status;
  }

  get spans(): Span[] {
    return [...this._spans];
  }

  get spanCount(): number {
    return this._spans.length;
  }

  setAttribute(key: string, value: string | number | boolean | string[]): this {
    this._attributes[key] = value;
    return this;
  }

  addSpan(span: Span): void {
    this._spans.push(span);
  }

  end(status: 'ok' | 'error' = 'ok'): void {
    if (this._status !== 'running') return;
    this._status = status;
    this._endTime = Date.now();

    for (const span of this._spans) {
      if (span.status === 'running') {
        span.end(status);
      }
    }
  }

  toData(): TraceData {
    return {
      traceId: this.traceId,
      name: this.name,
      startTime: this.startTime,
      endTime: this._endTime,
      durationMs: this._endTime ? this._endTime - this.startTime : undefined,
      status: this._status,
      spans: this._spans.map((s) => s.toData()),
      attributes: { ...this._attributes },
    };
  }
}
