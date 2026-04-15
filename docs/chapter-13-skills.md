# Chapter 13: 技能系统 -- 让 Agent 拥有可插拔的能力

## 13.1 什么是技能系统？

在前面的章节中，我们的 Agent 的能力由 System Prompt + Tools 固定决定。这意味着：

- 想让 Agent 做代码审查，要改 System Prompt
- 想让 Agent 做翻译，又要改 System Prompt
- 想让 Agent 同时会两种，Prompt 会越来越长

**技能系统（Skills System）** 的核心思想是：

> **Skill = System Prompt 片段 + 工具白名单 + 参数约束的打包**

把 Agent 的不同能力封装成独立的「技能包」，按需加载、按需激活，而不是把所有能力塞进一个巨大的 System Prompt。

### 类比理解

| 概念 | 类比 |
|------|------|
| Agent | 操作系统 |
| Skill | 应用程序 |
| SkillRegistry | 应用商店 |
| SkillManager | 任务管理器 |
| SkillLoader | 包管理器 |

### 工业界参考

- **Shannon (Anthropic) Presets**: `system_prompt` + `allowed_tools` + `caps` 的三元组打包，见 [Anthropic Engineering Blog](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- **Agent Skills 标准**: SKILL.md + frontmatter 的渐进式披露，见 [Agent Skills Spec](https://agentskills.io/)
- **Semantic Kernel Plugins**: 微软的 Agent 技能系统，见 [Microsoft Docs](https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/)

## 13.2 核心设计：渐进式披露

技能系统最重要的设计原则是 **渐进式披露（Progressive Disclosure）**：

```
┌──────────────────────────────────────────┐
│ 第 1 层：元数据（Metadata）               │  ~30-50 tokens
│ name + description                       │  启动时全量加载
│ 用于搜索、发现、路由匹配                   │
├──────────────────────────────────────────┤
│ 第 2 层：指令内容（Instructions）          │  < 5k tokens
│ System Prompt 片段 + 模板变量             │  匹配时按需加载
│ 注入到活跃 Agent 的上下文中                │
├──────────────────────────────────────────┤
│ 第 3 层：扩展资源（Resources）             │  无上限
│ 参考文档、模板、脚本等                     │  显式需要时才加载
│ 如 checklist.md、glossary.md             │
└──────────────────────────────────────────┘
```

**为什么需要分层？**

一个 Agent 可能注册了 50+ 个技能，如果全部加载 instructions，光 Prompt 就超出了上下文窗口。分层让我们：

1. 启动时只扫描 name + description（几十个 token）
2. 根据用户输入匹配后，才加载完整 instructions
3. 资源文件只在实际使用时才读取

## 13.3 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                    SkillfulAgent                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 自动路由      │  │ Prompt 增强  │  │ 工具过滤     │   │
│  │ (触发词匹配)  │→│ (指令拼接)   │→│ (白名单)     │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│            ↑              ↑              ↑                │
│         SkillManager（运行时管理）                         │
│            ↑                                             │
│         SkillRegistry（注册中心）                          │
│            ↑                                             │
│         SkillLoader（文件系统加载）                        │
└──────────────────────────────────────────────────────────┘
```

## 13.4 Skill 接口定义

### 核心类型

```typescript
// src/skills/skill.ts

interface SkillCaps {
  maxTokens?: number;        // 最大 Token 数
  temperature?: number;       // Temperature 控制
  providerOverride?: string;  // 强制使用的 Provider
  preferredModel?: string;    // 首选模型
}

interface SkillMetadata {
  name: string;          // 唯一标识
  description: string;   // Agent 用此判断何时加载
  version?: string;
  tags?: string[];       // 分类标签
  triggers?: string[];   // 触发关键词
  author?: string;
}

interface Skill {
  metadata: SkillMetadata;
  instructions: string;               // 注入 system prompt 的指令
  allowedTools?: string[];            // 工具白名单
  tools?: Tool[];                     // 技能自带的专属工具
  caps?: SkillCaps;                   // 参数约束
  promptVariables?: Record<string, string>;  // 模板变量
  resources?: SkillResource[];        // 扩展资源（延迟加载）
}
```

### Caps 参数约束

Caps 是技能系统中一个重要但容易被忽略的概念。不同技能对 LLM 参数的需求不同：

| 技能类型 | temperature | maxTokens | 模型 |
|---------|------------|-----------|------|
| 代码审查 | 0.1（精确） | 4096 | 通用 |
| 创意写作 | 0.8（创意） | 8192 | 通用 |
| 翻译 | 0.3（稳定） | 2048 | GPT-4 |
| 数据分析 | 0（确定性） | 4096 | 通用 |

如果没有 Caps，所有技能共享同一套参数，翻译任务用了创意写作的 temperature=0.8 就会产生不稳定的翻译结果。

### Prompt 模板渲染

技能的 instructions 支持 `${variable}` 占位符：

```typescript
// 技能定义
const skill = defineSkill({
  metadata: { name: 'code-review', description: '代码审查' },
  instructions: '你是 ${language} 代码审查助手，按 ${standard} 标准审查',
  promptVariables: {
    language: 'TypeScript',
    standard: 'Google Style Guide',
  },
});

// 运行时覆盖
renderInstructions(
  skill.instructions,
  skill.promptVariables,
  { language: 'Python' },  // 运行时变量优先级更高
);
// → "你是 Python 代码审查助手，按 Google Style Guide 标准审查"
```

模板渲染的优先级：**运行时变量 > 技能自身变量 > 空字符串**。

## 13.5 SkillRegistry -- 技能注册中心

注册中心只负责 **存储** 和 **发现**，不涉及运行时状态：

```typescript
const registry = new SkillRegistry();

// 注册
registry.register(codeReviewSkill);
registry.register(translatorSkill);

// 精确查找
registry.get('code-review');

// 按标签搜索
registry.searchByTag('code');
// → [codeReviewSkill, testWriterSkill]

// 按触发词匹配
registry.findByTrigger('请帮我审查代码');
// → [codeReviewSkill]

// 模糊搜索
registry.search('翻译');
// → [translatorSkill]

// 元数据摘要（轻量，不含 instructions）
registry.listMetadata();
// → [{ name: '...', description: '...', tags: [...] }, ...]
```

## 13.6 SkillManager -- 运行时管理器

SkillManager 管理技能的激活/停用，构建增强后的上下文：

```typescript
const manager = new SkillManager({ registry, maxActiveSkills: 5 });

// 手动激活（可传运行时变量覆盖）
manager.activate('code-review', { language: 'Python' });

// 自动激活（根据触发词）
manager.autoActivate('请帮我翻译这段代码');
// → ['translator']

// 构建增强上下文
const ctx = manager.buildContext('你是 TinyAgent');
// ctx.systemPrompt     → 拼接了活跃技能 instructions 的 prompt
// ctx.allowedTools      → 合并后的工具白名单（null = 不限制）
// ctx.skillTools        → 技能自带的工具实例
// ctx.caps              → 合并后的参数约束
```

### 上下文构建流程

```
baseSystemPrompt
    ↓
拼接活跃技能的 instructions（渲染模板变量后）
    ↓
<skill name="code-review">
  你是 Python 代码审查助手...
</skill>
<skill name="translator">
  你是多语言翻译助手...
</skill>
    ↓
收集工具白名单（并集，去重）
    ↓
收集技能自带工具
    ↓
合并 Caps（maxTokens 取最大值，其余后激活覆盖前面）
```

### Caps 合并策略

当多个技能同时激活时：

| 参数 | 合并策略 | 原因 |
|------|---------|------|
| maxTokens | 取最大值 | 确保最长的输出需求被满足 |
| temperature | 后激活覆盖 | 最近激活的技能代表当前意图 |
| preferredModel | 后激活覆盖 | 最近激活的技能指定的模型优先 |
| providerOverride | 后激活覆盖 | 最近指定的 Provider 覆盖 |

## 13.7 SkillfulAgent -- 技能感知 Agent

SkillfulAgent 是面向用户的最终接口，在标准 Agent 基础上增加技能感知：

```typescript
const agent = new SkillfulAgent({
  provider,
  model: 'gpt-3.5-turbo',
  systemPrompt: '你是 TinyAgent 助手',
  tools: baseTools,
  skillRegistry: registry,
  autoRoute: true,        // 开启自动路由
  maxActiveSkills: 3,
});

// 自动路由：输入包含 "审查" → 自动激活 code-review 技能
const result = await agent.run('请帮我审查这段代码');
// 内部发生了：
// 1. autoActivate('请帮我审查这段代码') → 激活 code-review
// 2. buildContext() → 增强 system prompt，过滤工具
// 3. new Agent(enhancedOptions).run(input) → 执行

// 手动激活 + 运行时变量
agent.activateSkill('code-review', { language: 'Python' });
```

### 运行时流程

```
用户输入: "请帮我审查这段代码"
    ↓
1. 自动路由 → autoActivate() → 匹配 "审查" → 激活 code-review
    ↓
2. buildContext() → {
     systemPrompt: 增强后的 prompt,
     allowedTools: ['read_file', 'search'],
     skillTools: [],
     caps: { maxTokens: 4096, temperature: 0.1 }
   }
    ↓
3. 构建增强工具注册中心 → 只保留白名单工具 + 技能自带工具
    ↓
4. 应用 Caps → temperature=0.1, maxTokens=4096
    ↓
5. 创建内部 Agent → agent.run(input)
    ↓
6. 返回结果（安全降级：任何环节失败都 fallback 到基础 Agent）
```

## 13.8 SkillLoader -- 文件系统加载

### 格式一：SKILL.md + Frontmatter

最简单的格式，一个文件搞定：

```markdown
---
name: code-review
description: 自动代码审查
version: 1.0.0
tags: [code, review]
triggers: [review, 审查, code review]
allowed-tools: [read_file, search]
caps:
  maxTokens: 4096
  temperature: 0.1
variables:
  language: TypeScript
---
你是代码审查助手，专注 ${language} 代码质量分析。

请从以下维度审查代码：
1. 安全性
2. Bug 风险
3. 代码风格
4. 性能
```

### 格式二：目录格式

更适合复杂技能：

```
skills/
└─ code-review/
   ├─ manifest.json   # 元数据（优先级高于 SKILL.md frontmatter）
   ├─ SKILL.md        # 指令正文
   └─ resources/      # 扩展资源
      ├─ checklist.md
      └─ template.md
```

### 批量加载

```typescript
const loader = new SkillLoader();

// 加载单个文件
const skill = await loader.loadFromFile('skills/code-review.md');

// 加载目录
const skill2 = await loader.loadFromDirectory('skills/code-review/');

// 批量扫描
const allSkills = await loader.loadAllFromDirectory('skills/');
```

### Frontmatter 解析

我们实现了一个纯 TypeScript 的简易 YAML 解析器，不依赖第三方库：

```typescript
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(fmRegex);
  // ...解析 key: value 和 key: [array] 格式
}
```

支持的格式：
- `key: value`（字符串/数字/布尔）
- `key: [a, b, c]`（数组）
- 两空格缩进的嵌套对象

## 13.9 两种实现对比

### 代码级定义（Presets 风格）

```typescript
const skill = defineSkill({
  metadata: { name: 'code-review', description: '代码审查' },
  instructions: '你是代码审查助手',
  allowedTools: ['read_file'],
  caps: { temperature: 0.1 },
});
```

**优点**: 类型安全、IDE 提示、tools 可直接传入函数引用
**适用**: 框架内置技能、需要绑定工具逻辑的技能

### 文件级定义（Agent Skills 风格）

```markdown
---
name: code-review
description: 代码审查
---
你是代码审查助手...
```

**优点**: 非开发者可编辑、热重载、可分发
**适用**: 用户自定义技能、第三方技能市场

### 对比总结

| 维度 | 代码级 Presets | 文件级 Agent Skills |
|------|--------------|-------------------|
| 类型安全 | 编译期检查 | 运行时校验 |
| 编辑门槛 | 需要 TypeScript | 只需 Markdown |
| 工具绑定 | 可直接传 Tool[] | 只能声明名称白名单 |
| 分发方式 | npm 包 | 文件复制 / Git |
| 热重载 | 需重启 | 可运行时重新加载 |
| IDE 支持 | 完整类型提示 | 无 |

## 13.10 Tools vs MCP vs Skills 的统一视角

三者经常被混淆，这里做一个清晰的区分：

| 维度 | Tool | MCP Server | Skill |
|------|------|-----------|-------|
| **粒度** | 单个函数 | 一组工具 + 资源 | Prompt + 工具 + 约束 |
| **关注点** | "做什么" | "怎么连接" | "怎么思考" |
| **类比** | 螺丝刀 | 工具箱 | 工作手册 |
| **影响** | 增加能力 | 增加数据源 | 改变行为模式 |

- **Tool**: `read_file(path) → content`，一个原子操作
- **MCP Server**: 提供一组 Tool + Resource，通过标准协议连接（如 GitHub MCP Server 提供 create_issue, list_repos 等）
- **Skill**: 不只是工具，还包含**如何使用工具的指令**。代码审查 Skill = 审查方法论 + read_file + search 的组合

## 13.11 常见的坑

### 坑 1：技能冲突

多个技能同时激活，instructions 可能互相矛盾：

```
Skill A: "你必须用简洁的语言回答"
Skill B: "你必须给出详细的解释"
```

**解决方案**: 
- 设置 `maxActiveSkills` 限制同时激活数量
- 后激活的技能 instructions 排在后面（LLM 倾向于遵循后出现的指令）

### 坑 2：工具白名单太严格

技能 A 只允许 `[read_file]`，但 Agent 需要 `search` 才能完成任务。

**解决方案**:
- 多技能白名单取并集
- 无 `allowedTools` 的技能不限制工具

### 坑 3：Prompt 膨胀

激活 5 个技能，每个 2k tokens 的 instructions，光技能指令就 10k tokens。

**解决方案**:
- 渐进式披露：只加载匹配的技能
- 设置 `maxActiveSkills`
- instructions 尽量简洁（< 1k tokens 是最佳实践）

### 坑 4：Caps 覆盖出乎意料

技能 A 设置 temperature=0.1，技能 B 设置 temperature=0.8，最终用了 0.8。

**解决方案**:
- 明确 Caps 合并策略（本框架：后激活覆盖）
- 手动激活时注意顺序

### 坑 5：文件格式解析错误

YAML frontmatter 格式不规范导致解析失败。

**解决方案**:
- 使用简易解析器，只支持常用格式
- 解析失败时 graceful degradation（将全文作为 instructions）

## 13.12 测试策略

本章共 66 个测试，覆盖 5 个文件：

| 测试文件 | 测试数 | 覆盖内容 |
|---------|-------|---------|
| skill.test.ts | 9 | defineSkill 验证、renderInstructions 模板渲染 |
| skill-registry.test.ts | 15 | 注册/注销、标签搜索、触发词匹配、模糊搜索 |
| skill-manager.test.ts | 21 | 激活/停用、自动激活、上下文构建、Caps 合并 |
| skill-loader.test.ts | 13 | frontmatter 解析、文件加载、目录加载、批量扫描 |
| skillful-agent.test.ts | 8 | 自动路由、工具白名单过滤、Caps 应用、安全降级 |

### 关键测试场景

1. **Prompt 模板渲染**: 运行时变量覆盖、未定义变量回退空字符串
2. **触发词匹配**: 大小写不敏感、多技能同时匹配
3. **Caps 合并**: maxTokens 取最大值、temperature 后覆盖、preferredModel 覆盖
4. **工具白名单**: 多技能白名单并集、无限制技能不影响
5. **安全降级**: autoRoute 失败不阻塞主流程
6. **文件系统**: SKILL.md 加载、目录加载、manifest.json 优先级

## 13.13 运行和验证

```bash
# 运行技能系统测试
npx vitest run src/skills/__tests__/

# 运行示例
npx tsx examples/13-skills.ts

# 全量回归
npx vitest run --exclude='**/integration*'
```

## 13.14 小结

本章实现了一个完整的技能系统，核心思想：

1. **Skill = Prompt + Tools + Caps 的打包** —— 而非仅仅是工具集合
2. **渐进式披露** —— 三层加载（元数据 → 指令 → 资源），避免 Prompt 膨胀
3. **Caps 参数约束** —— 不同技能可以指定不同的 temperature / maxTokens / model
4. **Prompt 模板渲染** —— `${variable}` 占位符，支持运行时动态覆盖
5. **两种定义格式** —— 代码级 defineSkill（类型安全）+ 文件级 SKILL.md（易编辑）
6. **安全降级** —— 技能加载/路由失败不阻塞主流程

### 文件清单

```
src/skills/
├── skill.ts              # Skill 接口 + 类型 + defineSkill + renderInstructions
├── skill-registry.ts     # SkillRegistry（注册/发现）
├── skill-manager.ts      # SkillManager（运行时激活/停用/上下文构建）
├── skillful-agent.ts     # SkillfulAgent（技能感知 Agent）
├── skill-loader.ts       # SkillLoader（文件系统加载 + frontmatter 解析）
├── index.ts              # 模块导出
└── __tests__/
    ├── skill.test.ts
    ├── skill-registry.test.ts
    ├── skill-manager.test.ts
    ├── skill-loader.test.ts
    └── skillful-agent.test.ts

examples/
├── 13-skills.ts          # 示例代码
└── skills/               # 示例技能目录
    ├── code-review/      # 目录格式示例
    │   ├── manifest.json
    │   ├── SKILL.md
    │   └── resources/
    │       └── checklist.md
    └── translator/       # SKILL.md + frontmatter 格式示例
        └── SKILL.md
```

### 与工业级方案的对比

| 特性 | TinyAgent Skills | Shannon Presets | Anthropic Agent Skills |
|------|-----------------|----------------|----------------------|
| Prompt 注入 | `<skill>` 标签包裹 | system_prompt 直接替换 | SKILL.md 正文注入 |
| 工具约束 | allowedTools 白名单 | allowed_tools 白名单 | allowed-tools 白名单 |
| 参数约束 | caps 对象 | caps 对象 | 无（由框架决定） |
| 模板变量 | `${variable}` | `${variable}` | `$ARGUMENTS` |
| 加载方式 | 代码 + 文件 | 代码级 | 文件级 |
| 渐进式披露 | 3 层 | 无（全量加载） | 2 层 |
