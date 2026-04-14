# Project C: 客服智能体系统 —— 综合实战

> 本项目综合运用 Chapter 01-12 全部技术，构建一个完整的 AI 客服系统。

## C.1 项目目标

构建一个面向 **TinyBot**（虚拟 SaaS 产品）的 AI 客服系统，具备以下能力：

| 能力 | 对应章节 | 实现 |
|------|----------|------|
| 理解用户意图 | Ch01 LLM Provider | OpenAI API 调用 |
| 查询用户/订单信息 | Ch02 工具系统 | 业务工具定义 |
| 多步推理解决问题 | Ch03 ReAct 循环 | Agent 思考→行动→观察 |
| 记住对话上下文 | Ch04 记忆系统 | ConversationMemory |
| 搜索产品知识库 | Ch05 RAG | 向量检索 FAQ/产品/政策 |
| 实时流式回复 | Ch06 流式输出 | StreamingAgent |
| 多 Agent 协作 | Ch07 Multi-Agent | （架构预留） |
| 外部工具接入 | Ch08 MCP | （架构预留） |
| 安全防护 | Ch09 安全护栏 | 输入过滤 + PII 脱敏 + 限流 |
| 全链路追踪 | Ch10 可观测性 | TracedAgent + Metrics |
| 质量评估 | Ch11 评估 | （架构预留） |
| 成本控制 | Ch12 优化 | Cache + CostTracker |

## C.2 系统架构

```
                         ┌─────────────────────┐
                         │     用户 (CLI)       │
                         └──────────┬──────────┘
                                    │ 用户输入
                                    ▼
┌───────────────────────────────────────────────────────────┐
│                   CustomerServiceBot                       │
│                                                           │
│  ┌─────────────┐  ┌───────────────┐  ┌──────────────┐   │
│  │  RateLimiter │  │ InputGuardrail│  │ OutputGuardrail│  │
│  │  (速率限制)   │  │ (注入检测)     │  │  (PII 脱敏)   │  │
│  └──────┬──────┘  └──────┬────────┘  └──────┬───────┘   │
│         │                │                   │            │
│         ▼                ▼                   ▲            │
│  ┌─────────────────────────────────────────────────┐     │
│  │              TracedAgent (可观测性)               │     │
│  │    ┌─────────────────────────────────┐          │     │
│  │    │       Agent (ReAct 循环)         │          │     │
│  │    │  ┌─────────────────────────┐    │          │     │
│  │    │  │   ConversationMemory    │    │          │     │
│  │    │  │   (对话记忆)             │    │          │     │
│  │    │  └─────────────────────────┘    │          │     │
│  │    │  ┌─────────────────────────┐    │          │     │
│  │    │  │     ToolRegistry        │    │          │     │
│  │    │  │  - lookup_user          │    │          │     │
│  │    │  │  - query_orders         │    │          │     │
│  │    │  │  - create_ticket        │    │          │     │
│  │    │  │  - transfer_to_human    │    │          │     │
│  │    │  │  - search_knowledge ────┤────┤──▶ RAG  │     │
│  │    │  │  - check_service_status │    │          │     │
│  │    │  └─────────────────────────┘    │          │     │
│  │    └─────────────────────────────────┘          │     │
│  └─────────────────────────────────────────────────┘     │
│                                                           │
│  ┌───────────────┐  ┌───────────────┐                    │
│  │  CostTracker  │  │  LLMCache     │                    │
│  │  (成本追踪)    │  │  (响应缓存)    │                    │
│  └───────────────┘  └───────────────┘                    │
└───────────────────────────────────────────────────────────┘
```

## C.3 知识库设计

知识库包含三个 Markdown 文件：

| 文件 | 内容 | 用途 |
|------|------|------|
| `products.md` | 产品目录（Pro/Lite/Free/API） | 回答产品和价格问题 |
| `faq.md` | 常见问题（注册、升级、密码等） | 回答操作类问题 |
| `policies.md` | 客服政策（退款、工单升级、话术） | 指导客服行为 |

知识库通过 RAG Pipeline 索引：

```typescript
async initKnowledgeBase(knowledgeDir?: string): Promise<number> {
  const embedder = new SimpleEmbedder(128);
  const vectorStore = new VectorStore({ embedder });
  const chunker = new MarkdownChunker(500);

  this.ragPipeline = new RAGPipeline({ vectorStore, topK: 3, minScore: 0 });

  const files = await fs.readdir(dir);
  for (const file of files) {
    const content = await fs.readFile(filePath, 'utf-8');
    const chunks = await this.ragPipeline.indexDocument(content, chunker, { source: file });
    totalChunks += chunks.length;
  }

  setRAGPipeline(this.ragPipeline); // 注入到 search_knowledge 工具
}
```

## C.4 业务工具设计

### 6 个客服工具

