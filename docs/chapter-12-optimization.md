# Chapter 12: 性能与成本优化 —— 让 Agent 又快又省

> "Premature optimization is the root of all evil, but knowing where to optimize is the root of all good engineering."

## 12.1 为什么需要优化？

在前面的章节中，我们构建了一个功能完整的 Agent 框架。但在生产环境中，**性能和成本**是决定一个 Agent 系统能否真正落地的关键因素：

| 挑战 | 影响 | 典型数据 |
|------|------|----------|
| LLM 调用延迟 | 用户等待时间长 | 单次 GPT-4o 调用 1-5s |
| Token 成本 | 运营成本失控 | GPT-4o: $2.5/1M prompt + $10/1M completion |
| 重复调用 | 浪费资源 | 相同问题重复请求 |
| 模型选择 | 用大炮打蚊子 | 简单问题用 GPT-4o 是浪费 |
| 上下文膨胀 | Token 越来越多 | 多轮对话累积大量历史 |

本章将实现 5 个核心优化模块，帮助你的 Agent 系统在保持质量的同时显著降低成本和延迟。

## 12.2 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        优化层                                │
│                                                             │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────────┐       │
│  │ LLMCache │  │ ModelRouter │  │ PromptOptimizer  │       │
│  │ 响应缓存  │  │ 智能路由     │  │ Prompt 压缩      │       │
│  └────┬─────┘  └──────┬──────┘  └────────┬─────────┘       │
│       │               │                  │                  │
│  ┌────┴───────────────┴──────────────────┴──────────┐       │
│  │              RequestBatcher 请求管理              │       │
│  │         (并发控制 + 去重 + 批量处理)               │       │
│  └─────────────────────┬────────────────────────────┘       │
│                        │                                    │
│  ┌─────────────────────┴────────────────────────────┐       │
│  │              CostTracker 成本追踪                 │       │
│  │           (实时计费 + 预算告警 + 趋势)             │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│                    LLM Provider 层                           │
│              (OpenAI / Anthropic / 本地模型)                  │
└─────────────────────────────────────────────────────────────┘
```

## 12.3 模块一：LLM Response Cache

### 12.3.1 设计思路

LLM 调用是最大的延迟和成本来源。如果用户问了相同（或非常相似）的问题，我们可以直接返回缓存的结果。

**缓存策略：**

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| **精确匹配** | messages + model 完全相同 | FAQ、重复问题 |
| **TTL 过期** | 缓存条目自动过期 | 保证时效性 |
| **LRU 淘汰** | 超容量时淘汰最久未用的 | 内存控制 |
| **语义缓存（可扩展）** | 相似问题命中 | 高级场景 |

> **参考**: [GPTCache](https://github.com/zilliztech/GPTCache) 是一个开源的 LLM 响应缓存框架，支持语义缓存。OpenAI 也在平台层面提供了 [Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching)。

### 12.3.2 核心实现

```typescript
// src/optimization/cache.ts

export class LLMCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private ttlMs: number;

  get(request: ChatRequest): ChatResponse | undefined {
    const key = this.buildKey(request);
    const entry = this.cache.get(key);

    // TTL 检查
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // 更新访问记录
    entry.lastAccessedAt = Date.now();
    entry.accessCount++;
    return entry.response;
  }

  set(request: ChatRequest, response: ChatResponse): void {
    // LRU 淘汰
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    this.cache.set(this.buildKey(request), { /* ... */ });
  }

  // 缓存 Key = SHA256(model + messages + tools + temperature)
  buildKey(request: ChatRequest): string {
    const keyData = {
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      tools: request.tools?.map(t => t.function.name).sort(),
      temperature: request.temperature,
    };
    return crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex');
  }
}
```

**关键设计决策：**

1. **Key 生成**：使用 SHA256 哈希，将 `model + messages + tools + temperature` 序列化后取摘要。相同输入必定产生相同 Key。
2. **LRU 淘汰**：当缓存满时，淘汰 `lastAccessedAt` 最早的条目。
3. **TTL 过期**：默认 5 分钟，平衡时效性与命中率。
4. **统计指标**：内置 `hits`、`misses`、`hitRate`，用于监控缓存效果。

### 12.3.3 使用示例

```typescript
const cache = new LLMCache({ maxSize: 100, ttlMs: 5 * 60 * 1000 });

