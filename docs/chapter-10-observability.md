# Chapter 10：可观测性系统 -- 让 Agent "透明"运行

> "If you can't measure it, you can't improve it." -- Peter Drucker

---

## 1. 为什么需要可观测性？

Agent 的执行过程是一个**黑盒**：用户输入一句话，Agent 可能经过多轮 LLM 调用、若干工具执行、上下文管理，最终输出结果。在这个过程中：

- **LLM 花了多少 Token？** Token 直接决定成本
- **每一步耗时多少？** 瓶颈在 LLM 调用还是工具执行？
- **哪里出了错？** 错误发生在第几步？是 LLM 幻觉还是工具异常？
- **Multi-Agent 的协作路径是什么？** Pipeline 哪个阶段最慢？

可观测性系统的目标是**将黑盒变为白盒**，让开发者能够：

1. **追踪（Tracing）** -- 还原每次执行的完整路径
2. **度量（Metrics）** -- 量化性能、成本、质量
3. **诊断（Diagnostics）** -- 快速定位问题根因

### 1.1 行业实践

| 工具 | 类型 | 特点 |
|------|------|------|
| [LangSmith](https://docs.smith.langchain.com/) | SaaS | LangChain 官方，功能全面 |
| [Langfuse](https://langfuse.com/docs) | 开源/SaaS | 独立于框架，支持多种 SDK |
| [OpenTelemetry](https://opentelemetry.io/) | 开源标准 | 通用分布式追踪标准 |
| [Arize Phoenix](https://docs.arize.com/phoenix) | 开源 | LLM 可观测性专用 |

本章从零实现一个**轻量级但完整的**可观测性系统，核心概念对齐 OpenTelemetry 标准。

---

## 2. 架构概览

```
                        ┌────────────────────────┐
                        │      TracedAgent        │
                        │  (自动追踪的 Agent 包装)  │
                        └──────────┬─────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                              │
             ┌──────▼──────┐              ┌───────▼───────┐
             │   Tracer     │              │ MetricsCollector│
             │ (追踪管理器)  │              │  (指标收集器)    │
             └──────┬──────┘              └───────┬───────┘
                    │                              │
          ┌─────────┼─────────┐           ┌───────┼────────┐
          │         │         │           │       │        │
     ┌────▼───┐ ┌──▼──┐ ┌───▼───┐  Token用量  延迟分布  成功率
     │ Trace  │ │Span │ │ Span  │
     │        │ │(LLM)│ │(Tool) │
     └────────┘ └─────┘ └───────┘
          │
    ┌─────┼──────────┐
    │     │          │
┌───▼──┐ ┌▼────┐ ┌──▼────┐
│Console│ │JSON │ │Memory │   ← SpanExporter（策略模式）
│Export │ │File │ │Export │
└──────┘ └─────┘ └───────┘
                        │
                   ┌────▼────┐
                   │Dashboard│  ← 文本报表
                   └─────────┘
```

---

## 3. Trace & Span -- 分布式追踪的基础

### 3.1 核心概念

借鉴 [OpenTelemetry Trace](https://opentelemetry.io/docs/concepts/signals/traces/) 的概念模型：

- **Trace**：一次完整的 Agent 执行（从用户输入到最终回复）
- **Span**：Trace 中的一个操作单元（LLM 调用、工具执行等）

Span 之间通过 `parentSpanId` 形成**树形层级**：

```
Trace (agent.run)
├── Span: agent.execute
│   ├── Span: llm.thinking.step1
│   ├── Span: tool.calculator
│   ├── Span: llm.thinking.step2
│   └── Span: agent.answer
```

### 3.2 Span 的属性

```typescript
export interface SpanData {
  spanId: string;        // 唯一标识
  traceId: string;       // 所属 Trace
  parentSpanId?: string; // 父 Span（根 Span 无父）
  name: string;          // 操作名称
  kind: SpanKind;        // 类型：agent | llm | tool | retrieval | guardrail | pipeline | custom
  status: SpanStatus;    // 状态：running | ok | error
  startTime: number;     // 开始时间戳
  endTime?: number;      // 结束时间戳
  durationMs?: number;   // 耗时（毫秒）
  attributes: SpanAttributes; // 自定义属性
  events: SpanEvent[];   // 时间点事件
  error?: string;        // 错误信息
}
```

### 3.3 SpanKind 设计

| Kind | 用途 | 示例 |
|------|------|------|
| `agent` | Agent 主流程 | agent.execute, agent.answer |
| `llm` | LLM 调用 | llm.thinking.step1 |
| `tool` | 工具执行 | tool.calculator, tool.search |
| `retrieval` | RAG 检索 | rag.retrieve, embedding |
| `guardrail` | 安全护栏 | guardrail.input, guardrail.output |
| `pipeline` | Multi-Agent 步骤 | pipeline.step1 |
| `custom` | 自定义操作 | 任意自定义 Span |

---

## 4. Tracer -- 追踪管理器

### 4.1 职责

1. 创建和管理 Trace/Span 的生命周期
2. 维护 **Span 栈**（自动建立父子关系）
3. 结束时将 Trace 推送给所有注册的 Exporter

### 4.2 Span 栈的自动层级管理

Tracer 内部维护一个栈 `spanStack`，`startSpan` 时自动将栈顶作为父 Span：

```typescript
startSpan(name, kind) {
  const parentSpan = this.spanStack[this.spanStack.length - 1];
  const span = new Span({
    traceId: this.currentTrace.traceId,
    parentSpanId: parentSpan?.spanId,  // 自动关联父级
    name,
    kind,
  });
  this.spanStack.push(span);
  return span;
}

endSpan(status) {
  const span = this.spanStack.pop();
  span.end(status);
}
```

这种设计使得调用者只需：

```typescript
tracer.startSpan('parent', 'agent');
  tracer.startSpan('child', 'llm');
  tracer.endSpan('ok');
tracer.endSpan('ok');
```

不需要手动传递 `parentSpanId`。

### 4.3 withSpan 便捷方法

```typescript
const result = await tracer.withSpan('compute', 'custom', async (span) => {
  span.setAttribute('input', 42);
  return 42 * 2;
});
// Span 自动创建和关闭，异常时自动标记 error
```

---

## 5. SpanExporter -- 数据导出

### 5.1 策略模式

```typescript
export interface SpanExporter {
  readonly name: string;
  export(trace: TraceData): Promise<void>;
  shutdown?(): Promise<void>;
}
```

### 5.2 内置 Exporter

| Exporter | 用途 | 输出目标 |
|----------|------|---------|
| `ConsoleExporter` | 开发调试 | 终端 stdout |
| `InMemoryExporter` | 单元测试 | 内存数组 |
| `JsonFileExporter` | 持久化 | JSON Lines 文件 |
| `CallbackExporter` | 灵活集成 | 自定义回调函数 |

**ConsoleExporter** 支持两种模式：

- **Summary 模式**：只显示 Span 数量和分类统计
- **Verbose 模式**：显示完整的 Span 树形结构

```
────────────────────────────────────────────────────
✓ Trace: agent.run [1200ms]
  ID: trace-m5abc-x7k2de-1
  Spans: 5
  Span Tree:
  └── ✓ agent.execute [agent] (1200ms)
      ├── ✓ llm.thinking.step1 [llm] (0ms)
      ├── ✓ tool.calculator [tool] (45ms)
      ├── ✓ llm.thinking.step2 [llm] (0ms)
      └── ✓ agent.answer [agent] (0ms)
────────────────────────────────────────────────────
```

### 5.3 JsonFileExporter -- 持久化

写入 [JSON Lines](https://jsonlines.org/) 格式，每行一个完整 Trace：

```typescript
const exporter = new JsonFileExporter({
  filePath: './traces.jsonl',
  pretty: false,  // 生产环境用 false 减小文件
});
```

文件可后续导入分析工具（如 Jaeger UI）或用脚本分析。

---

## 6. MetricsCollector -- 指标收集器

### 6.1 四类核心指标

#### Token 用量
```typescript
metrics.recordTokenUsage(promptTokens, completionTokens, model);

const m = metrics.getTokenMetrics('gpt-4o');
// { totalPromptTokens, totalCompletionTokens, totalTokens,
//   callCount, avgPromptTokens, avgCompletionTokens }
```

#### 延迟分布（百分位数）
```typescript
metrics.recordLatency('llm.call', 350);
metrics.recordLatency('tool.execute', 45);

const m = metrics.getLatencyMetrics('llm.call');
// { count, totalMs, minMs, maxMs, avgMs, p50Ms, p95Ms, p99Ms }
```

百分位数计算使用排序后的索引法：
```typescript
private percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}
```

#### 成功/失败率
```typescript
metrics.recordSuccess('agent.run');
metrics.recordFailure('agent.run');

const m = metrics.getCounterMetrics('agent.run');
// { success: 3, failure: 1, total: 4, successRate: 0.75 }
```

#### 成本估算
```typescript
const cost = metrics.estimateCost('gpt-4o');
// { model: 'gpt-4o', promptCost: 0.0025, completionCost: 0.005,
//   totalCost: 0.0075, currency: 'USD' }
```

内置常见模型价格表（每 1M tokens，USD）：

| 模型 | Prompt | Completion |
|------|--------|------------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4-turbo | $10.00 | $30.00 |
| claude-3-opus | $15.00 | $75.00 |
| claude-3-sonnet | $3.00 | $15.00 |
| claude-3-haiku | $0.25 | $1.25 |

支持自定义价格表：
```typescript
metrics.setModelPricing('my-model', {
  promptPer1M: 1.0,
  completionPer1M: 2.0,
});
```

---

## 7. TracedAgent -- 无侵入式追踪

### 7.1 设计原则

**不修改 Agent 代码**，通过包装器模式将 Tracer 和 MetricsCollector 集成：

```typescript
const agent = new Agent({ ... });

const traced = new TracedAgent({
  agent,
  tracer,
  metrics,
  model: 'gpt-4o',
});

// 使用方式完全相同
const result = await traced.run("Hello");
```

### 7.2 自动追踪机制

TracedAgent 拦截 Agent 的 `onEvent` 回调，将 `AgentEvent` 转化为 `Span`：

| AgentEvent | 生成的 Span | SpanKind |
|-----------|------------|----------|
| `thinking` | `llm.thinking.stepN` | llm |
| `tool_call` | `tool.<toolName>` | tool |
| `tool_result` | 关闭 tool Span | - |
| `answer` | `agent.answer` | agent |
| `error` | `agent.error` | agent |
| `max_steps_reached` | `agent.max_steps` | agent |

### 7.3 自动收集的 Metrics

每次 `run()` 自动记录：
- **Token 用量**：从 `AgentResult.usage` 提取
- **端到端延迟**：`agent.e2e` 类别
- **工具执行延迟**：`tool.execute` 类别（如果有 `durationMs`）
- **成功/失败**：`agent.run` 和 `tool.call` 类别

---

## 8. Dashboard -- 报表输出

### 8.1 完整报表

```
╔══════════════════════════════════════════════════╗
║          TinyAgent Observability Report          ║
╚══════════════════════════════════════════════════╝

📊 Token Usage
  Total Calls:        5
  Prompt Tokens:      2,400
  Completion Tokens:  800
  Total Tokens:       3,200
  Avg Prompt/Call:    480
  Avg Completion/Call: 160

⏱  Latency
  [llm.call]
    Count: 5  |  Avg: 320ms  |  P50: 300ms  |  P95: 500ms  |  P99: 500ms
    Min: 200ms  |  Max: 500ms  |  Total: 1600ms
  [tool.execute]
    Count: 3  |  Avg: 45ms  |  P50: 40ms  |  P95: 60ms  |  P99: 60ms
    Min: 30ms  |  Max: 60ms  |  Total: 135ms

✅ Success / Failure
  [agent.run]  4/5 (80.0%) [████████████████░░░░]
  [tool.call]  3/3 (100.0%) [████████████████████]

💰 Cost Estimate
  Model:       gpt-4o
  Prompt:      $0.0060
  Completion:  $0.0080
  Total:       $0.0140 USD

──────────────────────────────────────────────────
```

### 8.2 Trace 时间线

```
Trace: agent.run [✓] 1200ms
ID: trace-m5abc-x7k2de-1

  ✓ [+0ms] agent.execute (agent) → 1200ms
    ✓ [+5ms] llm.thinking.step1 (llm) → 0ms
    ✓ [+300ms] tool.calculator (tool) → 45ms
    ✓ [+350ms] agent.answer (agent) → 0ms
```

### 8.3 状态行（单行摘要）

```
Tokens: 3,200 | Cost: $0.0140 | Calls: 5 | Success: 80%
```

---

## 9. 测试

### 9.1 测试统计

| 测试文件 | 测试数 | 描述 |
|----------|-------|------|
| trace.test.ts | 15 | Trace/Span 数据结构 |
| tracer.test.ts | 10 | Tracer 生命周期管理 |
| exporters.test.ts | 11 | 4 种 Exporter |
| metrics.test.ts | 14 | MetricsCollector |
| traced-agent.test.ts | 7 | TracedAgent 集成 |
| dashboard.test.ts | 5 | Dashboard 报表 |
| **总计** | **62** | |

### 9.2 关键测试场景

- **Span 父子关系自动建立**：嵌套 startSpan/endSpan 后验证 parentSpanId 正确
- **withSpan 异常处理**：async 函数抛异常时 Span 自动标记 error
- **Exporter 隔离**：一个 Exporter 异常不影响其他 Exporter
- **TracedAgent 工具调用**：mock 两轮 LLM 调用（tool_call → answer），验证 tool Span 生成
- **百分位数计算**：10 个采样值验证 P50、P95
- **成本估算准确性**：已知 token 数和价格表，验证计算结果

### 9.3 运行测试

```bash
# 仅运行可观测性测试
npx vitest run src/observability/

# 运行全量回归
npx vitest run --exclude '**/integration*'
```

---

## 10. 使用示例

```typescript
import {
  Tracer, ConsoleExporter, InMemoryExporter,
  MetricsCollector, TracedAgent, Dashboard,
} from '../src/observability/index.js';

// 1. 设置追踪
const tracer = new Tracer({
  serviceName: 'my-agent',
  exporters: [
    new ConsoleExporter({ verbose: true }),
    new JsonFileExporter({ filePath: './traces.jsonl' }),
  ],
});

// 2. 设置指标
const metrics = new MetricsCollector();

// 3. 包装 Agent
const traced = new TracedAgent({
  agent: myAgent,
  tracer,
  metrics,
  model: 'gpt-4o',
});

// 4. 使用（与原始 Agent 相同）
const result = await traced.run("What is 42 * 17?");

// 5. 查看报表
const dashboard = new Dashboard(metrics);
console.log(dashboard.generateReport());
```

---

## 11. 与生产级工具的对比

| 特性 | TinyAgent Observability | LangSmith | Langfuse | OpenTelemetry |
|------|----------------------|-----------|---------|---------------|
| Trace/Span 模型 | ✓ | ✓ | ✓ | ✓ |
| 自动 Agent 追踪 | ✓ (TracedAgent) | ✓ (装饰器) | ✓ (SDK) | 需手动 |
| Token 计量 | ✓ | ✓ | ✓ | 需扩展 |
| 成本估算 | ✓ (内置价格表) | ✓ | ✓ | 需扩展 |
| 百分位数延迟 | ✓ | ✓ | ✓ | ✓ |
| 文件导出 | ✓ (JSONL) | Cloud | Cloud/Self | OTLP |
| Web Dashboard | ✗ | ✓ | ✓ | Jaeger/Grafana |
| 评估集成 | Chapter 11 | ✓ | ✓ | 需扩展 |
| 依赖 | 0 | SDK | SDK | SDK |

本实现的核心价值在于**理解原理**：当你理解了 Trace/Span 模型、指标收集、导出策略后，使用任何生产级工具都会游刃有余。

---

## 12. 深入思考

### 为什么用栈管理 Span 层级？

**同步执行假设**：Agent 的 ReAct 循环是顺序执行的（Think → Act → Observe → Think → ...），所以栈结构完美匹配。

但在 **ParallelFanOut** 场景下，多个 Agent 并行执行，栈结构就不够用了。生产级系统（如 OpenTelemetry）使用 **Context Propagation**（上下文传播）来处理并行场景，每个异步任务携带自己的 Span Context。

### 采样策略

生产环境不是每个请求都需要追踪。常见策略：
- **Head-based sampling**：在请求开始时决定是否追踪（如 10% 采样率）
- **Tail-based sampling**：等请求结束后，根据结果决定是否保留（如只保留错误的 Trace）

本实现的 `enabled` 选项是最简单的开关。

### 成本估算的局限

Token 计数来自 LLM API 的 `usage` 字段，但实际费用可能因为：
- 缓存命中（Prompt Caching）减少计费
- 不同区域定价不同
- 批量 API 和实时 API 价格差异

所以 `estimateCost()` 是估算，不是精确计费。

---

## 13. 文件清单

```
src/observability/
├── trace.ts                        # Trace & Span 数据结构
├── tracer.ts                       # Tracer 追踪管理器
├── exporters.ts                    # 4 种 SpanExporter
├── metrics.ts                      # MetricsCollector 指标收集器
├── traced-agent.ts                 # TracedAgent 包装器
├── dashboard.ts                    # Dashboard 文本报表
├── index.ts                        # 统一导出
└── __tests__/
    ├── trace.test.ts               # 15 tests
    ├── tracer.test.ts              # 10 tests
    ├── exporters.test.ts           # 11 tests
    ├── metrics.test.ts             # 14 tests
    ├── traced-agent.test.ts        #  7 tests
    └── dashboard.test.ts           #  5 tests
                                    # 共 62 tests

examples/
└── 10-observability.ts             # 使用示例
```
