/**
 * SkillManager -- 运行时技能管理器
 *
 * 职责：
 * 1. 激活/停用技能（动态切换 Agent 的能力）
 * 2. 构建增强后的 System Prompt（拼接活跃技能的 instructions）
 * 3. 收集活跃技能的工具白名单和绑定工具
 * 4. 应用参数约束（caps：temperature / maxTokens / preferredModel）
 * 5. 渲染 Prompt 模板变量
 */

import type { Skill, SkillCaps } from './skill.js';
import { renderInstructions } from './skill.js';
import type { SkillRegistry } from './skill-registry.js';
import type { Tool } from '../tools/tool.js';

export interface SkillManagerOptions {
  registry: SkillRegistry;
  /** 最多同时激活几个技能，默认 5 */
  maxActiveSkills?: number;
}

export interface SkillContext {
  /** 增强后的 System Prompt */
  systemPrompt: string;
  /** 当前活跃技能允许的工具名称列表（null = 不限制） */
  allowedTools: string[] | null;
  /** 技能自带的工具实例 */
  skillTools: Tool[];
  /** 合并后的参数约束 */
  caps: SkillCaps;
}

export class SkillManager {
  private registry: SkillRegistry;
  private activeSkills = new Map<string, Skill>();
  private maxActiveSkills: number;
  private runtimeVariables = new Map<string, Record<string, string>>();

  constructor(options: SkillManagerOptions) {
    this.registry = options.registry;
    this.maxActiveSkills = options.maxActiveSkills ?? 5;
  }

  // ============================================================
  // 激活 / 停用
  // ============================================================

  activate(skillName: string, variables?: Record<string, string>): void {
    if (this.activeSkills.has(skillName)) return;

    const skill = this.registry.get(skillName);
    if (!skill) {
      throw new Error(`Skill "${skillName}" not found in registry`);
    }

    if (this.activeSkills.size >= this.maxActiveSkills) {
      throw new Error(
        `Cannot activate "${skillName}": maximum active skills (${this.maxActiveSkills}) reached`,
      );
    }

    this.activeSkills.set(skillName, skill);
    if (variables) {
      this.runtimeVariables.set(skillName, variables);
    }
  }

  deactivate(skillName: string): boolean {
    this.runtimeVariables.delete(skillName);
    return this.activeSkills.delete(skillName);
  }

  deactivateAll(): void {
    this.activeSkills.clear();
    this.runtimeVariables.clear();
  }

  isActive(skillName: string): boolean {
    return this.activeSkills.has(skillName);
  }

  getActiveSkills(): Skill[] {
    return Array.from(this.activeSkills.values());
  }

  getActiveSkillNames(): string[] {
    return Array.from(this.activeSkills.keys());
  }

  // ============================================================
  // 自动激活：根据用户输入的触发词
  // ============================================================

  autoActivate(userInput: string): string[] {
    const matched = this.registry.findByTrigger(userInput);
    const activated: string[] = [];

    for (const skill of matched) {
      if (!this.activeSkills.has(skill.metadata.name)
        && this.activeSkills.size < this.maxActiveSkills) {
        this.activeSkills.set(skill.metadata.name, skill);
        activated.push(skill.metadata.name);
      }
    }
    return activated;
  }

  // ============================================================
  // 构建上下文
  // ============================================================

  /**
   * 构建增强后的上下文——拼接所有活跃技能的 instructions 到 system prompt
   *
   * @param baseSystemPrompt 原始的 system prompt
   * @returns SkillContext 增强后的上下文
   */
  buildContext(baseSystemPrompt: string): SkillContext {
    const activeList = this.getActiveSkills();

    // 1. 构建增强 system prompt
    let systemPrompt = baseSystemPrompt;

    if (activeList.length > 0) {
      const skillSections = activeList.map(skill => {
        const vars = this.runtimeVariables.get(skill.metadata.name);
        const rendered = renderInstructions(
          skill.instructions,
          skill.promptVariables,
          vars,
        );
        return `\n\n<skill name="${skill.metadata.name}">\n${rendered}\n</skill>`;
      });
      systemPrompt += skillSections.join('');
    }

    // 2. 收集工具白名单
    let allowedTools: string[] | null = null;
    const hasRestriction = activeList.some(s => s.allowedTools && s.allowedTools.length > 0);

    if (hasRestriction) {
      const toolSet = new Set<string>();
      for (const skill of activeList) {
        if (skill.allowedTools) {
          skill.allowedTools.forEach(t => toolSet.add(t));
        }
      }
      allowedTools = Array.from(toolSet);
    }

    // 3. 收集技能自带工具
    const skillTools: Tool[] = [];
    for (const skill of activeList) {
      if (skill.tools) {
        skillTools.push(...skill.tools);
      }
    }

    // 4. 合并 caps（后激活的覆盖先激活的）
    const caps = this.mergeCaps(activeList);

    return { systemPrompt, allowedTools, skillTools, caps };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 合并多个技能的 caps，策略：
   * - maxTokens: 取最大值
   * - temperature: 取最后一个设定的值
   * - providerOverride / preferredModel: 最后一个设定的覆盖前面
   */
  private mergeCaps(skills: Skill[]): SkillCaps {
    const merged: SkillCaps = {};

    for (const skill of skills) {
      if (!skill.caps) continue;

      if (skill.caps.maxTokens !== undefined) {
        merged.maxTokens = Math.max(merged.maxTokens ?? 0, skill.caps.maxTokens);
      }
      if (skill.caps.temperature !== undefined) {
        merged.temperature = skill.caps.temperature;
      }
      if (skill.caps.providerOverride !== undefined) {
        merged.providerOverride = skill.caps.providerOverride;
      }
      if (skill.caps.preferredModel !== undefined) {
        merged.preferredModel = skill.caps.preferredModel;
      }
    }

    return merged;
  }
}
