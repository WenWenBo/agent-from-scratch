# TinyAgent

TinyAgent 是一个面向 TypeScript 开发者的 Agent 工程化教程与实战框架。  
项目采用“从简单到复杂”的渐进式路线，完整实现了生产级 Agent 核心能力：LLM Provider、工具系统、ReAct 循环、记忆系统、RAG、流式输出、Multi-Agent 协作、MCP 协议、安全护栏、可观测性、评估体系、性能与成本优化，以及可插拔 Skills 技能系统。  
仓库同时提供 3 个真实项目案例（文档助手、代码审查 Agent、客服智能体），帮助你把原理落地为可运行、可测试、可扩展的工程能力。

## 核心特性

- 纯 TypeScript 实现，强调底层原理与工程实践
- 4 个阶段，13 个章节，循序渐进构建完整 Agent 框架
- 覆盖生产化关键能力：安全、评估、可观测性、性能与成本优化
- 提供 3 个端到端实战项目，便于直接复用到业务场景

## 教程入口

- 文档目录首页：`docs/index.md`
- 章节导航（Web）：启动文档站后访问 `http://localhost:5173/`

## 快速开始

```bash
pnpm install
cp .env.example .env
```

填入 API Key 后可运行：

```bash
# 运行单个示例
pnpm example examples/03-react-loop.ts

# 单元测试（默认跳过 integration）
pnpm test

# 文档站本地预览
pnpm docs:dev
```

## 项目结构

```text
src/        # 框架核心模块（providers/tools/agent/memory/rag/...）
projects/   # 3 个实战项目
examples/   # 各章节示例代码
docs/       # 教程文档与 VitePress 站点
```

## License

建议使用 MIT 协议（可在仓库根目录添加 `LICENSE` 文件启用）。

