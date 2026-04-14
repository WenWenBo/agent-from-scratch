# Project B：自动化代码审查 Agent

> 综合运用：LLM Provider、工具系统、Agent ReAct 循环、Multi-Agent Pipeline、安全护栏

---

## 1. 项目概述

本项目构建一个**自动化代码审查 Agent**，它能够：

1. **自动扫描**项目目录中的源码文件
2. **识别 Bug 风险**：除零错误、空数组访问、未处理异常
3. **安全漏洞检测**：硬编码密钥、eval() 使用、SQL 注入风险
4. **代码风格检查**：any 类型、嵌套过深、函数过长、魔法数字
5. **生成结构化审查报告**：带评分、分级问题、修复建议

### 1.1 架构亮点

本项目是之前章节知识的**综合实战**，集中使用了以下框架模块：

| 框架模块 | 在本项目中的应用 |
|---------|---------------|
| Chapter 01: LLM Provider | OpenAIProvider 驱动所有 Agent |
| Chapter 02: 工具系统 | 4 个自定义文件分析工具 |
| Chapter 03: Agent (ReAct) | 每个子 Agent 使用 ReAct 循环分析代码 |
| Chapter 07: Multi-Agent | SequentialPipeline 串联 4 个审查阶段 |
| Chapter 09: Guardrails | PIIDetector 过滤报告中的真实密钥 |

---

## 2. 系统架构

### 2.1 Pipeline 流水线

```
用户输入: "审查项目代码"
    │
    ▼
┌─────────────────────────────────────────────────┐
│           SequentialPipeline (4 阶段)             │
│                                                   │
│  Stage 1: CodeAnalyzer                            │
│  ├─ 工具: list_files, read_file, count_lines      │
│  ├─ 职责: 读取所有源码, 统计指标, 发现 Bug         │
│  └─ 输出: [BUG] file:line - description           │
│                     │                              │
│                     ▼                              │
│  Stage 2: SecurityScanner                         │
│  ├─ 工具: read_file, search_pattern               │
│  ├─ 职责: 搜索安全模式, 深度安全分析               │
│  └─ 输出: [SECURITY:severity] file:line - desc    │
│                     │                              │
│                     ▼                              │
│  Stage 3: StyleChecker                            │
│  ├─ 工具: read_file, count_lines, search_pattern  │
│  ├─ 职责: 代码风格和最佳实践检查                   │
│  └─ 输出: [STYLE:severity] file:line - desc       │
│                     │                              │
│                     ▼                              │
│  Stage 4: ReviewSummarizer                        │
│  ├─ 工具: 无 (纯 LLM 汇总)                        │
│  ├─ 职责: 汇总所有发现, 生成结构化报告             │
│  └─ 输出: Markdown 格式审查报告 + 评分             │
└─────────────────────────────────────────────────┘
    │
    ▼
┌──────────────┐
│ 输出护栏      │  PIIDetector: 检测并掩码泄露的密钥
└──────────────┘
    │
    ▼
  审查报告 (ReviewReport)
```

### 2.2 数据流转

Pipeline 中，每个阶段的输出自动成为下一阶段的输入：

```
CodeAnalyzer.output ──────────────────→ SecurityScanner.input
  "发现以下文件和潜在 Bug: ..."            "基于之前的分析，进行安全审计..."

SecurityScanner.output ───────────────→ StyleChecker.input
  "安全扫描发现以下问题: ..."              "基于之前分析，检查代码风格..."

StyleChecker.output ──────────────────→ ReviewSummarizer.input
  "代码风格检查结果: ..."                  "汇总所有发现，生成最终报告..."
```

---

## 3. 工具设计

### 3.1 工具列表

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `list_files` | 列出源码文件（名称、大小、行数） | `extension?` 扩展名过滤 |
| `read_file` | 读取文件内容（带行号，支持范围） | `filename`, `startLine?`, `endLine?` |
| `count_lines` | 统计代码指标（行数、函数数、嵌套深度） | `filename` |
| `search_pattern` | 正则搜索代码模式 | `pattern`, `fileExtension?` |

### 3.2 工具实现要点

**依赖注入模式**（与 Project A 相同）：

```typescript
let codeDir = '';

export function setCodeDir(dir: string): void {
  codeDir = dir;
}
```

通过 `setCodeDir()` 在 `CodeReviewer` 构造时注入目录路径，使工具的 `execute` 函数能访问正确的文件系统位置。

**安全检查**：

```typescript
// 路径穿越防护
if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
  throw new Error('Access denied: path traversal detected');
}
```

**代码度量计算**（`count_lines`）：

