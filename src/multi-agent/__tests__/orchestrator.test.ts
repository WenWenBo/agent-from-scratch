/**
 * Orchestrator 单元测试
 * 使用 mock LLM 测试路由逻辑
 */

import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../orchestrator.js';
import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from '../base-agent.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ChatResponse } from '../../types.js';

function fakeAgent(name: string, description: string, response: string): BaseAgent {
  return {
    name,
    description,
    execute: vi.fn(async (input: TaskInput): Promise<TaskOutput> => ({
      content: response,
      agentName: name,
    })),
  };
}

function mockRouter(routingJson: string): LLMProvider {
  return {
    chat: vi.fn(async (): Promise<ChatResponse> => ({
      id: 'test',
      content: routingJson,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      finishReason: 'stop',
    })),
    stream: vi.fn(),
  } as unknown as LLMProvider;
}

describe('Orchestrator', () => {
  it('应正确路由到目标 Agent', async () => {
    const mathAgent = fakeAgent('math', 'Solves math problems', '42');
    const writeAgent = fakeAgent('writer', 'Writes text', 'essay');

    const orchestrator = new Orchestrator({
      name: 'router',
      description: 'test',
      provider: mockRouter('{"agentName":"math","reason":"This is a math question"}'),
      model: 'test',
      agents: [mathAgent, writeAgent],
    });

    const result = await orchestrator.execute({ content: 'What is 6*7?' });

    expect(result.content).toBe('42');
    expect(result.agentName).toBe('math');
    expect(mathAgent.execute).toHaveBeenCalled();
    expect(writeAgent.execute).not.toHaveBeenCalled();
  });

  it('不存在的 Agent 应走兜底回答', async () => {
    let callCount = 0;
    const provider = {
      chat: vi.fn(async (): Promise<ChatResponse> => {
        callCount++;
        if (callCount === 1) {
          // 路由响应
          return {
            id: 'r', content: '{"agentName":"nonexistent","reason":"test"}',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: 'stop' as const,
          };
        }
        // 兜底响应
        return {
          id: 'f', content: 'Fallback answer',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop' as const,
        };
      }),
      stream: vi.fn(),
    } as unknown as LLMProvider;

    const orchestrator = new Orchestrator({
      name: 'router',
      description: 'test',
      provider,
      model: 'test',
      agents: [fakeAgent('a', 'test', 'a-response')],
    });

    const result = await orchestrator.execute({ content: 'test' });
    expect(result.content).toBe('Fallback answer');
    expect(result.metadata?.fallback).toBe(true);
  });

  it('应正确处理 LLM 返回 markdown 包裹的 JSON', async () => {
    const agent = fakeAgent('helper', 'Helps', 'helped');
    const orchestrator = new Orchestrator({
      name: 'router',
      description: 'test',
      provider: mockRouter('```json\n{"agentName":"helper","reason":"user needs help"}\n```'),
      model: 'test',
      agents: [agent],
    });

    const result = await orchestrator.execute({ content: 'help me' });
    expect(result.content).toBe('helped');
  });

  it('应产出 orchestrator_thinking 事件', async () => {
    const agent = fakeAgent('a', 'test', 'ok');
    const orchestrator = new Orchestrator({
      name: 'router',
      description: 'test',
      provider: mockRouter('{"agentName":"a","reason":"because"}'),
      model: 'test',
      agents: [agent],
    });

    const events: MultiAgentEvent[] = [];
    await orchestrator.execute({ content: 'test' }, (e) => events.push(e));

    const thinkingEvents = events.filter((e) => e.type === 'orchestrator_thinking');
    expect(thinkingEvents.length).toBeGreaterThan(0);
  });

  it('refinedInput 应传递给子 Agent', async () => {
    const agent = fakeAgent('a', 'test', 'ok');
    const orchestrator = new Orchestrator({
      name: 'router',
      description: 'test',
      provider: mockRouter('{"agentName":"a","reason":"refine","refinedInput":"refined question"}'),
      model: 'test',
      agents: [agent],
    });

    await orchestrator.execute({ content: 'original question' });

    const callArgs = (agent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs![0]).toMatchObject({ content: 'refined question' });
  });

  it('LLM 路由完全失败时应降级到第一个 Agent', async () => {
    const failProvider = {
      chat: vi.fn(async () => { throw new Error('LLM down'); }),
      stream: vi.fn(),
    } as unknown as LLMProvider;

    const agent = fakeAgent('fallback-agent', 'test', 'fallback result');
    const orchestrator = new Orchestrator({
      name: 'router',
      description: 'test',
      provider: failProvider,
      model: 'test',
      agents: [agent],
    });

    // 路由 LLM 失败 → 降级到第一个 Agent
    // 但子 Agent 的 execute 也依赖于自身不抛异常
    const result = await orchestrator.execute({ content: 'test' });
    expect(result.content).toBe('fallback result');
  });

  it('refineOutput=true 时应润色结果', async () => {
    let callCount = 0;
    const provider = {
      chat: vi.fn(async (): Promise<ChatResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            id: 'r', content: '{"agentName":"a","reason":"test"}',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: 'stop' as const,
          };
        }
        // 润色响应
        return {
          id: 'ref', content: 'Polished: raw output',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop' as const,
        };
      }),
      stream: vi.fn(),
    } as unknown as LLMProvider;

    const agent = fakeAgent('a', 'test', 'raw output');
    const orchestrator = new Orchestrator({
      name: 'router',
      description: 'test',
      provider,
      model: 'test',
      agents: [agent],
      refineOutput: true,
    });

    const result = await orchestrator.execute({ content: 'test' });
    expect(result.content).toBe('Polished: raw output');
    expect(result.metadata?.refinedBy).toBe('router');
  });
});