// 包装 LLM 调用
async function cachedChat(provider, request) {
  const cached = cache.get(request);
  if (cached) return cached; // 命中！跳过 LLM 调用

  const response = await provider.chat(request);
  cache.set(request, response);
  return response;
}
```

## 12.4 模块二：Model Router

### 12.4.1 设计思路

不是所有问题都需要最强大（最贵）的模型。智能路由可以根据任务复杂度自动选择合适的模型：

```
用户输入
    │
    ▼
┌────────────┐    匹配    ┌──────────────────┐
│  显式规则   │──────────▶│  指定模型          │
│ (高优先级)  │           │  (force-mini 等)  │
└────┬───────┘           └──────────────────┘
     │ 无匹配
     ▼
┌────────────┐           ┌──────────────────┐
│ 复杂度分类  │──simple──▶│  gpt-4o-mini     │
│ (classifier)│──moderate▶│  gpt-4o          │
│            │──complex──▶│  gpt-4o          │
└────────────┘           └──────────────────┘
```

> **参考**: [OpenRouter](https://openrouter.ai/) 提供了云端模型路由服务。[Martian](https://docs.withmartian.com/) 的 Model Router 使用 ML 模型来做路由决策。

### 12.4.2 复杂度分类器

框架内置了一个基于规则的默认分类器：

```typescript
static defaultClassifier(request: ChatRequest): ComplexityLevel {
  let complexityScore = 0;

  // 信号 1：内容长度
  if (contentLength > 500) complexityScore += 2;

  // 信号 2：对话轮次
  if (messageCount > 10) complexityScore += 2;

  // 信号 3：是否需要工具
  if (hasTools) complexityScore += 1;

  // 信号 4：关键词
  if (/analyz|compar|explain.*detail|step.by.step/.test(content))
    complexityScore += 2;

  // 综合判断
  if (complexityScore >= 4) return 'complex';
  if (complexityScore >= 2) return 'moderate';
  return 'simple';
}
```

**复杂度信号权重：**

| 信号 | 权重 | 说明 |
|------|------|------|
| 内容长度 > 500 | +2 | 长问题通常更复杂 |
| 对话轮次 > 10 | +2 | 长对话需要更强的理解能力 |
| 需要工具调用 | +1 | 工具使用增加复杂度 |
| 复杂关键词 | +2 | "analyze"、"step by step" 等 |
| 简单问候 | -2 | "hi"、"hello" 等短问候 |

### 12.4.3 路由规则

支持显式规则覆盖分类器的结果：

```typescript
const rules: RoutingRule[] = [{
  name: 'force-mini-for-translation',
  condition: (req) => {
    const content = getLastContent(req);
    return content.startsWith('Translate:');
  },
  targetModel: 'gpt-4o-mini',
  priority: 10,
}];
```

### 12.4.4 成本节约估算

假设一天有 10000 次 LLM 调用，平均 1000 prompt + 500 completion tokens：

| 策略 | 模型分布 | 每日成本 |
|------|----------|----------|
| 全用 GPT-4o | 100% GPT-4o | ~$55 |
| 智能路由 | 60% mini + 30% 4o + 10% 4o | ~$18 |
| **节省** | | **~67%** |

## 12.5 模块三：Prompt Optimizer

### 12.5.1 设计思路

随着对话进行，Token 会不断累积。Prompt Optimizer 通过多种策略压缩 Token 消耗：

```
原始 Request (2000 tokens)
    │
    ├─ 1. 压缩空白：移除多余换行/空格 → 节省 ~5%
    ├─ 2. 移除注释：清理 system prompt 中的注释 → 节省 ~3%
    ├─ 3. 消息裁剪：移除早期对话轮次 → 节省 ~30-60%
    └─ 4. 工具精简：只保留可能需要的工具 → 节省 ~10-20%
    │
    ▼