| 工具 | 功能 | 参数 |
|------|------|------|
| `lookup_user` | 查询用户信息 | `query: userId 或 email` |
| `query_orders` | 查询订单记录 | `userId` |
| `create_ticket` | 创建工单 | `userId, subject, description, priority` |
| `transfer_to_human` | 转接人工 | `userId, reason, summary` |
| `search_knowledge` | 搜索知识库 | `query` |
| `check_service_status` | 检查服务状态 | 无 |

### 模拟数据

项目内置了模拟用户数据和订单数据：

```
用户 U001 (张三) — Pro 套餐, API 调用 4520 次
用户 U002 (李四) — Lite 套餐, 对话 85 次
用户 U003 (王五) — Free 套餐, 对话 8 次
```

```
订单 ORD-2025-001 — U001, Pro 年付 ¥2999, 2025-01
订单 ORD-2025-002 — U001, Pro 年付 ¥2999, 2026-01
订单 ORD-2025-003 — U002, Lite 月付 ¥99, 2026-03
```

## C.5 安全护栏

### 输入护栏

```typescript
this.inputGuardrail = new GuardrailPipeline()
  .add(new ContentFilter({ maxContentLength: 2000 }))
  .add(new PromptInjectionDetector({ sensitivity: 'medium' }));
```

- **ContentFilter**: 限制输入长度不超过 2000 字符
- **PromptInjectionDetector**: 检测 Prompt 注入攻击（中等灵敏度）

### 输出护栏

```typescript
this.outputGuardrail = new GuardrailPipeline()
  .add(new PIIDetector({
    enabledCategories: ['email', 'phone', 'id_card', 'bank_card'],
    action: 'mask',
  }));
```

- **PIIDetector**: 检测并遮蔽回复中可能泄露的个人敏感信息

### 速率限制

```typescript
this.rateLimiter = new RateLimiter({
  maxRequestsPerMinute: 20,
  maxTurnsPerSession: 50,
});
```

## C.6 可观测性

每次对话自动通过 `TracedAgent` 记录：

```typescript
this.tracedAgent = new TracedAgent({
  agent: this.agent,
  tracer: this.tracer,
  metrics: this.metrics,
  model: this.model,
});

// 使用时自动产生 Trace + Span
const result = await this.tracedAgent.run(userInput, onEvent);
```

可通过 `/status` 命令查看运营指标：

```
=== Agent 运营仪表板 ===
Token 使用量: 总计 15000 (Prompt: 10000 / Completion: 5000)
延迟统计: 平均 1200ms / P95 2500ms / P99 3500ms
成功率: 95.0% (19 成功 / 1 失败)
```

## C.7 成本控制

### CostTracker 预算管理

```typescript
this.costTracker = new CostTracker(
  { totalBudget: config.budget ?? 1.0, alertThreshold: 0.8 },
);

// 每次调用后记录
if (result.usage) {
  this.costTracker.record(
    this.model,
    result.usage.promptTokens,
    result.usage.completionTokens,
  );
}
```

可通过 `/cost` 命令查看成本统计：

```
成本统计:
  总花费: $0.003250
  总调用: 5 次
  总 Token: 15000
  平均每次: $0.000650
  剩余预算: $0.996750
```

### 预算超限保护

```typescript
if (bot.isBudgetExceeded()) {
  console.log('⚠️  预算已超，系统即将停止服务');
}
```

## C.8 对话流程

```
用户: "TinyBot Pro 多少钱？"
    │
    ├─ RateLimiter: ✅ 通过 (3/20 RPM)
    ├─ InputGuardrail: ✅ 通过
    ├─ Agent 推理:
    │   ├─ Think: 用户在问价格，需要搜索知识库
    │   ├─ Act: search_knowledge("TinyBot Pro 价格")
    │   ├─ Observe: "TinyBot Pro - ¥299/月，¥2999/年..."
    │   └─ Answer: "TinyBot Pro 的定价是..."
    ├─ OutputGuardrail: ✅ 通过（无 PII）
    ├─ CostTracker: +$0.00065
    └─ TracedAgent: Trace 记录完毕
    │
    ▼
回复: "TinyBot Pro 的定价如下：¥299/月 或 ¥2999/年（年付8.3折）。
      功能包括无限对话、优先响应、自定义知识库、API 接入和团队协作。
      还有其他可以帮助您的吗？"
```

```
用户: "帮我查一下 U001 的信息"
    │
    ├─ Agent 推理:
    │   ├─ Think: 需要查询用户信息
    │   ├─ Act: lookup_user("U001")
    │   ├─ Observe: {"found": true, "user": {"name": "张三", "plan": "pro"...}}
    │   └─ Answer: 综合用户信息回复
    │
    ▼
回复: "查询到用户 U001（张三）的信息：
      - 当前套餐：Pro
      - 注册时间：2025-01-15
      - API 调用：4520 次
      - 对话次数：230 次
      还有其他可以帮助您的吗？"
```

