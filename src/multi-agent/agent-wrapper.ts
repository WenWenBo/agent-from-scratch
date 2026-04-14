/**
 * AgentWrapper -- 将现有的 Agent/StreamingAgent 包装为 BaseAgent
 *
 * 桥接 Chapter 03/06 的 Agent 和 Multi-Agent 系统，
 * 让已有的单 Agent 无需修改即可加入协作。
 */

import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from './base-agent.js';
import { Agent } from '../agent.js';
import type { AgentOptions } from '../agent.js';

export interface AgentWrapperOptions extends AgentOptions {
  /** Agent 名称（在 Multi-Agent 系统中的标识） */
  name: string;
  /** 能力描述（Orchestrator 用来做路由决策） */
  description: string;
}

export class AgentWrapper implements BaseAgent {
  readonly name: string;
  readonly description: string;
  private agent: Agent;

  constructor(options: AgentWrapperOptions) {
    this.name = options.name;
    this.description = options.description;
    this.agent = new Agent(options);
  }

  async execute(
    input: TaskInput,
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<TaskOutput> {
    const startTime = Date.now();

    onEvent?.({
      type: 'task_assigned',
      agentName: this.name,
      input: input.content,
    });

    try {
      const result = await this.agent.run(input.content);

      const durationMs = Date.now() - startTime;
      onEvent?.({
        type: 'task_completed',
        agentName: this.name,
        output: result.content,
        durationMs,
      });

      return {
        content: result.content,
        agentName: this.name,
        result,
        metadata: input.metadata,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onEvent?.({
        type: 'task_failed',
        agentName: this.name,
        error: errorMsg,
      });
      throw err;
    }
  }
}
