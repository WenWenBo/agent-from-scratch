/**
 * ParallelFanOut -- 并行扇出
 *
 * 将同一个任务分发给多个 Agent 并行执行，然后用聚合策略合并结果。
 * 典型场景：多视角分析、投票机制、A/B 测试
 *
 *       ┌→ A →┐
 * Input →  B → Aggregator → Output
 *       └→ C →┘
 */

import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from './base-agent.js';

/**
 * 聚合策略：决定如何合并多个 Agent 的输出
 */
export type AggregationStrategy =
  | 'concatenate'      // 拼接所有结果
  | 'first_success'    // 取第一个成功的
  | 'longest'          // 取最长的
  | ((results: TaskOutput[]) => TaskOutput); // 自定义函数

export interface ParallelFanOutOptions {
  name: string;
  description: string;
  agents: BaseAgent[];
  strategy?: AggregationStrategy;
  /** 是否在某个 Agent 失败时继续执行其他的，默认 true */
  continueOnError?: boolean;
}

export class ParallelFanOut implements BaseAgent {
  readonly name: string;
  readonly description: string;
  private agents: BaseAgent[];
  private strategy: AggregationStrategy;
  private continueOnError: boolean;

  constructor(options: ParallelFanOutOptions) {
    this.name = options.name;
    this.description = options.description;
    this.agents = options.agents;
    this.strategy = options.strategy ?? 'concatenate';
    this.continueOnError = options.continueOnError ?? true;

    if (this.agents.length === 0) {
      throw new Error('ParallelFanOut requires at least one agent');
    }
  }

  async execute(
    input: TaskInput,
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<TaskOutput> {
    onEvent?.({
      type: 'parallel_start',
      agents: this.agents.map((a) => a.name),
    });

    // 并行执行所有 Agent
    const promises = this.agents.map(async (agent) => {
      try {
        const output = await agent.execute(input, onEvent);
        return { agent: agent.name, output, success: true as const };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        onEvent?.({
          type: 'task_failed',
          agentName: agent.name,
          error: errorMsg,
        });

        if (!this.continueOnError) throw err;
        return {
          agent: agent.name,
          output: null as TaskOutput | null,
          success: false as const,
          error: errorMsg,
        };
      }
    });

    const settled = await Promise.all(promises);

    onEvent?.({
      type: 'parallel_done',
      results: settled.map((s) => ({
        agentName: s.agent,
        success: s.success,
      })),
    });

    const successResults = settled
      .filter((s): s is typeof s & { success: true; output: TaskOutput } => s.success)
      .map((s) => s.output);

    if (successResults.length === 0) {
      throw new Error('All parallel agents failed');
    }

    // 聚合
    const aggregated = this.aggregate(successResults);

    return {
      ...aggregated,
      agentName: this.name,
      metadata: {
        ...aggregated.metadata,
        parallelAgents: this.agents.map((a) => a.name),
        successCount: successResults.length,
        totalCount: this.agents.length,
      },
    };
  }

  private aggregate(results: TaskOutput[]): TaskOutput {
    if (typeof this.strategy === 'function') {
      return this.strategy(results);
    }

    switch (this.strategy) {
      case 'first_success':
        return results[0]!;

      case 'longest':
        return results.reduce((longest, curr) =>
          curr.content.length > longest.content.length ? curr : longest
        );

      case 'concatenate':
      default: {
        const combined = results
          .map((r) => `[${r.agentName}]\n${r.content}`)
          .join('\n\n---\n\n');

        return {
          content: combined,
          agentName: results.map((r) => r.agentName).join('+'),
          metadata: { sources: results.map((r) => r.agentName) },
        };
      }
    }
  }
}
