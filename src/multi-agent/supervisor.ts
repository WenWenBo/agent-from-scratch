/**
 * Supervisor -- 带质量检查循环的协调者
 *
 * 与 Orchestrator 的区别：Supervisor 有 **反馈循环**。
 * 它会检查子 Agent 的结果质量，不满意就要求修改或重新分配。
 *
 * 流程：
 * 1. LLM 选择子 Agent 并派发任务
 * 2. 子 Agent 执行任务并返回结果
 * 3. LLM 审查结果质量
 *    - 通过 → 返回最终结果
 *    - 不通过 → 携带反馈重新派发（可以给同一个或另一个 Agent）
 * 4. 重复直到通过或达到最大轮数
 *
 * 适用场景：开放性任务、需要迭代优化的场景
 * 例如："写一份完整的市场调研报告" "重构这段代码直到所有测试通过"
 */

import type { LLMProvider } from '../providers/base.js';
import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from './base-agent.js';

// ============================================================
// 配置
// ============================================================

export interface SupervisorOptions {
  name: string;
  description: string;

  /** 用于路由决策和质量审查的 LLM */
  provider: LLMProvider;
  model: string;

  /** 可调度的子 Agent 列表 */
  agents: BaseAgent[];

  /** 最大审查轮数，默认 3 */
  maxRounds?: number;
}

// ============================================================
// LLM 决策结构
// ============================================================

interface AssignmentDecision {
  agentName: string;
  taskDescription: string;
}

interface ReviewDecision {
  verdict: 'approve' | 'revise' | 'reassign';
  feedback: string;
  /** revise 时沿用当前 Agent，reassign 时指定新 Agent */
  nextAgent?: string;
}

// ============================================================
// Supervisor 实现
// ============================================================

export class Supervisor implements BaseAgent {
  readonly name: string;
  readonly description: string;
  private provider: LLMProvider;
  private model: string;
  private agents: Map<string, BaseAgent>;
  private agentList: BaseAgent[];
  private maxRounds: number;

  constructor(options: SupervisorOptions) {
    this.name = options.name;
    this.description = options.description;
    this.provider = options.provider;
    this.model = options.model;
    this.maxRounds = options.maxRounds ?? 3;

    this.agents = new Map();
    this.agentList = options.agents;
    for (const agent of options.agents) {
      this.agents.set(agent.name, agent);
    }

    if (this.agentList.length === 0) {
      throw new Error('Supervisor requires at least one agent');
    }
  }

