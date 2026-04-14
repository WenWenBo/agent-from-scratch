# Agent 架构设计文档

## 概述

本文档描述了 TinyAgent 框架的整体架构设计，包括核心组件、数据流和扩展机制。

## 核心组件

### 1. LLM Provider 层

Provider 是框架与大语言模型之间的桥梁。采用策略模式设计，支持多种 LLM 供应商：

- **OpenAI Provider**: 支持 OpenAI API 及兼容端点（如 DeepSeek、Azure OpenAI）
- **Anthropic Provider**: 支持 Claude 系列模型

每个 Provider 需要实现两个核心方法：
- `chat()`: 非流式调用，返回完整响应
- `stream()`: 流式调用，返回 AsyncIterable<StreamChunk>

### 2. 工具系统

工具系统让 Agent 能够与外部世界交互。采用 Zod 进行参数定义和校验：

- **defineTool()**: 类型安全的工具定义
- **ToolRegistry**: 工具注册中心，负责管理和执行工具
- **zodToJsonSchema()**: 手写的 Zod → JSON Schema 转换器

### 3. ReAct 循环

Agent 的核心推理循环遵循 ReAct 模式（Reasoning + Acting）：

1. **Think**: 调用 LLM 进行推理
2. **Act**: 如果 LLM 决定使用工具，执行工具调用
3. **Observe**: 将工具结果反馈给 LLM
4. **Answer**: LLM 生成最终回复

### 4. 记忆系统

记忆系统分为两层：

- **短期记忆（ConversationMemory）**: 管理当前对话的上下文窗口
  - SlidingWindowStrategy: 保留最近 N 条消息
  - TokenBudgetStrategy: 按 token 预算管理
  - SummaryWindowStrategy: 超长对话自动摘要

- **长期记忆（MemoryStore）**: 跨会话的持久化信息
  - InMemoryStore: 内存存储
  - FileMemoryStore: 文件持久化

### 5. RAG 系统

RAG（Retrieval Augmented Generation）让 Agent 能够利用外部知识：

- **Embedder**: 将文本转换为向量（OpenAI API 或本地 SimpleEmbedder）
- **ChunkStrategy**: 将长文档分块（FixedSize / Paragraph / Markdown）
- **VectorStore**: 向量存储和语义搜索
- **RAGPipeline**: 编排检索和增强流程

### 6. 流式输出

流式输出提升用户体验：

- **StreamCollector**: 收集流式 chunk 为完整响应
- **StreamingAgent**: 基于 AsyncGenerator 的流式 ReAct 循环

## 数据流

```
用户输入 → Agent → LLM Provider → LLM API
                ↑        ↓
                ← Tool Results ←
                ↓
           输出回复
```

## 扩展点

1. 自定义 Provider（实现 LLMProvider 抽象类）
2. 自定义工具（使用 defineTool）
3. 自定义窗口策略（实现 WindowStrategy 接口）
4. 自定义 Embedder（实现 Embedder 接口）
5. 自定义 ChunkStrategy（实现 ChunkStrategy 接口）

## 版本历史

- v0.1: Provider + 工具系统 + ReAct 循环
- v0.2: 记忆系统 + RAG
- v0.3: 流式输出
