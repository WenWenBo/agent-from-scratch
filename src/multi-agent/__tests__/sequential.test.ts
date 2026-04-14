/**
 * SequentialPipeline 单元测试
 */

import { describe, it, expect } from 'vitest';
import { SequentialPipeline } from '../sequential.js';
import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from '../base-agent.js';

function fakeAgent(name: string, transform: (input: string) => string): BaseAgent {
  return {
    name,
    description: `Agent ${name}`,
    execute: async (input: TaskInput): Promise<TaskOutput> => ({
      content: transform(input.content),
      agentName: name,
      metadata: input.metadata,
    }),
  };
}

describe('SequentialPipeline', () => {
  it('应按顺序传递输入输出', async () => {
    const pipeline = new SequentialPipeline({
      name: 'test-pipeline',
      description: 'test',
      agents: [
        fakeAgent('upper', (s) => s.toUpperCase()),
        fakeAgent('exclaim', (s) => `${s}!!!`),
      ],
    });

    const result = await pipeline.execute({ content: 'hello' });

    expect(result.content).toBe('HELLO!!!');
    expect(result.agentName).toBe('test-pipeline');
  });

  it('单个 Agent 的 pipeline 应正常工作', async () => {
    const pipeline = new SequentialPipeline({
      name: 'single',
      description: 'test',
      agents: [fakeAgent('echo', (s) => s)],
    });

    const result = await pipeline.execute({ content: 'test' });
    expect(result.content).toBe('test');
  });

  it('三步 pipeline 应正确链式传递', async () => {
    const pipeline = new SequentialPipeline({
      name: 'three-step',
      description: 'test',
      agents: [
        fakeAgent('step1', (s) => `[1:${s}]`),
        fakeAgent('step2', (s) => `[2:${s}]`),
        fakeAgent('step3', (s) => `[3:${s}]`),
      ],
    });

    const result = await pipeline.execute({ content: 'x' });
    expect(result.content).toBe('[3:[2:[1:x]]]');
  });

  it('应产出 pipeline_step 事件', async () => {
    const pipeline = new SequentialPipeline({
      name: 'events',
      description: 'test',
      agents: [
        fakeAgent('a', (s) => s),
        fakeAgent('b', (s) => s),
      ],
    });

    const events: MultiAgentEvent[] = [];
    await pipeline.execute({ content: 'test' }, (e) => events.push(e));

    const stepEvents = events.filter((e) => e.type === 'pipeline_step');
    expect(stepEvents.length).toBe(2);
    if (stepEvents[0]?.type === 'pipeline_step') {
      expect(stepEvents[0].step).toBe(1);
      expect(stepEvents[0].agentName).toBe('a');
    }
    if (stepEvents[1]?.type === 'pipeline_step') {
      expect(stepEvents[1].step).toBe(2);
      expect(stepEvents[1].agentName).toBe('b');
    }
  });

  it('metadata 应沿管线传递', async () => {
    const pipeline = new SequentialPipeline({
      name: 'meta',
      description: 'test',
      agents: [
        fakeAgent('a', (s) => s),
        fakeAgent('b', (s) => s),
      ],
    });

    const result = await pipeline.execute({
      content: 'test',
      metadata: { origin: 'user' },
    });

    expect(result.metadata?.pipelineSteps).toEqual(['a', 'b']);
  });

  it('空 agents 应抛异常', () => {
    expect(() => new SequentialPipeline({
      name: 'empty',
      description: 'test',
      agents: [],
    })).toThrow('at least one agent');
  });

  it('中间 Agent 抛异常应中断 pipeline', async () => {
    const failAgent: BaseAgent = {
      name: 'fail',
      description: 'fails',
      execute: async () => { throw new Error('boom'); },
    };

    const pipeline = new SequentialPipeline({
      name: 'fail-pipeline',
      description: 'test',
      agents: [
        fakeAgent('a', (s) => s),
        failAgent,
        fakeAgent('c', (s) => s),
      ],
    });

    await expect(pipeline.execute({ content: 'test' })).rejects.toThrow('boom');
  });
});