```typescript
// 简易函数检测
const functionMatches = content.match(
  /(?:export\s+)?(?:async\s+)?function\s+\w+/g
) ?? [];

// 嵌套深度检测
let maxNesting = 0;
let currentNesting = 0;
for (const line of lines) {
  const opens = (line.match(/\{/g) ?? []).length;
  const closes = (line.match(/\}/g) ?? []).length;
  currentNesting += opens - closes;
  if (currentNesting > maxNesting) maxNesting = currentNesting;
}
```

---

## 4. Agent 构建

### 4.1 子 Agent 设计

每个子 Agent 都是一个 `AgentWrapper`，包装了带有特定 `systemPrompt` 和 `tools` 的 `Agent`：

```typescript
private createAnalyzerAgent(): BaseAgent {
  const tools = new ToolRegistry();
  tools.register(listFilesTool);
  tools.register(readFileTool);
  tools.register(countLinesTool);

  return new AgentWrapper({
    provider: this.provider,
    model: this.model,
    systemPrompt: `You are a Code Analyzer. Your job is to:
1. List all source files using the list_files tool
2. Read each file using the read_file tool
3. Get metrics for each file using count_lines tool
4. Identify potential BUGS...`,
    tools,
    maxSteps: 15,
    name: 'code-analyzer',
    description: 'Reads source files, collects metrics, and identifies bug risks',
  });
}
```

### 4.2 各阶段 Agent 的职责划分

| Agent | System Prompt 核心指令 | 配备的工具 | 最大步数 |
|-------|----------------------|-----------|---------|
| CodeAnalyzer | 列出文件→逐个读取→统计指标→找 Bug | list_files, read_file, count_lines | 15 |
| SecurityScanner | 搜索安全模式→读取上下文→深度分析 | read_file, search_pattern | 15 |
| StyleChecker | 搜索 any 类型→检查复杂度→评估风格 | read_file, count_lines, search_pattern | 15 |
| ReviewSummarizer | 汇总前三个阶段→生成结构化报告 | 无 | 3 |

### 4.3 Pipeline 组装

```typescript
this.pipeline = new SequentialPipeline({
  name: 'code-review-pipeline',
  description: 'Automated code review with analysis, security, style, and summary',
  agents: [analyzer, securityScanner, styleChecker, summarizer],
});
```

---

## 5. 报告生成与解析

### 5.1 报告格式

Summarizer Agent 被指令生成如下格式的 Markdown 报告：

```markdown
## Code Review Report

### Summary
[One paragraph overview of the codebase health]

### Issues Found

#### Critical Issues
- **[FILE:LINE]** [CATEGORY] Description
  - Suggestion: How to fix

#### Warnings
- **[FILE:LINE]** [CATEGORY] Description
  - Suggestion: How to fix

#### Informational
- **[FILE:LINE]** [CATEGORY] Description
  - Suggestion: Improvement idea

### Metrics
- Total Files Reviewed: N
- Total Issues: N (X critical, Y warnings, Z info)

### Score: XX/100
```

### 5.2 报告解析逻辑

`parseReport` 方法将 LLM 生成的 Markdown 解析为结构化的 `ReviewReport`：

```typescript
interface ReviewReport {
  summary: string;
  issues: ReviewIssue[];
  metrics: { totalFiles, totalLines, criticalCount, warningCount, infoCount };
  score: number;
  rawContent: string;
}
```

**解析策略**：

1. **Section-based severity detection**：先扫描所有 `####` 标题（Critical/Warning/Info）的位置，然后根据每个 issue 在文档中的位置决定其 severity
2. **正则提取 issue**：匹配 `**[FILE:LINE]** [CATEGORY] description` 格式
3. **Score 提取**：匹配 `Score: XX/100`

```typescript
const getSeverityByPosition = (pos: number): ReviewIssue['severity'] => {
  let result: ReviewIssue['severity'] = 'info';
  for (const h of sectionHeadings) {
    if (h.index <= pos) result = h.severity;
    else break;
  }
  return result;
};
```

---

## 6. 安全护栏集成

审查过程中，Agent 会读取包含硬编码密钥的代码。为防止审查报告将真实密钥原样输出，我们在输出阶段加入 `PIIDetector`：

```typescript
this.outputGuardrail = new GuardrailPipeline();
this.outputGuardrail.add(new PIIDetector({
  enabledCategories: ['api_key', 'email'],
  action: 'flag',
}));

// 审查完成后
const guardResult = await this.outputGuardrail.run(result.content, 'output');
if (!guardResult.passed) {
  finalContent = piiDetector.mask(result.content);
  // "sk-1234567890abcdef" → "sk-[REDACTED]"
}
```

---

## 7. 示例代码

项目在 `sample-code/` 目录下提供了两个有意留有问题的文件：