优化后 Request (800 tokens) — 节省 60%
```

### 12.5.2 核心策略

#### 策略 1：内容压缩

```typescript
compressMessage(message: Message): Message {
  let content = message.content;
  content = content.replace(/\n{3,}/g, '\n\n');   // 多余换行
  content = content.replace(/[ \t]{2,}/g, ' ');    // 多余空格
  content = content.replace(/^\s+$/gm, '');        // 空白行
  return { ...message, content };
}
```

#### 策略 2：消息裁剪

当总 Token 超过预算时，从最早的非 system 消息开始裁剪：

```typescript
trimMessages(messages: Message[], tools?: ToolDefinition[]): Message[] {
  // system 消息永远保留
  const systemMessages = messages.filter(m => m.role === 'system');
  let nonSystem = messages.filter(m => m.role !== 'system');

  // 保留至少 minTurnsToKeep 轮对话
  while (estimate > maxTokenBudget && nonSystem.length > minMessages) {
    // 移除最早的一轮
    if (nonSystem[0]?.role === 'user') nonSystem.shift();
    if (nonSystem[0]?.role === 'assistant') nonSystem.shift();
  }

  return [...systemMessages, ...nonSystem];
}
```

#### 策略 3：工具精简

当工具定义超过 5 个时，优先保留最近消息中被提及的工具：

```typescript
pruneTools(tools: ToolDefinition[], messages: Message[]): ToolDefinition[] {
  const recentContent = messages.slice(-6)
    .map(m => m.content).join(' ').toLowerCase();

  const scored = tools.map(tool => ({
    tool,
    score: recentContent.includes(tool.function.name.toLowerCase()) ? 1 : 0,
  }));

  return scored.sort((a, b) => b.score - a.score).slice(0, 5).map(s => s.tool);
}
```

> **参考**: [LLMLingua](https://github.com/microsoft/LLMLingua) 是微软开源的 Prompt 压缩工具，使用小型语言模型来压缩 Prompt 同时保持语义。我们这里实现的是更轻量的规则方法。

### 12.5.3 优化结果

```typescript
const result = optimizer.optimize(request);

console.log(result.originalTokenEstimate);    // 2000
console.log(result.optimizedTokenEstimate);   // 800
console.log(result.tokensSaved);              // 1200
console.log(result.savingsPercent);           // 0.6 (60%)
console.log(result.actions);
// ['Compressed whitespace (saved ~50 chars)',
//  'Trimmed 8 early messages']
```

## 12.6 模块四：Cost Tracker

### 12.6.1 设计思路

与 Chapter 10 的 `MetricsCollector` 侧重性能指标不同，`CostTracker` 专注于**财务维度**：

- **实时成本计算**：每次 LLM 调用后立即计算花费
- **预算控制**：设置每分钟/小时/天/总预算上限
- **告警机制**：接近预算时发出警告，超过时发出 exceeded
- **分模型统计**：清楚知道每个模型花了多少钱

### 12.6.2 预算配置

```typescript
const tracker = new CostTracker(
  {
    totalBudget: 100,           // 总预算 $100
    maxCostPerDay: 10,          // 每天不超过 $10
    maxCostPerHour: 2,          // 每小时不超过 $2
    alertThreshold: 0.8,        // 80% 时预警
  },
  (alert) => {
    // 告警回调
    if (alert.type === 'exceeded') {
      console.error('预算已超！', alert.message);
      // 可以在这里触发降级策略（切换到更便宜的模型）
    }
  }
);
```

### 12.6.3 内置定价

```typescript
private static DEFAULT_PRICING = {
  'gpt-4o':       { promptPer1M: 2.5,  completionPer1M: 10 },
  'gpt-4o-mini':  { promptPer1M: 0.15, completionPer1M: 0.6 },
  'gpt-4-turbo':  { promptPer1M: 10,   completionPer1M: 30 },
  'claude-3-opus':   { promptPer1M: 15, completionPer1M: 75 },
  'claude-3-sonnet': { promptPer1M: 3,  completionPer1M: 15 },
  'claude-3-haiku':  { promptPer1M: 0.25, completionPer1M: 1.25 },
};
```

支持通过 `setModelPricing()` 添加自定义模型定价。

### 12.6.4 成本报告

```typescript
const summary = tracker.getSummary();

