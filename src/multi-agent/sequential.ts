/**
 * SequentialPipeline -- 串行流水线
 *
 * 多个 Agent 按顺序执行，前一个的输出作为后一个的输入。
 * 典型场景：研究 → 撰写 → 审校 → 发布
 *
 * A → B → C → 最终结果
 */

import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from './base-agent.js';

export interface SequentialPipelineOptions {
  name: string;
  description: string;
  agents: BaseAgent[];
}

export class SequentialPipeline implements BaseAgent {
  readonly name: string;
  readonly description: string;
  private agents: BaseAgent[];

  constructor(options: SequentialPipelineOptions) {
    this.name = options.name;
    this.description = options.description;
    this.agents = options.agents;

    if (this.agents.length === 0) {
      throw new Error('SequentialPipeline requires at least one agent');
    }
  }

  async execute(
    input: TaskInput,
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<TaskOutput> {
    let current: TaskInput = { ...input };
    let lastOutput: TaskOutput | undefined;

    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i]!;

      onEvent?.({
        type: 'pipeline_step',
        step: i + 1,
        agentName: agent.name,
      });

      lastOutput = await agent.execute(current, onEvent);

      // 前一个的输出作为后一个的输入
      current = {
        content: lastOutput.content,
        metadata: {
          ...current.metadata,
          ...lastOutput.metadata,
          previousAgent: agent.name,
          pipelineStep: i + 1,
        },
      };
    }

    return {
      content: lastOutput!.content,
      agentName: this.name,
      result: lastOutput!.result,
      metadata: {
        ...lastOutput!.metadata,
        pipelineSteps: this.agents.map((a) => a.name),
      },
    };
  }
}