### calculator.ts 中的问题
- **Bug**: `divide()` 未处理除以零
- **Bug**: `getAverage()` 未处理空数组
- **Security**: 硬编码 `API_KEY`
- **Security**: 使用 `eval()`
- **Style**: `processData()` 使用 `any` 类型
- **Style**: `generateReport()` 函数过长、参数过多

### user-service.ts 中的问题
- **Security**: 明文存储密码
- **Security**: SQL 注入风险（字符串拼接）
- **Bug**: `findUser()` 使用非空断言 `!`，未处理未找到情况
- **Bug**: `sendEmail()` 未处理 fetch 失败
- **Style**: `processOrder()` 嵌套深度达 5 层
- **Style**: 魔法数字 (8, 128)

---

## 8. 测试

### 8.1 工具单元测试（14 个）

```
✓ list_files > 应列出所有文件
✓ list_files > 应按扩展名过滤
✓ list_files > 应包含文件大小和行数
✓ read_file > 应读取完整文件（带行号）
✓ read_file > 应支持行号范围
✓ read_file > 应阻止路径穿越
✓ read_file > 应对不存在的文件抛错
✓ count_lines > 应统计代码指标
✓ count_lines > 应区分代码行、注释行和空行
✓ search_pattern > 应搜索到 eval 使用
✓ search_pattern > 应搜索到 any 类型
✓ search_pattern > 应搜索到硬编码密钥
✓ search_pattern > 应支持文件扩展名过滤
✓ search_pattern > 搜索无结果时应返回提示字符串
```

### 8.2 CodeReviewer 单元测试（7 个）

```
✓ 应正确构造 CodeReviewer 实例
✓ 应正确解析包含问题的审查报告
✓ 应正确识别不同严重级别
✓ 应处理空报告
✓ 应解析 Score 字段
✓ Pipeline 事件回调应按顺序触发
✓ 应正确提取 Summary 段落
```

### 8.3 集成测试（需真实 API）

```
✓ 应能完成完整代码审查 (120s timeout)
✓ 应能审查单个文件 (120s timeout)
✓ 应检测到示例代码中的安全问题 (120s timeout)
```

### 8.4 运行测试

```bash
# 仅运行工具和 CodeReviewer 单元测试
npx vitest run projects/code-reviewer/__tests__/tools.test.ts
npx vitest run projects/code-reviewer/__tests__/code-reviewer.test.ts

# 运行集成测试（需配置 .env）
npx vitest run projects/code-reviewer/__tests__/integration.test.ts
```

---

## 9. 运行方式

```bash
# 审查 sample-code 目录
npx tsx projects/code-reviewer/main.ts

# 审查指定目录
npx tsx projects/code-reviewer/main.ts /path/to/your/project

# CLI 命令
> review              # 审查所有文件
> review calculator.ts # 审查单个文件
> quit                # 退出
```

---

## 10. 文件清单

```
projects/code-reviewer/
├── code-reviewer.ts              # 核心类：CodeReviewer
├── tools.ts                      # 4 个自定义工具
├── main.ts                       # CLI 入口
├── sample-code/
│   ├── calculator.ts             # 示例：计算器模块（Bug + 安全 + 风格问题）
│   └── user-service.ts           # 示例：用户服务（安全 + 嵌套 + 错误处理）
└── __tests__/
    ├── tools.test.ts             # 工具单元测试（14 个）
    ├── code-reviewer.test.ts     # CodeReviewer 单元测试（7 个）
    └── integration.test.ts       # 集成测试（3 个）
```

---

## 11. 设计思考

### 为什么选择 Pipeline 而不是 Orchestrator？

| 维度 | Pipeline | Orchestrator |
|------|----------|-------------|
| **执行顺序** | 固定的 A→B→C→D | LLM 动态路由 |
| **可预测性** | 高，每次运行路径相同 | 低，依赖 LLM 判断 |
| **信息传递** | 上一阶段的完整输出传递给下一阶段 | 仅传递用户原始输入 |
| **适用场景** | 审查流程（分析→安全→风格→汇总） | 开放性任务分发 |
| **调试难度** | 低，可逐阶段追踪 | 高，路由决策不透明 |

代码审查是一个**流程固定**的任务，每个阶段的输出为下一阶段提供上下文。Pipeline 的确定性和可追踪性使其成为最佳选择。

### 为什么 Summarizer 不需要工具？

Summarizer 的输入是前三个阶段的完整分析结果，它的任务是**理解、归纳、格式化**，这恰好是 LLM 最擅长的纯文本推理任务。给它工具反而会分散注意力。

### 关于评分机制

评分标准在 System Prompt 中硬编码：
- 起始 100 分
- Critical: -15 分/个
- Warning: -5 分/个
- Info: -2 分/个

这是一种**可解释的**评分方式。生产环境中可以改为配置化，或使用 LLM-as-a-Judge 做更细粒度的评估（详见 Chapter 11: 评估体系）。