// {
//   totalCost: 0.0325,
//   totalCalls: 5,
//   totalTokens: 15000,
//   avgCostPerCall: 0.0065,
//   byModel: {
//     'gpt-4o': { cost: 0.03, calls: 2, tokens: 10000 },
//     'gpt-4o-mini': { cost: 0.0025, calls: 3, tokens: 5000 },
//   },
//   budgetRemaining: 99.9675,
//   alerts: [],
// }
```

## 12.7 模块五：Request Batcher

### 12.7.1 设计思路

在 Multi-Agent 系统中，多个 Agent 可能同时需要调用 LLM。不加控制会导致：

1. **API 速率限制**（Rate Limit）被触发
2. **瞬时并发过高**消耗大量资源
3. **重复请求**浪费 Token

RequestBatcher 提供：

```
Agent A ──┐
Agent B ──┤──▶ RequestBatcher ──▶ 并发控制(max=3) ──▶ LLM API
Agent C ──┤    ├── 去重缓存                          │
Agent D ──┘    └── 队列管理                          │
                       ◀─────────────────────────────┘
```

### 12.7.2 核心实现

```typescript
export class RequestBatcher {
  private queue: QueuedRequest[] = [];
  private activeCount = 0;
  private cache: LLMCache | undefined;

  async submit(request: ChatRequest): Promise<ChatResponse> {
    // 1. 检查去重缓存
    if (this.cache) {
      const cached = this.cache.get(request);
      if (cached) return cached;
    }

    // 2. 入队，等待执行
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    // 3. 在并发限制内逐个执行
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrency) {
      const item = this.queue.shift()!;
      this.activeCount++;
      this.executeRequest(item).finally(() => {
        this.activeCount--;
        this.processQueue(); // 完成后继续处理队列
      });
    }
  }
}
```

**关键特性：**

- **并发控制**：`maxConcurrency` 限制同时进行的 LLM 调用数量
- **去重缓存**：相同请求只调用一次 LLM，后续请求从缓存获取
- **批量提交**：`submitBatch()` 方便一次提交多个请求

> **参考**: OpenAI 提供了 [Batch API](https://platform.openai.com/docs/guides/batch)，支持在 24 小时内批量处理大量请求，费用降低 50%。我们的 `RequestBatcher` 是客户端级别的批量处理。

## 12.8 组合使用 —— 完整优化流水线

在实际场景中，这些优化模块应组合使用：

```typescript
// 完整优化流水线
class OptimizedAgent {
  private cache: LLMCache;
  private router: ModelRouter;
  private optimizer: PromptOptimizer;
  private batcher: RequestBatcher;
  private costTracker: CostTracker;

