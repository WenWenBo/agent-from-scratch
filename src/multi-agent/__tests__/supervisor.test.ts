/**
 * Supervisor 单元测试
 * 测试分配 → 执行 → 审查 → 反馈循环
 */

import { describe, it, expect, vi } from 'vitest';
import { Supervisor } from '../supervisor.js';
import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from '../base-agent.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ChatResponse } from '../../types.js';

function fakeAgent(name: string, description: string, response: string | string[]): BaseAgent {
  const responses = Array.isArray(response) ? response : [response];
  let callIdx = 0;
  return {
    name,
    description,
    execute: vi.fn(async (input: TaskInput): Promise<TaskOutput> => ({
      content: responses[Math.min(callIdx++, responses.length - 1)]!,
      agentName: name,
    })),
  };
}

function buildMockProvider(responses: string[]): LLMProvider {
  let callIdx = 0;
  return {
    chat: vi.fn(async (): Promise<ChatResponse> => ({
      id: `call-${callIdx}`,
      content: responses[Math.min(callIdx++, responses.length - 1)]!,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      finishReason: 'stop',
    })),
    stream: vi.fn(),
  } as unknown as LLMProvider;
}

describe('Supervisor', () => {
  it('一轮通过：分配 → 执行 → 审批通过', async () => {
    const agent = fakeAgent('writer', 'Writes articles', 'Great article about AI');

    const provider = buildMockProvider([
      // 1st call: assign
      '{"agentName":"writer","taskDescription":"Write about AI"}',
      // 2nd call: review → approve
      '{"verdict":"approve","feedback":"Excellent work"}',
    ]);

    const supervisor = new Supervisor({
      name: 'boss',
      description: 'Quality supervisor',
      provider,
      model: 'test',
      agents: [agent],
    });

    const result = await supervisor.execute({ content: 'Write about AI' });

    expect(result.content).toBe('Great article about AI');
    expect(result.agentName).toBe('writer');
    expect(result.metadata?.supervisedBy).toBe('boss');
    expect(result.metadata?.totalRounds).toBe(1);
    expect(result.metadata?.approved).toBe(true);
    expect(agent.execute).toHaveBeenCalledTimes(1);
  });

  it('两轮修订：第一轮 revise → 第二轮通过', async () => {
    const agent = fakeAgent('writer', 'Writes articles', [
      'Draft version',
      'Improved version',
    ]);

    const provider = buildMockProvider([
      // 1: assign
      '{"agentName":"writer","taskDescription":"Write a report"}',
      // 2: review round 1 → revise
      '{"verdict":"revise","feedback":"Add more details and examples"}',
      // 3: review round 2 → approve
      '{"verdict":"approve","feedback":"Much better now"}',
    ]);

    const supervisor = new Supervisor({
      name: 'boss',
      description: 'test',
      provider,
      model: 'test',
      agents: [agent],
    });

    const result = await supervisor.execute({ content: 'Write a report' });

    expect(result.content).toBe('Improved version');
    expect(result.metadata?.totalRounds).toBe(2);
    expect(result.metadata?.approved).toBe(true);
    expect(agent.execute).toHaveBeenCalledTimes(2);

    // 验证第二轮的输入包含反馈信息
    const secondCallInput = (agent.execute as ReturnType<typeof vi.fn>).mock.calls[1]![0] as TaskInput;
    expect(secondCallInput.content).toContain('Add more details and examples');
    expect(secondCallInput.content).toContain('Supervisor feedback');
  });

  it('reassign：从 A 转给 B', async () => {
    const agentA = fakeAgent('junior', 'Junior writer', 'Weak output');
    const agentB = fakeAgent('senior', 'Senior writer', 'Polished output');

    const provider = buildMockProvider([
      // 1: assign → junior
      '{"agentName":"junior","taskDescription":"Write article"}',
      // 2: review → reassign to senior
      '{"verdict":"reassign","feedback":"Need expert quality","nextAgent":"senior"}',
      // 3: review round 2 → approve
      '{"verdict":"approve","feedback":"Great work"}',
    ]);

    const supervisor = new Supervisor({
      name: 'boss',
      description: 'test',
      provider,
      model: 'test',
      agents: [agentA, agentB],
    });

    const result = await supervisor.execute({ content: 'Write article' });

    expect(result.content).toBe('Polished output');
    expect(result.agentName).toBe('senior');
    expect(agentA.execute).toHaveBeenCalledTimes(1);
    expect(agentB.execute).toHaveBeenCalledTimes(1);
  });

  it('达到最大轮数时应停止并返回最后结果', async () => {
    const agent = fakeAgent('writer', 'Writes', [
      'Draft 1',
      'Draft 2',
    ]);

    const provider = buildMockProvider([
      // 1: assign
      '{"agentName":"writer","taskDescription":"Write"}',
      // 2: review round 1 → revise
      '{"verdict":"revise","feedback":"Not good enough"}',
      // 3: review round 2 → revise again
      '{"verdict":"revise","feedback":"Still not good"}',
    ]);

    const supervisor = new Supervisor({
      name: 'boss',
      description: 'test',
      provider,
      model: 'test',
      agents: [agent],
      maxRounds: 2,
    });

    const result = await supervisor.execute({ content: 'Write something' });

    expect(result.metadata?.approved).toBe(false);
    expect(result.metadata?.maxRoundsReached).toBe(true);
    expect(result.metadata?.totalRounds).toBe(2);
    expect(agent.execute).toHaveBeenCalledTimes(2);
  });

  it('应产出正确的事件序列', async () => {
    const agent = fakeAgent('worker', 'Works', ['v1', 'v2']);

    const provider = buildMockProvider([
      '{"agentName":"worker","taskDescription":"do work"}',
      '{"verdict":"revise","feedback":"improve it"}',
      '{"verdict":"approve","feedback":"good"}',
    ]);

    const supervisor = new Supervisor({
      name: 'boss',
      description: 'test',
      provider,
      model: 'test',
      agents: [agent],
    });

    const events: MultiAgentEvent[] = [];
    await supervisor.execute({ content: 'do work' }, (e) => events.push(e));

    // 两轮，每轮应有 task_assigned + task_completed + supervisor_review
    const assigned = events.filter((e) => e.type === 'task_assigned');
    const completed = events.filter((e) => e.type === 'task_completed');
    const reviews = events.filter((e) => e.type === 'supervisor_review');
    const done = events.filter((e) => e.type === 'supervisor_done');

    expect(assigned).toHaveLength(2);
    expect(completed).toHaveLength(2);
    expect(reviews).toHaveLength(2);
    expect(done).toHaveLength(1);

    // 验证审查事件内容
    expect(reviews[0]).toMatchObject({
      type: 'supervisor_review',
      round: 1,
      verdict: 'revise',
      feedback: 'improve it',
    });
    expect(reviews[1]).toMatchObject({
      type: 'supervisor_review',
      round: 2,
      verdict: 'approve',
      feedback: 'good',
    });
    expect(done[0]).toMatchObject({
      type: 'supervisor_done',
      totalRounds: 2,
      finalAgent: 'worker',
    });
  });

  it('子 Agent 执行异常时应继续下一轮', async () => {
    let callIdx = 0;
    const agent: BaseAgent = {
      name: 'flaky',
      description: 'Sometimes fails',
      execute: vi.fn(async (): Promise<TaskOutput> => {
        callIdx++;
        if (callIdx === 1) throw new Error('Network timeout');
        return { content: 'Success after retry', agentName: 'flaky' };
      }),
    };

    const provider = buildMockProvider([
      '{"agentName":"flaky","taskDescription":"do it"}',
      // round 1: agent throws → review still called with error content → revise
      '{"verdict":"revise","feedback":"try again"}',
      // round 2: agent succeeds → approve
      '{"verdict":"approve","feedback":"ok"}',
    ]);

    const supervisor = new Supervisor({
      name: 'boss',
      description: 'test',
      provider,
      model: 'test',
      agents: [agent],
    });

    const events: MultiAgentEvent[] = [];
    const result = await supervisor.execute({ content: 'test' }, (e) => events.push(e));

    expect(result.content).toBe('Success after retry');
    expect(result.metadata?.approved).toBe(true);
    expect(result.metadata?.totalRounds).toBe(2);

    // 第一轮应有 task_failed 事件
    const failEvents = events.filter((e) => e.type === 'task_failed');
    expect(failEvents).toHaveLength(1);
    expect(failEvents[0]!.type === 'task_failed' && failEvents[0]!.error).toContain('Network timeout');
  });

  it('LLM 分配失败时应降级到第一个 Agent', async () => {
    const agent = fakeAgent('default', 'Default handler', 'Handled');

    const provider = {
      chat: vi.fn()
        .mockRejectedValueOnce(new Error('LLM down'))    // assign fails
        .mockResolvedValue({                                // review → approve
          id: 'r',
          content: '{"verdict":"approve","feedback":"ok"}',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }),
      stream: vi.fn(),
    } as unknown as LLMProvider;

    const supervisor = new Supervisor({
      name: 'boss',
      description: 'test',
      provider,
      model: 'test',
      agents: [agent],
    });

    const result = await supervisor.execute({ content: 'test' });

    expect(result.content).toBe('Handled');
    expect(result.agentName).toBe('default');
    expect(agent.execute).toHaveBeenCalledTimes(1);
  });

  it('空 agents 列表应抛出异常', () => {
    expect(() => new Supervisor({
      name: 'boss',
      description: 'test',
      provider: {} as LLMProvider,
      model: 'test',
      agents: [],
    })).toThrow('at least one agent');
  });

  it('metadata 中 supervisorRound 应正确传递', async () => {
    const agent = fakeAgent('worker', 'Works', ['v1', 'v2']);

    const provider = buildMockProvider([
      '{"agentName":"worker","taskDescription":"do it"}',
      '{"verdict":"revise","feedback":"more"}',
      '{"verdict":"approve","feedback":"ok"}',
    ]);

    const supervisor = new Supervisor({
      name: 'boss',
      description: 'test',
      provider,
      model: 'test',
      agents: [agent],
    });

    await supervisor.execute({ content: 'task' });

    // 验证传递给 Agent 的 metadata 包含 supervisorRound
    const calls = (agent.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect((calls[0]![0] as TaskInput).metadata?.supervisorRound).toBe(1);
    expect((calls[1]![0] as TaskInput).metadata?.supervisorRound).toBe(2);
  });
});
