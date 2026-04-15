/**
 * Skill 接口与类型定义
 *
 * 技能系统 = System Prompt + 工具白名单 + 参数约束的打包
 *
 * 核心设计理念——渐进式披露（Progressive Disclosure）：
 * 1. 元数据层：启动时只加载 name + description（~30-50 tokens）
 * 2. 内容层：匹配时才加载完整 instructions（< 5k tokens）
 * 3. 扩展层：引用的 resources 只在实际需要时加载
 *
 * 参考:
 * - Agent Skills 规范: https://agentskills.io/
 * - Anthropic Skills: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
 * - Semantic Kernel Plugins: https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/
 */

import type { Tool } from '../tools/tool.js';

// ============================================================
// 参数约束（Caps）
// ============================================================

export interface SkillCaps {
  /** 最大 Token 数 */
  maxTokens?: number;
  /** Temperature 控制 */
  temperature?: number;
  /** 强制使用的 Provider（如 openai / anthropic） */
  providerOverride?: string;
  /** 首选模型 */
  preferredModel?: string;
}

// ============================================================
// 技能元数据（发现层 —— 轻量，启动时加载）
// ============================================================

export interface SkillMetadata {
  /** 技能名称（唯一标识，小写字母+连字符） */
  name: string;
  /** 技能描述（Agent 用此判断何时自动加载） */
  description: string;
  /** 版本号 */
  version?: string;
  /** 标签，用于分类和搜索 */
  tags?: string[];
  /** 触发关键词（用户输入包含这些词时自动激活） */
  triggers?: string[];
  /** 作者 */
  author?: string;
}

// ============================================================
// 技能资源
// ============================================================

export interface SkillResource {
  /** 资源名称 */
  name: string;
  /** 资源类型 */
  type: 'template' | 'reference' | 'example' | 'script';
  /** 内容（延迟加载，初始可为空） */
  content?: string;
  /** 文件路径（用于延迟加载） */
  filePath?: string;
}

// ============================================================
// 完整 Skill 定义
// ============================================================

export interface Skill {
  /** 元数据（轻量，始终加载） */
  metadata: SkillMetadata;

  /** 工作流指令（内容层，按需加载）—— 注入 system prompt */
  instructions: string;

  /** 工具白名单（该技能可用的工具名称列表） */
  allowedTools?: string[];

  /** 绑定的工具实例（技能自带的专属工具） */
  tools?: Tool[];

  /** 参数约束 */
  caps?: SkillCaps;

  /**
   * Prompt 模板变量
   * instructions 中的 ${variable} 会在激活时被替换
   */
  promptVariables?: Record<string, string>;

  /** 扩展资源（延迟加载） */
  resources?: SkillResource[];
}

// ============================================================
// 技能定义辅助函数
// ============================================================

export function defineSkill(config: Skill): Skill {
  if (!config.metadata.name || !config.metadata.description) {
    throw new Error('Skill must have a name and description');
  }
  return config;
}

// ============================================================
// Prompt 模板渲染
// ============================================================

/**
 * 将 instructions 中的 ${variable} 替换为实际值
 *
 * 支持两层来源：
 * 1. Skill 自身的 promptVariables
 * 2. 运行时传入的 runtimeVariables（优先级更高）
 */
export function renderInstructions(
  instructions: string,
  promptVariables?: Record<string, string>,
  runtimeVariables?: Record<string, string>,
): string {
  const merged = { ...promptVariables, ...runtimeVariables };

  return instructions.replace(/\$\{(\w+)\}/g, (_, varName: string) => {
    return merged[varName] ?? '';
  });
}
