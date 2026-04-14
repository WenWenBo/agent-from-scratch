/**
 * Orchestrator -- 智能协调者
 *
 * 使用 LLM 来决定将任务派给哪个子 Agent（或自己直接回答）。
 * 这是 Multi-Agent 系统的核心：LLM 作为路由器。
 *
 * 流程：
 * 1. 收到用户输入
 * 2. LLM 根据子 Agent 的描述决定路由
 * 3. 调用选定的子 Agent
 * 4. 返回结果（可选：用 LLM 润色最终输出）
 */

import type { LLMProvider } from '../providers/base.js';
import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from './base-agent.js';

export interface OrchestratorOptions {
  name: string;
  description: string;

  /** 用于路由决策的 LLM */
  provider: LLMProvider;
  model: string;

  /** 可调度的子 Agent 列表 */
  agents: BaseAgent[];

  /** 是否用 LLM 对最终结果做润色，默认 false */
  refineOutput?: boolean;

  /** 最大路由轮数（防止死循环），默认 3 */
  maxRounds?: number;
}

/**
 * LLM 做出的路由决策
 */
interface RoutingDecision {
  agentName: string;
  reason: string;
  refinedInput?: string;
}

export class Orchestrator implements BaseAgent {
  readonly name: string;
  readonly description: string;
  private provider: LLMProvider;
  private model: string;
  private agents: Map<string, BaseAgent>;
  private agentList: BaseAgent[];
  private refineOutput: boolean;
  private maxRounds: number;

  constructor(options: OrchestratorOptions) {
    this.name = options.name;
    this.description = options.description;
    this.provider = options.provider;
    this.model = options.model;
    this.refineOutput = options.refineOutput ?? false;
    this.maxRounds = options.maxRounds ?? 3;

    this.agents = new Map();
    this.agentList = options.agents;
    for (const agent of options.agents) {
      this.agents.set(agent.name, agent);
    }
  }

  async execute(
    input: TaskInput,
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<TaskOutput> {
    // 1. LLM 路由决策
    const decision = await this.route(input.content);

    onEvent?.({
      type: 'orchestrator_thinking',
      content: `Routing to "${decision.agentName}": ${decision.reason}`,
    });

    // 2. 找到目标 Agent
    const targetAgent = this.agents.get(decision.agentName);
    if (!targetAgent) {
      // LLM 选了不存在的 Agent，自己兜底
      return this.fallbackAnswer(input, decision, onEvent);
    }

    // 3. 调用子 Agent
    const agentInput: TaskInput = {
      content: decision.refinedInput ?? input.content,
      metadata: {
        ...input.metadata,
        routedBy: this.name,
        routingReason: decision.reason,
      },
    };

    const output = await targetAgent.execute(agentInput, onEvent);

    // 4. 可选：润色最终结果
    if (this.refineOutput) {
      const refined = await this.refine(input.content, output);
      return {
        ...output,
        content: refined,
        agentName: this.name,
        metadata: { ...output.metadata, refinedBy: this.name },
      };
    }

    return {
      ...output,
      metadata: { ...output.metadata, routedBy: this.name },
    };
  }

  // ============================================================
  // 路由决策
  // ============================================================

  private async route(userInput: string): Promise<RoutingDecision> {
    const agentDescriptions = this.agentList
      .map((a) => `- "${a.name}": ${a.description}`)
      .join('\n');

    const prompt = `You are a task router. Based on the user's request, decide which agent should handle it.

Available agents:
${agentDescriptions}
- "SELF": Answer directly if no agent is suitable.

User request: "${userInput}"

Respond in this exact JSON format (no markdown, no extra text):
{"agentName": "<agent name or SELF>", "reason": "<one sentence explanation>", "refinedInput": "<optional refined version of the input for the chosen agent>"}`;

    try {
      const response = await this.provider.chat({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a JSON-only router. Output valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      });

      const text = response.content ?? '';
      return this.parseRoutingResponse(text);
    } catch {
      // LLM 失败时默认选第一个 Agent
      return {
        agentName: this.agentList[0]?.name ?? 'SELF',
        reason: 'LLM routing failed, using default',
      };
    }
  }

  private parseRoutingResponse(text: string): RoutingDecision {
    try {
      // 尝试从可能包含 markdown 的文本中提取 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;

      return {
        agentName: parsed.agentName ?? 'SELF',
        reason: parsed.reason ?? 'No reason provided',
        refinedInput: parsed.refinedInput,
      };
    } catch {
      return {
        agentName: this.agentList[0]?.name ?? 'SELF',
        reason: `Failed to parse routing response: ${text.slice(0, 100)}`,
      };
    }
  }

  // ============================================================
  // 兜底回答
  // ============================================================

  private async fallbackAnswer(
    input: TaskInput,
    decision: RoutingDecision,
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<TaskOutput> {
    onEvent?.({
      type: 'orchestrator_thinking',
      content: `No matching agent "${decision.agentName}", answering directly.`,
    });

    try {
      const response = await this.provider.chat({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Answer the user\'s question directly.' },
          { role: 'user', content: input.content },
        ],
      });

      return {
        content: response.content ?? '',
        agentName: this.name,
        metadata: { fallback: true },
      };
    } catch (err) {
      return {
        content: `I'm sorry, I couldn't process your request. Error: ${err instanceof Error ? err.message : String(err)}`,
        agentName: this.name,
        metadata: { fallback: true, error: true },
      };
    }
  }

  // ============================================================
  // 结果润色
  // ============================================================

  private async refine(originalInput: string, output: TaskOutput): Promise<string> {
    try {
      const response = await this.provider.chat({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You refine and improve responses. Keep the factual content unchanged but improve clarity, formatting, and tone. Respond in the same language as the input.',
          },
          {
            role: 'user',
            content: `Original question: ${originalInput}\n\nResponse from "${output.agentName}":\n${output.content}\n\nPlease refine this response.`,
          },
        ],
      });
      return response.content ?? output.content;
    } catch {
      return output.content;
    }
  }
}
