/**
 * SkillfulAgent -- 技能感知 Agent
 *
 * 在标准 Agent 基础上增加：
 * 1. 自动路由：根据用户输入匹配触发词，按需激活技能
 * 2. System Prompt 增强：将活跃技能的 instructions 拼入
 * 3. 工具白名单过滤：只暴露技能允许的工具
 * 4. 参数约束应用：根据 caps 覆盖 temperature / maxTokens
 * 5. 安全降级：技能加载失败时回退到基础 Agent
 */

import { Agent } from '../agent.js';
import type { AgentOptions, AgentResult, AgentEvent } from '../agent.js';
import type { LLMProvider } from '../providers/base.js';
import { ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/tool.js';
import { SkillManager } from './skill-manager.js';
import { SkillRegistry } from './skill-registry.js';
import type { SkillCaps } from './skill.js';

export interface SkillfulAgentOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  tools?: ToolRegistry;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  /** 技能注册中心 */
  skillRegistry: SkillRegistry;
  /** 最多同时激活的技能数 */
  maxActiveSkills?: number;
  /** 是否开启自动路由（根据触发词自动激活），默认 true */
  autoRoute?: boolean;
}

export class SkillfulAgent {
  private provider: LLMProvider;
  private model: string;
  private baseSystemPrompt: string;
  private baseTools: ToolRegistry | undefined;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number | undefined;
  private autoRoute: boolean;

  readonly skillManager: SkillManager;

  constructor(options: SkillfulAgentOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.baseSystemPrompt = options.systemPrompt;
    this.baseTools = options.tools;
    this.maxSteps = options.maxSteps ?? 10;
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens;
    this.autoRoute = options.autoRoute ?? true;

    this.skillManager = new SkillManager({
      registry: options.skillRegistry,
      maxActiveSkills: options.maxActiveSkills,
    });
  }

  // ============================================================
  // 核心运行方法
  // ============================================================

  async run(
    input: string,
    onEvent?: (event: AgentEvent) => void,
  ): Promise<AgentResult> {
    // 1. 自动路由：根据用户输入激活技能
    if (this.autoRoute) {
      try {
        this.skillManager.autoActivate(input);
      } catch {
        // 安全降级：自动激活失败不阻塞主流程
      }
    }

    // 2. 构建增强上下文
    const context = this.skillManager.buildContext(this.baseSystemPrompt);

    // 3. 构建增强工具注册中心
    const enhancedTools = this.buildEnhancedTools(
      context.allowedTools,
      context.skillTools,
    );

    // 4. 应用 caps 约束
    const agentOptions = this.buildAgentOptions(context.caps, context.systemPrompt, enhancedTools);

    // 5. 创建内部 Agent 并运行
    const agent = new Agent(agentOptions);
    return agent.run(input, onEvent);
  }

  // ============================================================
  // 手动技能管理
  // ============================================================

  activateSkill(name: string, variables?: Record<string, string>): void {
    this.skillManager.activate(name, variables);
  }

  deactivateSkill(name: string): boolean {
    return this.skillManager.deactivate(name);
  }

  getActiveSkillNames(): string[] {
    return this.skillManager.getActiveSkillNames();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private buildEnhancedTools(
    allowedTools: string[] | null,
    skillTools: Tool[],
  ): ToolRegistry {
    const enhanced = new ToolRegistry();

    // 复制基础工具（应用白名单过滤）
    if (this.baseTools) {
      const baseList = this.baseTools.list();
      for (const tool of baseList) {
        if (allowedTools === null || allowedTools.includes(tool.name)) {
          enhanced.register(tool);
        }
      }
    }

    // 注册技能自带的工具
    for (const tool of skillTools) {
      if (!enhanced.has(tool.name)) {
        enhanced.register(tool);
      }
    }

    return enhanced;
  }

  private buildAgentOptions(
    caps: SkillCaps,
    systemPrompt: string,
    tools: ToolRegistry,
  ): AgentOptions {
    return {
      provider: this.provider,
      model: caps.preferredModel ?? this.model,
      systemPrompt,
      tools: tools.size > 0 ? tools : undefined,
      maxSteps: this.maxSteps,
      temperature: caps.temperature ?? this.temperature,
      maxTokens: caps.maxTokens ?? this.maxTokens,
    };
  }
}
