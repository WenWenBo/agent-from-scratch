# Chapter 11：评估体系 -- 量化 Agent 的能力

> "Without data, you're just another person with an opinion." -- W. Edwards Deming

---

## 1. 为什么需要评估？

Agent 的输出是**非确定性的** -- 同样的输入可能产生不同的回复。这使得传统的 `assert(output === expected)` 单元测试远远不够。

评估体系需要回答三个核心问题：

1. **Agent 有多准确？** -- 回答是否正确、完整、相关
2. **Agent 有多可靠？** -- 在不同输入下表现是否一致
3. **Agent 有多高效？** -- 延迟、Token 消耗、成本是否在预算内

### 1.1 评估的场景

| 场景 | 何时评估 | 评估什么 |
|------|---------|---------|
| 开发阶段 | 每次修改 Prompt/工具后 | 回归：有没有引入问题 |
| 模型切换 | 从 GPT-4o 切换到更便宜的模型 | 质量 vs 成本的权衡 |
| 上线前 | 部署到生产之前 | 整体质量是否达标 |
| 运行时 | 生产环境持续监控 | 质量漂移、异常检测 |

### 1.2 行业工具

| 工具 | 特点 |
|------|------|
| [LangSmith Evaluation](https://docs.smith.langchain.com/evaluation) | LangChain 官方，支持 LLM-as-a-Judge |
| [Langfuse Scores](https://langfuse.com/docs/scores) | 开源，分数 + 追踪一体化 |
| [Ragas](https://docs.ragas.io/) | 专注 RAG 评估（Faithfulness, Relevance） |
| [DeepEval](https://docs.confident-ai.com/) | 全面的 LLM 评估框架 |

本章从零实现一个**纯 TypeScript 评估框架**，深入理解底层原理。

---

## 2. 架构概览

```
┌──────────────────────────────────────────────────────┐
│                    EvalRunner                         │
│  (批量运行 Agent + 评估器 → 生成报告)                  │
└──────────────┬──────────────────────┬────────────────┘
               │                      │
    ┌──────────▼──────────┐  ┌───────▼────────┐
    │    GoldenDataset     │  │   Evaluators    │
    │  (黄金测试用例集)     │  │  (评估器组合)   │
    │                      │  │                 │
    │  id: "q1"            │  │  ┌────────────┐ │
    │  input: "2+2=?"      │  │  │ExactMatch  │ │
    │  expected: "4"       │  │  │Contains    │ │
    │  tags: ["math"]      │  │  │Regex       │ │
    └──────────────────────┘  │  │LLM Judge   │ │
                              │  │Composite   │ │
                              │  └────────────┘ │
                              └────────────────┘
                                      │
                              ┌───────▼────────┐
                              │   EvalReport    │
                              │  (结构化报告)   │
                              └────────────────┘
```

---

## 3. Evaluator 接口

所有评估器实现统一接口：

```typescript
export interface EvalInput {
  input: string;      // 用户问题
  output: string;     // Agent 实际输出
  expected?: string;  // 参考答案
  context?: string[]; // RAG 检索上下文
  metadata?: Record<string, unknown>;
}

export interface EvalResult {
  evaluatorName: string;
  score: number;      // 0-1, 1 为最佳
  passed: boolean;    // 是否通过阈值
  reason: string;     // 可读说明
  metadata?: Record<string, unknown>;
}

export interface Evaluator {
  readonly name: string;
  evaluate(input: EvalInput): Promise<EvalResult>;
}
```

### 设计原则

- **score 统一为 0-1**：不同评估器的分数可以直接对比和聚合
- **passed 由评估器自主判断**：每个评估器可以有自己的通过阈值
- **reason 必须可读**：方便人类理解评估结果
- **异步接口**：支持需要 LLM 调用的评估器

---

## 4. 基础评估器（确定性）

### 4.1 评估器清单

| 评估器 | 功能 | 适用场景 |
|--------|------|---------|
| `ExactMatchEvaluator` | 精确字符串匹配 | 数学计算、事实问答 |
| `ContainsEvaluator` | 关键词包含检查 | 答案中需包含特定信息 |
| `RegexEvaluator` | 正则表达式匹配 | 格式检查（日期、数字等） |
| `LengthEvaluator` | 输出长度检查 | 防止过短/过长回复 |
| `JsonValidEvaluator` | JSON 格式校验 | 结构化输出检查 |
| `LatencyEvaluator` | 延迟阈值检查 | 性能 SLA |
| `CostEvaluator` | 成本阈值检查 | 预算控制 |
| `CompositeEvaluator` | 组合多个评估器 | 多维度综合评估 |

### 4.2 ExactMatch -- 精确匹配

```typescript
const ev = new ExactMatchEvaluator({ ignoreCase: true, trim: true });
const result = await ev.evaluate({
  input: 'What is 2+2?',
  output: '  4  ',
  expected: '4',
});
// score: 1, passed: true
```

### 4.3 Contains -- 关键词检查

```typescript
const ev = new ContainsEvaluator({
  keywords: ['python', 'javascript', 'rust'],
  minMatches: 2,  // 至少包含 2 个关键词即通过
  ignoreCase: true,
});
```

分数计算：`matched.length / total.length`，所以部分匹配也有分数。

### 4.4 CompositeEvaluator -- 组合策略

| 策略 | 含义 | passed 判定 | score 计算 |
|------|------|-----------|-----------|
| `all` | 全部通过 | 所有子评估器都 passed | 平均分 |
| `any` | 至少一个通过 | 任一子评估器 passed | 最高分 |
| `average` | 平均分 | 平均分 ≥ 0.5 | 简单平均 |
| `weighted` | 加权平均 | 加权平均 ≥ 0.5 | 加权平均 |

```typescript
const composite = new CompositeEvaluator({
  evaluators: [exactMatch, containsKeywords, lengthCheck],
  strategy: 'weighted',
  weights: [3, 2, 1],  // 正确性权重最高
});
```

---

## 5. LLM-as-a-Judge -- 用 LLM 做主观评估

### 5.1 核心思想

对于开放性问题（如"解释量子力学"），没有唯一正确答案。传统评估器无能为力，但 LLM 可以充当"评委"，对回复质量做出主观判断。

> 论文参考: [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685)

### 5.2 评估维度

| 维度 | 评估内容 | 典型应用 |
|------|---------|---------|
| `correctness` | 事实准确性 | 知识问答 |
| `helpfulness` | 是否真正解决问题 | 客服对话 |
| `relevance` | 是否围绕问题回答 | RAG 应用 |
| `coherence` | 逻辑通顺、结构清晰 | 长文生成 |
| `safety` | 无有害/偏见内容 | 所有场景 |
| `custom` | 自定义评估标准 | 特定业务 |

### 5.3 实现原理

```typescript
const judge = new LLMJudge({
  provider: openaiProvider,
  model: 'gpt-4o',
  criteria: [
    { dimension: 'correctness', threshold: 0.7, weight: 3 },
    { dimension: 'helpfulness', threshold: 0.6, weight: 2 },
    { dimension: 'safety', threshold: 0.9, weight: 1 },
  ],
});
```

对每个维度，LLM Judge 构建一个结构化 Prompt：

```
## Evaluation Task: CORRECTNESS
[维度评估标准]

## User Question
[用户原始问题]

## Response to Evaluate
[Agent 的输出]

## Reference Answer (if any)
[参考答案]

## Instructions
Rate on a scale of 0-10.
Respond with JSON: {"score": <0-10>, "reason": "<explanation>"}
```

### 5.4 评分解析的鲁棒性

LLM 不一定严格输出 JSON，所以需要多级解析策略：

1. **JSON 提取**：正则匹配 `{...}` 并 `JSON.parse`
2. **Fallback 解析**：匹配 "8 out of 10" 或 "8/10" 格式
3. **默认值**：解析失败时返回 score 5

```typescript
private parseJudgeResponse(content: string) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return this.fallbackParse(content);
    const parsed = JSON.parse(jsonMatch[0]);
    return { score: Math.max(0, Math.min(10, parsed.score)), reason: parsed.reason };
  } catch {
    return this.fallbackParse(content);
  }
}
```

### 5.5 多维度加权汇总

```
finalScore = Σ(dimensionScore × weight) / Σ(weight)
```

只有当**所有维度**都通过各自的阈值时，整体才标记为 `passed`。

---

## 6. GoldenDataset -- 黄金数据集

### 6.1 设计

黄金数据集是**人工标注的标准测试集**，包含期望的输入输出对。

```typescript
export interface GoldenCase {
  id: string;           // 唯一 ID
  input: string;        // 用户输入
  expected: string;     // 期望输出
  tags?: string[];      // 分类标签
  context?: string[];   // RAG 上下文
  metadata?: Record<string, unknown>;
}
```

### 6.2 构建数据集

```typescript
const dataset = new GoldenDataset('math-qa');
dataset.addMany([
  { id: 'add-1', input: 'What is 2+3?', expected: '5', tags: ['addition'] },
  { id: 'mul-1', input: 'What is 7*8?', expected: '56', tags: ['multiplication'] },
  { id: 'div-1', input: '100 / 4?', expected: '25', tags: ['division'] },
]);
```

### 6.3 标签过滤

```typescript
// 只运行数学相关的 case
const mathCases = dataset.filterByTag('addition');

// 同时匹配多个标签
const filtered = dataset.filterByTags(['math', 'hard'], 'all');
```

### 6.4 持久化

```typescript
// 保存到文件
await dataset.saveToFile('./golden-math.json');

// 从文件加载
const loaded = await GoldenDataset.loadFromFile('./golden-math.json');
```

---

## 7. EvalRunner -- 评估运行器

### 7.1 流程

```
GoldenDataset.cases
    │
    ├── case 1 → Agent.run(input) → Evaluator.evaluate() → CaseResult
    ├── case 2 → Agent.run(input) → Evaluator.evaluate() → CaseResult
    └── case N → Agent.run(input) → Evaluator.evaluate() → CaseResult
                                                              │
                                                    ┌─────────▼─────────┐
                                                    │    EvalReport      │
                                                    │  passRate: 80%     │
                                                    │  avgScore: 0.85    │
                                                    │  evaluatorBreakdown│
                                                    └───────────────────┘
```

### 7.2 配置

```typescript
const runner = new EvalRunner({
  target: agent,           // 被评估的 Agent
  evaluators: [            // 评估器组合
    new ContainsEvaluator({ keywords: ['answer'] }),
    new LLMJudge({ ... }),
  ],
  concurrency: 3,          // 并发运行 3 个 case
  timeoutMs: 30000,        // 单 case 超时 30s
  onProgress: (done, total, result) => {
    console.log(`[${done}/${total}] ${result.caseId}: ${result.passed ? '✓' : '✗'}`);
  },
});
```

### 7.3 超时控制

使用 `Promise.race` 实现：

```typescript
private async runWithTimeout(input: string) {
  return Promise.race([
    this.target.run(input),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${this.timeoutMs}ms`)), this.timeoutMs)
    ),
  ]);
}
```

### 7.4 评估报告

```typescript
interface EvalReport {
  datasetName: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  passRate: number;        // 0-1
  avgScore: number;        // 0-1
  evaluatorBreakdown: {    // 按评估器分解
    [name]: { avgScore, passRate, passCount, failCount }
  };
  caseResults: CaseResult[];
  totalDurationMs: number;
}
```

### 7.5 报告输出

```
╔══════════════════════════════════════════════════╗
║            Agent Evaluation Report               ║
╚══════════════════════════════════════════════════╝

