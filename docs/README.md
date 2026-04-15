# TinyAgent: 从零手写生产级 Agent 框架

> 面向有 TypeScript/前端经验的开发者，从零构建一个功能完整的 AI Agent 框架。

## 教程导航

本教程采用**渐进式构建**策略，分为 4 个阶段、13 个章节 + 3 个实战项目。每章在前一章代码基础上扩展，最终形成一个名为 **TinyAgent** 的生产级框架。

### Stage 1: 基础 -- 让 Agent 跑起来

| 章节 | 标题 | 核心内容 |
|------|------|----------|
| [Chapter 01](./chapter-01-llm-provider.md) | 与 LLM 对话 -- Provider 抽象层 | 可插拔的多模型接入、统一消息格式 |
| [Chapter 02](./chapter-02-tool-system.md) | 给 Agent 装上双手 -- 工具系统 | Zod Schema、工具注册与执行、沙箱机制 |
| [Chapter 03](./chapter-03-react-loop.md) | Agent 的心脏 -- ReAct 循环 | Think-Act-Observe 循环、终止条件、错误恢复 |

### Stage 2: 核心能力 -- 让 Agent 更聪明

| 章节 | 标题 | 核心内容 |
|------|------|----------|
| [Chapter 04](./chapter-04-memory-system.md) | Agent 的记忆 -- Memory 系统 | 短期/长期/工作记忆、Token 截断、摘要压缩 |
| [Chapter 05](./chapter-05-rag-integration.md) | 知识增强 -- RAG 与 Agent 结合 | 纯 TS 向量计算、BM25、混合检索、自反思检索 |
| [Chapter 06](./chapter-06-streaming.md) | 实时响应 -- 流式输出与 UI | SSE、事件流、终端/Web Chat UI |

**实战项目 A**: [智能文档助手](./project-a-doc-assistant.md)

### Stage 3: 高级架构 -- 让 Agent 更强大

| 章节 | 标题 | 核心内容 |
|------|------|----------|
| [Chapter 07](./chapter-07-multi-agent.md) | 团队协作 -- Multi-Agent 系统 | Supervisor/Swarm 模式、Handoff、状态图引擎 |
| [Chapter 08](./chapter-08-mcp-protocol.md) | 标准化连接 -- MCP 协议支持 | MCP Client/Server、Stdio/HTTP 传输层 |
| [Chapter 09](./chapter-09-guardrails.md) | 安全第一 -- 护栏与权限系统 | Prompt 注入防御、工具权限、Human-in-the-loop |

**实战项目 B**: [自动化代码审查 Agent](./project-b-code-reviewer.md)

### Stage 4: 生产化 -- 让 Agent 可靠运行

| 章节 | 标题 | 核心内容 |
|------|------|----------|
| [Chapter 10](./chapter-10-observability.md) | 看得见的 Agent -- 可观测性系统 | Trace/Span、OpenTelemetry、Trace Viewer |
| [Chapter 11](./chapter-11-evaluation.md) | 衡量 Agent 好坏 -- 评估体系 | LLM-as-a-Judge 自举评估、Golden Dataset、回归测试 |
| [Chapter 12](./chapter-12-optimization.md) | 性能与成本 -- 生产环境优化 | 语义缓存、模型路由、优雅降级、基准测试 |
| [Chapter 13](./chapter-13-skills.md) | 可插拔能力 -- 技能系统 | 渐进式披露、Caps 约束、Prompt 模板、文件加载 |

**实战项目 C**: [客服智能体系统](./project-c-customer-service.md)

---

## 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 语言 | TypeScript 5.x | 类型安全，前端友好 |
| 运行时 | Node.js 22+ | 原生 fetch、顶层 await |
| 包管理 | pnpm | 高效磁盘利用 |
| 测试 | Vitest | 快速、ESM 原生支持 |
| Schema | Zod | 运行时校验 + 类型推导 |
| HTTP | 原生 fetch | 零依赖，理解底层 |

## 前置要求

- 熟悉 TypeScript 基础语法
- 了解 async/await 异步编程
- 有基本的 HTTP API 调用经验
- 准备至少一个 LLM API Key（OpenAI / Anthropic / DeepSeek）

## 快速开始

```bash
git clone <repo-url> agent-from-scratch
cd agent-from-scratch
pnpm install
cp .env.example .env  # 填入你的 API Key
```

然后从 [Chapter 01](./chapter-01-llm-provider.md) 开始阅读。