## C.9 CLI 交互

```bash
npx tsx projects/customer-service/main.ts
```

```
╔════════════════════════════════════════════════╗
║     TinyBot 客服智能体系统 v1.0               ║
║     Project C: 综合实战项目                    ║
╚════════════════════════════════════════════════╝

正在初始化知识库...
知识库加载完成: 12 个文档片段

可用命令:
  输入问题 → AI 客服回复
  /status  → 查看运营指标
  /cost    → 查看成本统计
  /tickets → 查看工单列表
  /reset   → 重置会话
  /quit    → 退出

👤 您: TinyBot Pro 多少钱？
  [工具调用] search_knowledge({"query":"TinyBot Pro 价格"})
  [工具结果] {"found":true,"results":[{"content":"## TinyBot Pro...

🤖 客服: TinyBot Pro 的定价如下：
- 月付：¥299/月
- 年付：¥2999/年（相当于 8.3 折优惠）
...
```

## C.10 测试

### 工具测试 (13 个)

```
✓ lookup_user   — ID 查找、邮箱查找、未找到、用量返回
✓ query_orders  — 订单查询、空订单
✓ create_ticket — 工单创建、列表追加
✓ transfer_to_human — 转接信息返回
✓ search_knowledge  — 未初始化错误
✓ check_service_status — 状态列表
✓ getAllTools    — 6 个工具
✓ resetTickets   — 清空工单
```

### 系统集成测试 (12 个)

```
✓ 正确初始化所有组件
✓ 普通对话（Mock LLM）
✓ 工具调用场景（lookup_user + 回复）
✓ 事件回调触发
✓ 输入护栏拦截注入攻击
✓ 速率限制 (20 RPM)
✓ 成本追踪累计
✓ resetSession 重置
✓ 运营报告输出
✓ 知识库文档加载
✓ 可观测性 Trace 记录
✓ 工单创建场景
```

### API 集成测试 (3 个，需真实 API)

```
✓ 产品价格问答
✓ 用户信息查询
✓ FAQ 问题回答
```

运行测试：

```bash
npx vitest run projects/customer-service
```

## C.11 技术串联总结

| 章节 | 在本项目中的具体应用 |
|------|---------------------|
| Ch01 | `OpenAIProvider` 作为 LLM 后端 |
| Ch02 | 6 个 `defineTool` 客服业务工具 + `ToolRegistry` |
| Ch03 | `Agent` 的 ReAct 循环驱动工具调用与回复 |
| Ch04 | `ConversationMemory` 维护多轮对话上下文 |
| Ch05 | `RAGPipeline` + `VectorStore` + `SimpleEmbedder` 索引知识库 |
| Ch06 | `StreamingAgent` 提供实时流式回复 |
| Ch07 | 架构预留，可扩展为 Orchestrator 模式（意图分类→专家 Agent） |
| Ch08 | 架构预留，可通过 MCP 接入外部 CRM/ERP 系统 |
| Ch09 | `ContentFilter` + `PromptInjectionDetector` + `PIIDetector` + `RateLimiter` |
| Ch10 | `TracedAgent` + `Tracer` + `MetricsCollector` + `Dashboard` |
| Ch11 | 架构预留，可用 `EvalRunner` + `GoldenDataset` 评估客服回复质量 |
| Ch12 | `LLMCache` + `CostTracker` + `PromptOptimizer` |

## C.12 扩展方向

1. **Multi-Agent 升级**: 将系统拆分为意图识别 Agent + 产品咨询 Agent + 账户管理 Agent + 技术支持 Agent，用 Orchestrator 路由
2. **MCP 接入**: 通过 MCP 连接真实的用户数据库、订单系统、CRM
3. **评估闭环**: 建立 GoldenDataset，定期评估客服回复质量，自动优化 Prompt
4. **Model Router**: 简单问候用 mini 模型，复杂技术问题用 4o 模型
5. **语义缓存**: 相似问题命中缓存（基于 Embedding 相似度）
6. **满意度追踪**: 对话结束后收集用户评分，关联到 Trace

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `projects/customer-service/customer-service.ts` | 核心 `CustomerServiceBot` 类 |
| `projects/customer-service/tools.ts` | 6 个客服工具 + 模拟数据 |
| `projects/customer-service/main.ts` | CLI 交互入口 |
| `projects/customer-service/knowledge-base/products.md` | 产品目录 |
| `projects/customer-service/knowledge-base/faq.md` | 常见问题 |
| `projects/customer-service/knowledge-base/policies.md` | 客服政策 |
| `projects/customer-service/__tests__/tools.test.ts` | 工具测试 (13) |
| `projects/customer-service/__tests__/customer-service.test.ts` | 系统测试 (12) |
| `projects/customer-service/__tests__/integration.test.ts` | API 集成测试 (3) |
| `docs/project-c-customer-service.md` | 本文档 |