Dataset:    math-qa
Duration:   12.3s

📊 Overview
  Total Cases:  20
  Passed:       16 (80.0%)
  Failed:       3
  Errors:       1
  Avg Score:    82.5%

📋 Evaluator Breakdown
  [exact_match]  85% avg  |  17/20 passed  [█████████████░░]
  [llm_judge]    80% avg  |  16/20 passed  [████████████░░░]

❌ Failed Cases
  [div-5] Score: 30% | 2500ms
    Input:    What is 1/0?
    Expected: undefined
    Actual:   The result is Infinity
    ✗ exact_match: Output does not match expected
```

---

## 8. 评估策略指南

### 8.1 何时用基础评估器 vs LLM Judge

| 场景 | 推荐评估器 | 原因 |
|------|-----------|------|
| 数学计算 | ExactMatch | 答案确定，不需要主观判断 |
| 事实问答 | Contains + ExactMatch | 关键词必须出现 |
| 格式要求 | JsonValid / Regex | 结构性检查 |
| 开放问答 | LLM Judge | 答案多样，需要语义理解 |
| 创意写作 | LLM Judge (multi-dim) | 多维度主观评估 |
| 安全检查 | LLM Judge (safety) | 需要理解上下文 |
| 性能 SLA | Latency + Cost | 纯指标检查 |

### 8.2 构建黄金数据集的原则

1. **覆盖核心场景**：每个重要功能至少 3-5 个 case
2. **包含边界情况**：空输入、超长输入、特殊字符
3. **标签分类**：便于按维度分析弱项
4. **持续增长**：每次发现新 bug，添加对应 case
5. **定期审查**：随业务变化更新 expected 答案

### 8.3 LLM-as-a-Judge 的局限

| 问题 | 影响 | 缓解措施 |
|------|------|---------|
| 评估模型的偏见 | 可能偏好特定风格 | 使用多个模型交叉评估 |
| 评分一致性 | 同输入不同次可能不同分 | temperature=0 + 多次评估取均值 |
| 成本 | 每个 case 额外 LLM 调用 | 基础评估器优先，LLM Judge 补充 |
| 循环依赖 | 用 GPT-4 评估 GPT-4 的输出 | 用更强的模型做评委 |

---

## 9. 测试

### 9.1 测试统计

| 测试文件 | 测试数 | 描述 |
|----------|-------|------|
| basic-evaluators.test.ts | 26 | 8 种基础评估器 |
| llm-judge.test.ts | 9 | LLM-as-a-Judge（mock LLM） |
| golden-dataset.test.ts | 10 | 数据集 CRUD 和持久化 |
| eval-runner.test.ts | 10 | 批量评估和报告生成 |
| **总计** | **55** | |

### 9.2 运行测试

```bash
# 仅运行评估模块测试
npx vitest run src/evaluation/

# 全量回归
npx vitest run --exclude '**/integration*'
```

---

## 10. 文件清单

```
src/evaluation/
├── evaluator.ts                    # Evaluator 接口定义
├── basic-evaluators.ts             # 8 种基础评估器
├── llm-judge.ts                    # LLM-as-a-Judge
├── golden-dataset.ts               # 黄金数据集管理
├── eval-runner.ts                  # 评估运行器 + 报告
├── index.ts                        # 统一导出
└── __tests__/
    ├── basic-evaluators.test.ts    # 26 tests
    ├── llm-judge.test.ts           #  9 tests
    ├── golden-dataset.test.ts      # 10 tests
    └── eval-runner.test.ts         # 10 tests
                                    # 共 55 tests

examples/
└── 11-evaluation.ts                # 使用示例
```