  async run(input: string): Promise<string> {
    // 1. 构造请求
    const request = this.buildRequest(input);

    // 2. Prompt 优化（减少 Token）
    const { request: optimized } = this.optimizer.optimize(request);

    // 3. 检查缓存
    const cached = this.cache.get(optimized);
    if (cached) return cached.content;

    // 4. 模型路由（选择合适的模型）
    const { model } = this.router.route(optimized);
    optimized.model = model.name;

    // 5. 检查预算
    if (this.costTracker.isBudgetExceeded()) {
      throw new Error('Budget exceeded');
    }

    // 6. 通过 Batcher 发送（并发控制 + 去重）
    const response = await this.batcher.submit(optimized);

    // 7. 记录成本
    this.costTracker.record(
      model.name,
      response.usage.promptTokens,
      response.usage.completionTokens
    );

    // 8. 写入缓存
    this.cache.set(optimized, response);

    return response.content;
  }
}
```

## 12.9 优化效果量化

### 理论节约估算

假设一个日均 10,000 次调用的 Agent 系统：

| 优化手段 | 节约比例 | 节约方式 |
|----------|----------|----------|
| LLM Cache | 15-30% | 跳过重复调用 |
| Model Router | 40-60% | 简单问题用便宜模型 |
| Prompt Optimizer | 20-40% | 减少 Token 用量 |
| Request Batcher | 10-15% | 去重 + 减少 API 调用 |
| **综合** | **60-80%** | **多策略叠加** |

### 延迟优化

| 场景 | 未优化 | 优化后 |
|------|--------|--------|
| 缓存命中 | 1-5s (LLM) | <1ms (本地) |
| 简单问题 | 1-5s (GPT-4o) | 0.3-1s (mini) |
| 长对话 | 3-10s (大量 token) | 1-3s (裁剪后) |

## 12.10 与生产级方案的对比

| 特性 | 我们的实现 | 生产级方案 |
|------|-----------|-----------|
| 缓存 | 内存 LRU | Redis + 语义缓存 (GPTCache) |
| 路由 | 规则 + 启发式 | ML 分类器 (Martian) |
| Prompt 优化 | 规则压缩 | LLMLingua / Prompt 蒸馏 |
| 批处理 | 客户端队列 | OpenAI Batch API |
| 成本追踪 | 内存统计 | Helicone / LangSmith |
| 适用场景 | 学习/小规模 | 大规模生产 |

**扩展路径：**

1. **缓存** → 引入 Redis/Memcached，支持分布式缓存；集成 Embedding 做语义缓存
2. **路由** → 训练一个小型分类器（如 BERT-tiny），用历史数据学习路由策略
3. **Prompt** → 集成 LLMLingua 做更精细的无损压缩
4. **Batch** → 对接 OpenAI Batch API，实现离线批量处理
5. **成本** → 接入 [Helicone](https://helicone.ai/) 或 [LangSmith](https://smith.langchain.com/) 做企业级成本监控

## 12.11 测试

本章包含 45 个单元测试，覆盖所有优化模块：

```
✓ cache.test.ts          (11 tests) - 缓存命中/miss/TTL/LRU/统计
✓ model-router.test.ts   (9 tests)  - 路由/规则/分类器/统计
✓ prompt-optimizer.test.ts (8 tests) - 压缩/裁剪/工具精简/Token估算
✓ cost-tracker.test.ts   (10 tests) - 成本计算/预算控制/告警/统计
✓ request-batcher.test.ts (7 tests) - 并发/去重/批量/统计
```

运行测试：

```bash
npx vitest run src/optimization
```

## 12.12 本章小结

本章实现了 5 个性能与成本优化模块：

| 模块 | 核心价值 | 关键 API |
|------|---------|---------|
| **LLMCache** | 避免重复 LLM 调用 | `get()`, `set()`, `hitRate` |
| **ModelRouter** | 智能选择合适的模型 | `route()`, `chat()`, `defaultClassifier()` |
| **PromptOptimizer** | 减少 Token 消耗 | `optimize()`, `trimMessages()` |
| **CostTracker** | 预算控制与告警 | `record()`, `checkBudget()`, `getSummary()` |
| **RequestBatcher** | 并发控制与去重 | `submit()`, `submitBatch()` |

**核心理念：**

1. **缓存优先**：能从缓存拿的就不调 LLM
2. **模型匹配**：任务复杂度决定模型选择
3. **Token 节俭**：每个 token 都有成本
4. **预算兜底**：没有监控就没有控制
5. **并发有度**：控制并发避免 Rate Limit

至此，我们的 TinyAgent 框架已经具备了一个生产级 Agent 系统的所有核心能力。接下来的 Project C 将综合运用前 12 章所有技术，构建一个完整的客服智能体系统。

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `src/optimization/cache.ts` | LLM 响应缓存（LRU + TTL） |
| `src/optimization/model-router.ts` | 智能模型路由 |
| `src/optimization/prompt-optimizer.ts` | Prompt 压缩与优化 |
| `src/optimization/cost-tracker.ts` | 成本追踪与预算控制 |
| `src/optimization/request-batcher.ts` | 请求批量合并 |
| `src/optimization/index.ts` | 模块导出 |
| `src/optimization/__tests__/cache.test.ts` | 缓存测试（11） |
| `src/optimization/__tests__/model-router.test.ts` | 路由测试（9） |
| `src/optimization/__tests__/prompt-optimizer.test.ts` | 优化器测试（8） |
| `src/optimization/__tests__/cost-tracker.test.ts` | 成本追踪测试（10） |
| `src/optimization/__tests__/request-batcher.test.ts` | 批量请求测试（7） |
| `examples/12-optimization.ts` | 示例代码 |
| `docs/chapter-12-optimization.md` | 本文档 |
