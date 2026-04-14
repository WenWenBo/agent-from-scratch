/**
 * BaseAgent -- Multi-Agent 系统中所有 Agent 的统一接口
 *
 * 关键设计：无论是单个 Agent、Pipeline 还是 Orchestrator，
 * 都实现同一个接口，让它们可以像积木一样嵌套组合。
 */

import type { AgentResult } from '../agent.js';

/**
 * 任务输入 -- 从上游传递给下游的信息载体
 */
export interface TaskInput {
  /** 用户原始问题或上游 Agent 传递的文本 */
  content: string;

  /** 上游 Agent 附加的结构化数据 */
  metadata?: Record<string, unknown>;

  /** 对话历史（可选，用于需要上下文的场景） */
  history?: Array<{ role: string; content: string }>;
}

/**
 * 任务输出 -- Agent 完成任务后的返回
 */
export interface TaskOutput {
  /** 输出内容 */
  content: string;

  /** 产出该结果的 Agent 名称 */
  agentName: string;

  /** 底层 AgentResult（如果有的话） */
  result?: AgentResult;

  /** 附加的结构化数据（向下游传递） */
  metadata?: Record<string, unknown>;
}

/**
 * Multi-Agent 事件 -- 用于观测协作过程
 */
export type MultiAgentEvent =
  | { type: 'task_assigned'; agentName: string; input: string }
  | { type: 'task_completed'; agentName: string; output: string; durationMs: number }
  | { type: 'task_failed'; agentName: string; error: string }
  | { type: 'orchestrator_thinking'; content: string }
  | { type: 'pipeline_step'; step: number; agentName: string }
  | { type: 'parallel_start'; agents: string[] }
  | { type: 'parallel_done'; results: Array<{ agentName: string; success: boolean }> };

/**
 * BaseAgent -- 所有可执行单元的统一接口
 */
export interface BaseAgent {
  /** Agent 的唯一名称 */
  readonly name: string;

  /** Agent 的能力描述（用于 Orchestrator 做路由决策） */
  readonly description: string;

  /** 执行任务 */
  execute(
    input: TaskInput,
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<TaskOutput>;
}
