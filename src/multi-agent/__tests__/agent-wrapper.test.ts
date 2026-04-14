/**
 * AgentWrapper 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentWrapper } from '../agent-wrapper.js';
import type { MultiAgentEvent } from '../base-agent.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ChatResponse } from '../../types.js';

function mockProvider(content: string): LLMProvider {
  return {
    chat: vi.fn(async (): Promise<ChatResponse> => ({
      id: 'test',
      content,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
    })),
    stream: vi.fn(),
  } as unknown as LLMProvider;
}

describe('AgentWrapper', () => {
  it('应包装 Agent 并正确执行任务', async () => {
    const wrapper = new AgentWrapper({
      name: 'test-agent',
      description: 'A test agent',
      provider: mockProvider('Hello from wrapped agent'),
      model: 'test',
      systemPrompt: 'You are helpful.',
    });

    const result = await wrapper.execute({ content: 'hi' });

    expect(result.content).toBe('Hello from wrapped agent');
    expect(result.agentName).toBe('test-agent');
    expect(result.result).toBeDefined();
    expect(result.result!.steps).toBe(1);
  });

  it('应产出 task_assigned 和 task_completed 事件', async () => {
    const wrapper = new AgentWrapper({
      name: 'event-agent',
      description: 'test',
      provider: mockProvider('done'),
      model: 'test',
      systemPrompt: 'test',
    });

    const events: MultiAgentEvent[] = [];
    await wrapper.execute({ content: 'test' }, (e) => events.push(e));

    expect(events.some((e) => e.type === 'task_assigned')).toBe(true);
    expect(events.some((e) => e.type === 'task_completed')).toBe(true);

    const completed = events.find((e) => e.type === 'task_completed');
    if (completed?.type === 'task_completed') {
      expect(completed.agentName).toBe('event-agent');
      expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('LLM 失败时 Agent 内部捕获错误，结果包含错误信息', async () => {
    const failProvider = {
      chat: vi.fn(async () => { throw new Error('LLM down'); }),
      stream: vi.fn(),
    } as unknown as LLMProvider;

    const wrapper = new AgentWrapper({
      name: 'fail-agent',
      description: 'test',
      provider: failProvider,
      model: 'test',
      systemPrompt: 'test',
    });

    const events: MultiAgentEvent[] = [];
    const result = await wrapper.execute(
      { content: 'test' },
      (e) => events.push(e)
    );

    // Agent.run() 内部捕获 LLM 错误并返回错误信息（不 re-throw）
    expect(result.content).toContain('LLM down');
    // 但 wrapper 仍然产出 task_completed（因为 Agent 没有 throw）
    expect(events.some((e) => e.type === 'task_completed')).toBe(true);
  });

  it('name 和 description 应正确暴露', () => {
    const wrapper = new AgentWrapper({
      name: 'my-agent',
      description: 'Does something useful',
      provider: mockProvider(''),
      model: 'test',
      systemPrompt: 'test',
    });

    expect(wrapper.name).toBe('my-agent');
    expect(wrapper.description).toBe('Does something useful');
  });
});
