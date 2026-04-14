/**
 * ParallelFanOut 单元测试
 */

import { describe, it, expect } from 'vitest';
import { ParallelFanOut } from '../parallel.js';
import type { BaseAgent, TaskInput, TaskOutput, MultiAgentEvent } from '../base-agent.js';

function fakeAgent(name: string, transform: (input: string) => string, delay = 0): BaseAgent {
  return {
    name,
    description: `Agent ${name}`,
    execute: async (input: TaskInput): Promise<TaskOutput> => {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return {
        content: transform(input.content),
        agentName: name,
      };
    },
  };
}

function failAgent(name: string): BaseAgent {
  return {
    name,
    description: 'always fails',
    execute: async () => { throw new Error(`${name} failed`); },
  };
}

describe('ParallelFanOut', () => {
  describe('concatenate 策略', () => {
    it('应并行执行并拼接结果', async () => {
      const parallel = new ParallelFanOut({
        name: 'par',
        description: 'test',
        agents: [
          fakeAgent('a', (s) => `A:${s}`),
          fakeAgent('b', (s) => `B:${s}`),
        ],
        strategy: 'concatenate',
      });

      const result = await parallel.execute({ content: 'hello' });
      expect(result.content).toContain('[a]');
      expect(result.content).toContain('A:hello');
      expect(result.content).toContain('[b]');
      expect(result.content).toContain('B:hello');
      expect(result.agentName).toBe('par');
    });
  });

  describe('first_success 策略', () => {
    it('应返回第一个成功结果', async () => {
      const parallel = new ParallelFanOut({
        name: 'first',
        description: 'test',
        agents: [
          fakeAgent('a', (s) => `A:${s}`),
          fakeAgent('b', (s) => `B:${s}`),
        ],
        strategy: 'first_success',
      });

      const result = await parallel.execute({ content: 'hi' });
      // 并行执行，但 first_success 取第一个完成的
      expect(result.content).toMatch(/^[AB]:hi$/);
    });
  });

  describe('longest 策略', () => {
    it('应返回最长的结果', async () => {
      const parallel = new ParallelFanOut({
        name: 'longest',
        description: 'test',
        agents: [
          fakeAgent('short', () => 'hi'),
          fakeAgent('long', () => 'this is a much longer response'),
        ],
        strategy: 'longest',
      });

      const result = await parallel.execute({ content: 'test' });
      expect(result.content).toBe('this is a much longer response');
    });
  });

  describe('自定义聚合函数', () => {
    it('应用自定义函数合并结果', async () => {
      const parallel = new ParallelFanOut({
        name: 'custom',
        description: 'test',
        agents: [
          fakeAgent('a', () => '10'),
          fakeAgent('b', () => '20'),
        ],
        strategy: (results) => ({
          content: `Sum: ${results.reduce((s, r) => s + Number(r.content), 0)}`,
          agentName: 'aggregated',
        }),
      });

      const result = await parallel.execute({ content: 'test' });
      expect(result.content).toBe('Sum: 30');
    });
  });

  describe('错误处理', () => {
    it('continueOnError=true 时应忽略失败的 Agent', async () => {
      const parallel = new ParallelFanOut({
        name: 'tolerant',
        description: 'test',
        agents: [
          fakeAgent('good', () => 'ok'),
          failAgent('bad'),
        ],
        strategy: 'first_success',
        continueOnError: true,
      });

      const result = await parallel.execute({ content: 'test' });
      expect(result.content).toBe('ok');
    });

    it('所有 Agent 失败应抛异常', async () => {
      const parallel = new ParallelFanOut({
        name: 'all-fail',
        description: 'test',
        agents: [failAgent('a'), failAgent('b')],
        continueOnError: true,
      });

      await expect(parallel.execute({ content: 'test' })).rejects.toThrow('All parallel agents failed');
    });

    it('continueOnError=false 时单个失败应立即抛异常', async () => {
      const parallel = new ParallelFanOut({
        name: 'strict',
        description: 'test',
        agents: [
          failAgent('bad'),
          fakeAgent('good', () => 'ok', 100),
        ],
        continueOnError: false,
      });

      await expect(parallel.execute({ content: 'test' })).rejects.toThrow('bad failed');
    });
  });

  describe('事件', () => {
    it('应产出 parallel_start 和 parallel_done 事件', async () => {
      const parallel = new ParallelFanOut({
        name: 'events',
        description: 'test',
        agents: [
          fakeAgent('a', (s) => s),
          fakeAgent('b', (s) => s),
        ],
      });

      const events: MultiAgentEvent[] = [];
      await parallel.execute({ content: 'test' }, (e) => events.push(e));

      expect(events.some((e) => e.type === 'parallel_start')).toBe(true);
      expect(events.some((e) => e.type === 'parallel_done')).toBe(true);

      const doneEvent = events.find((e) => e.type === 'parallel_done');
      if (doneEvent?.type === 'parallel_done') {
        expect(doneEvent.results.length).toBe(2);
        expect(doneEvent.results.every((r) => r.success)).toBe(true);
      }
    });
  });

  describe('metadata', () => {
    it('应包含并行执行的元数据', async () => {
      const parallel = new ParallelFanOut({
        name: 'meta',
        description: 'test',
        agents: [fakeAgent('a', (s) => s)],
      });

      const result = await parallel.execute({ content: 'test' });
      expect(result.metadata?.parallelAgents).toEqual(['a']);
      expect(result.metadata?.successCount).toBe(1);
      expect(result.metadata?.totalCount).toBe(1);
    });
  });

  it('空 agents 应抛异常', () => {
    expect(() => new ParallelFanOut({
      name: 'empty',
      description: 'test',
      agents: [],
    })).toThrow('at least one agent');
  });
});
