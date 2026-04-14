/**
 * Dashboard -- 文本报表输出
 *
 * 将 MetricsCollector 和 Tracer 的数据以可读的文本格式输出。
 * 适用于 CLI 工具、日志系统、调试报告。
 *
 * 生产环境中可替换为 Web Dashboard（Grafana、Langfuse UI 等）。
 */

import { MetricsCollector } from './metrics.js';
import type { TraceData, SpanData } from './trace.js';

// ============================================================
// 报表生成
// ============================================================

export class Dashboard {
  private metrics: MetricsCollector;

  constructor(metrics: MetricsCollector) {
    this.metrics = metrics;
  }

  /**
   * 生成完整的 Metrics 报表
   */
  generateReport(): string {
    const summary = this.metrics.getSummary();
    const lines: string[] = [];

    lines.push('╔══════════════════════════════════════════════════╗');
    lines.push('║          TinyAgent Observability Report          ║');
    lines.push('╚══════════════════════════════════════════════════╝');

    // Token Usage
    lines.push('');
    lines.push('📊 Token Usage');
    lines.push(`  Total Calls:        ${summary.tokens.callCount}`);
    lines.push(`  Prompt Tokens:      ${summary.tokens.totalPromptTokens.toLocaleString()}`);
    lines.push(`  Completion Tokens:  ${summary.tokens.totalCompletionTokens.toLocaleString()}`);
    lines.push(`  Total Tokens:       ${summary.tokens.totalTokens.toLocaleString()}`);
    if (summary.tokens.callCount > 0) {
      lines.push(`  Avg Prompt/Call:    ${summary.tokens.avgPromptTokens.toLocaleString()}`);
      lines.push(`  Avg Completion/Call: ${summary.tokens.avgCompletionTokens.toLocaleString()}`);
    }

    // Latency
    const latencyCategories = Object.keys(summary.latency);
    if (latencyCategories.length > 0) {
      lines.push('');
      lines.push('⏱  Latency');
      for (const cat of latencyCategories) {
        const l = summary.latency[cat]!;
        lines.push(`  [${cat}]`);
        lines.push(`    Count: ${l.count}  |  Avg: ${l.avgMs}ms  |  P50: ${l.p50Ms}ms  |  P95: ${l.p95Ms}ms  |  P99: ${l.p99Ms}ms`);
        lines.push(`    Min: ${l.minMs}ms  |  Max: ${l.maxMs}ms  |  Total: ${l.totalMs}ms`);
      }
    }

    // Success/Failure
    const counterCategories = Object.keys(summary.counters);
    if (counterCategories.length > 0) {
      lines.push('');
      lines.push('✅ Success / Failure');
      for (const cat of counterCategories) {
        const c = summary.counters[cat]!;
        const bar = this.successBar(c.successRate);
        lines.push(`  [${cat}]  ${c.success}/${c.total} (${(c.successRate * 100).toFixed(1)}%) ${bar}`);
      }
    }

    // Cost
    lines.push('');
    lines.push('💰 Cost Estimate');
    lines.push(`  Model:       ${summary.cost.model}`);
    lines.push(`  Prompt:      $${summary.cost.promptCost.toFixed(4)}`);
    lines.push(`  Completion:  $${summary.cost.completionCost.toFixed(4)}`);
    lines.push(`  Total:       $${summary.cost.totalCost.toFixed(4)} ${summary.cost.currency}`);

    lines.push('');
    lines.push('─'.repeat(50));

    return lines.join('\n');
  }

  /**
   * 生成 Trace 时间线视图
   */
  generateTraceTimeline(trace: TraceData): string {
    const lines: string[] = [];
    const statusIcon = trace.status === 'ok' ? '✓' : '✗';

    lines.push(`Trace: ${trace.name} [${statusIcon}] ${trace.durationMs ?? '?'}ms`);
    lines.push(`ID: ${trace.traceId}`);
    lines.push('');

    if (trace.spans.length === 0) {
      lines.push('  (no spans)');
      return lines.join('\n');
    }

    const traceStart = trace.startTime;

    // 根 span 和子 span 映射
    const roots = trace.spans.filter((s) => !s.parentSpanId);
    const childMap = new Map<string, SpanData[]>();
    for (const span of trace.spans) {
      if (span.parentSpanId) {
        const children = childMap.get(span.parentSpanId) ?? [];
        children.push(span);
        childMap.set(span.parentSpanId, children);
      }
    }

    const printSpan = (span: SpanData, depth: number): void => {
      const indent = '  '.repeat(depth);
      const icon = span.status === 'ok' ? '✓' : span.status === 'error' ? '✗' : '⟳';
      const offset = span.startTime - traceStart;
      const duration = span.durationMs ?? '?';

      lines.push(`${indent}${icon} [+${offset}ms] ${span.name} (${span.kind}) → ${duration}ms`);

      if (span.error) {
        lines.push(`${indent}  ⚠ ${span.error}`);
      }

      const children = childMap.get(span.spanId) ?? [];
      for (const child of children) {
        printSpan(child, depth + 1);
      }
    };

    for (const root of roots) {
      printSpan(root, 1);
    }

    return lines.join('\n');
  }

  /**
   * 生成简洁的单行状态
   */
  generateStatusLine(): string {
    const summary = this.metrics.getSummary();
    const agentCounter = summary.counters['agent.run'];
    const successRate = agentCounter ? `${(agentCounter.successRate * 100).toFixed(0)}%` : 'N/A';

    return [
      `Tokens: ${summary.tokens.totalTokens.toLocaleString()}`,
      `Cost: $${summary.cost.totalCost.toFixed(4)}`,
      `Calls: ${summary.tokens.callCount}`,
      `Success: ${successRate}`,
    ].join(' | ');
  }

  // ============================================================
  // 工具方法
  // ============================================================

  private successBar(rate: number): string {
    const width = 20;
    const filled = Math.round(rate * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}