  async execute(
    input: TaskInput,
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<TaskOutput> {
    // 第一轮：LLM 决定分配给谁
    let assignment = await this.assign(input.content);
    let currentAgentName = assignment.agentName;
    let currentTask = assignment.taskDescription || input.content;
    let lastOutput: TaskOutput | undefined;

    for (let round = 1; round <= this.maxRounds; round++) {
      // --- 执行 ---
      const agent = this.agents.get(currentAgentName) ?? this.agentList[0]!;

      onEvent?.({
        type: 'task_assigned',
        agentName: agent.name,
        input: currentTask,
      });

      const startTime = Date.now();

      try {
        lastOutput = await agent.execute(
          { content: currentTask, metadata: { ...input.metadata, supervisorRound: round } },
          onEvent,
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        onEvent?.({ type: 'task_failed', agentName: agent.name, error: errorMsg });
        // 失败视为需要修改
        lastOutput = { content: `Error: ${errorMsg}`, agentName: agent.name };
      }

      onEvent?.({
        type: 'task_completed',
        agentName: agent.name,
        output: lastOutput.content.slice(0, 200),
        durationMs: Date.now() - startTime,
      });

      // --- 审查 ---
      const review = await this.review(input.content, lastOutput, round);

      onEvent?.({
        type: 'supervisor_review',
        round,
        verdict: review.verdict,
        feedback: review.feedback,
      });

      if (review.verdict === 'approve') {
        onEvent?.({
          type: 'supervisor_done',
          totalRounds: round,
          finalAgent: agent.name,
        });

        return {
          content: lastOutput.content,
          agentName: agent.name,
          result: lastOutput.result,
          metadata: {
            ...lastOutput.metadata,
            supervisedBy: this.name,
            totalRounds: round,
            approved: true,
          },
        };
      }

      // --- 不通过，准备下一轮 ---
      if (review.verdict === 'reassign' && review.nextAgent) {
        currentAgentName = review.nextAgent;
      }
      // revise 保持当前 Agent 不变

      // 将反馈注入下一轮的任务描述
      currentTask = this.buildRevisionPrompt(input.content, lastOutput.content, review.feedback);
    }

    // 达到最大轮数，返回最后一次的结果
    onEvent?.({
      type: 'supervisor_done',
      totalRounds: this.maxRounds,
      finalAgent: lastOutput?.agentName ?? this.name,
    });

    return {
      content: lastOutput?.content ?? '',
      agentName: lastOutput?.agentName ?? this.name,
      result: lastOutput?.result,
      metadata: {
        ...lastOutput?.metadata,
        supervisedBy: this.name,
        totalRounds: this.maxRounds,
        approved: false,
        maxRoundsReached: true,
      },
    };
  }

  // ============================================================
  // 任务分配（第一轮）
  // ============================================================

  private async assign(userInput: string): Promise<AssignmentDecision> {
    const agentDescriptions = this.agentList
      .map((a) => `- "${a.name}": ${a.description}`)
      .join('\n');

    const prompt = `You are a task supervisor. Assign this task to the most suitable agent.

Available agents:
${agentDescriptions}

User task: "${userInput}"

Respond in JSON only:
{"agentName": "<name>", "taskDescription": "<refined task description for the agent>"}`;

    try {
      const response = await this.provider.chat({
        model: this.model,
        messages: [
          { role: 'system', content: 'Output valid JSON only. No markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      });
      return this.parseJSON<AssignmentDecision>(
        response.content ?? '',
        { agentName: this.agentList[0]!.name, taskDescription: userInput },
      );
    } catch {
      return { agentName: this.agentList[0]!.name, taskDescription: userInput };
    }
  }

  // ============================================================
  // 质量审查
  // ============================================================

  private async review(
    originalTask: string,
    output: TaskOutput,
    round: number
  ): Promise<ReviewDecision> {
    const agentDescriptions = this.agentList
      .map((a) => `- "${a.name}": ${a.description}`)
      .join('\n');

    const prompt = `You are a quality reviewer (round ${round}). Evaluate if this output adequately addresses the original task.

Original task: "${originalTask}"

Output from "${output.agentName}":
${output.content.slice(0, 2000)}

Available agents for reassignment:
${agentDescriptions}

Respond in JSON only:
{
  "verdict": "approve" | "revise" | "reassign",
  "feedback": "<specific feedback on what needs improvement>",
  "nextAgent": "<agent name, only if verdict is reassign>"
}

- "approve": output is good enough
- "revise": same agent should improve based on feedback
- "reassign": a different agent should handle this`;

    try {
      const response = await this.provider.chat({
        model: this.model,
        messages: [
          { role: 'system', content: 'Output valid JSON only. No markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      });
      return this.parseJSON<ReviewDecision>(
        response.content ?? '',
        { verdict: 'approve', feedback: 'Auto-approved (parse failure)' },
      );
    } catch {
      // LLM 失败时默认通过（避免无限循环）
      return { verdict: 'approve', feedback: 'Auto-approved (LLM unavailable)' };
    }
  }

  // ============================================================
  // 工具方法
  // ============================================================

  private buildRevisionPrompt(
    originalTask: string,
    previousOutput: string,
    feedback: string
  ): string {
    return `Original task: ${originalTask}

Your previous output:
${previousOutput}

Supervisor feedback — please address these issues:
${feedback}

Please provide an improved version.`;
  }

  private parseJSON<T>(text: string, fallback: T): T {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback;
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      return fallback;
    }
  }
}
