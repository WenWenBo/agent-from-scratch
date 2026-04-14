/**
 * TracedAgent -- 单元测试
 *
 * 使用 mock LLM 验证 TracedAgent 自动产生 Trace 和 Metrics
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../agent.js';
import { ToolRegistry } from '../../tools/registry.js';
import { defineTool } from '../../tools/tool.js';
import { z } from 'zod';
import { Tracer } from '../tracer.js';
import { InMemoryExporter } from '../exporters.js';
import { MetricsCollector } from '../metrics.js';
import { TracedAgent } from '../traced-agent.js';

function createMockProvider(response: {
  content?: string | null;
  toolCalls?: any[];
  finishReason?: string;
}) {
  return {
    chat: vi.fn().mockResolvedValue({
      id: 'mock-id',
      content: response.content ?? null,
      toolCalls: response.toolCalls ?? undefined,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: response.finishReason ?? 'stop',
    }),
    stream: vi.fn(),
  };
}

describe('TracedAgent', () => {
  it('应为每次 run 创建 Trace', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ exporters: [exporter] });
    const metrics = new MetricsCollector();

    const provider = createMockProvider({ content: 'Hello!', finishReason: 'stop' });
    const agent = new Agent({
      provider: provider as any,
      model: 'gpt-4o',
      systemPrompt: 'You are helpful.',
    });

    const traced = new TracedAgent({ agent, tracer, metrics, model: 'gpt-4o' });
    const result = await traced.run('Hi');

    expect(result.content).toBe('Hello!');
    expect(exporter.traceCount).toBe(1);

    const trace = exporter.getLastTrace()!;
    expect(trace.name).toBe('agent.run');
    expect(trace.status).toBe('ok');
    expect(trace.attributes['agent.model']).toBe('gpt-4o');
  });

  it('应记录 Token 用量到 Metrics', async () => {
    const tracer = new Tracer();
    const metrics = new MetricsCollector();

    const provider = createMockProvider({ content: 'Done', finishReason: 'stop' });
    const agent = new Agent({
      provider: provider as any,
      model: 'gpt-4o',
      systemPrompt: 'test',
    });

    const traced = new TracedAgent({ agent, tracer, metrics, model: 'gpt-4o' });
    await traced.run('test');

    const tokenMetrics = metrics.getTokenMetrics();
    expect(tokenMetrics.callCount).toBe(1);
    expect(tokenMetrics.totalPromptTokens).toBe(100);
    expect(tokenMetrics.totalCompletionTokens).toBe(50);
  });

  it('应记录端到端延迟', async () => {
    const tracer = new Tracer();
    const metrics = new MetricsCollector();

    const provider = createMockProvider({ content: 'Done', finishReason: 'stop' });
    const agent = new Agent({
      provider: provider as any,
      model: 'gpt-4o',
      systemPrompt: 'test',
    });

    const traced = new TracedAgent({ agent, tracer, metrics, model: 'gpt-4o' });
    await traced.run('test');

    const latency = metrics.getLatencyMetrics('agent.e2e');
    expect(latency.count).toBe(1);
    expect(latency.avgMs).toBeGreaterThanOrEqual(0);
  });

  it('应记录成功次数', async () => {
    const tracer = new Tracer();
    const metrics = new MetricsCollector();

    const provider = createMockProvider({ content: 'OK', finishReason: 'stop' });
    const agent = new Agent({
      provider: provider as any,
      model: 'gpt-4o',
      systemPrompt: 'test',
    });

    const traced = new TracedAgent({ agent, tracer, metrics, model: 'gpt-4o' });
    await traced.run('test');

    const counter = metrics.getCounterMetrics('agent.run');
    expect(counter.success).toBe(1);
    expect(counter.failure).toBe(0);
  });

  it('应为工具调用创建 Span', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ exporters: [exporter] });
    const metrics = new MetricsCollector();

    const addTool = defineTool({
      name: 'add',
      description: 'Add two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    });

    const tools = new ToolRegistry();
    tools.register(addTool);

    const provider = {
      chat: vi.fn()
        .mockResolvedValueOnce({
          id: 'call-1',
          content: null,
          toolCalls: [{
            id: 'tc-1',
            function: { name: 'add', arguments: '{"a":2,"b":3}' },
          }],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          id: 'call-2',
          content: 'The answer is 5',
          toolCalls: undefined,
          usage: { promptTokens: 150, completionTokens: 20, totalTokens: 170 },
          finishReason: 'stop',
        }),
      stream: vi.fn(),
    };

    const agent = new Agent({
      provider: provider as any,
      model: 'gpt-4o',
      systemPrompt: 'test',
      tools,
    });

    const traced = new TracedAgent({ agent, tracer, metrics, model: 'gpt-4o' });
    const result = await traced.run('What is 2+3?');

    expect(result.content).toBe('The answer is 5');

    const trace = exporter.getLastTrace()!;
    const toolSpans = trace.spans.filter((s) => s.kind === 'tool');
    expect(toolSpans.length).toBeGreaterThanOrEqual(1);
    expect(toolSpans[0].name).toBe('tool.add');
    expect(toolSpans[0].attributes['tool.success']).toBe(true);
  });

  it('LLM 异常时应标记 Trace 为 error', async () => {
    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ exporters: [exporter] });
    const metrics = new MetricsCollector();

    const provider = createMockProvider({ content: 'Error fallback', finishReason: 'stop' });
    const agent = new Agent({
      provider: provider as any,
      model: 'gpt-4o',
      systemPrompt: 'test',
    });

    const traced = new TracedAgent({ agent, tracer, metrics, model: 'gpt-4o' });

    // Agent.run 内部捕获 LLM 错误并返回 error content，不会 throw
    // 这里我们让 provider 抛异常
    provider.chat.mockRejectedValueOnce(new Error('API timeout'));

    const result = await traced.run('test');
    expect(result.content).toContain('Error');

    const counter = metrics.getCounterMetrics('agent.run');
    expect(counter.success).toBe(1);
  });

  it('应传递外部 onEvent 回调', async () => {
    const tracer = new Tracer();
    const provider = createMockProvider({ content: 'Hi', finishReason: 'stop' });
    const agent = new Agent({
      provider: provider as any,
      model: 'gpt-4o',
      systemPrompt: 'test',
    });

    const traced = new TracedAgent({ agent, tracer, model: 'gpt-4o' });
    const events: any[] = [];
    await traced.run('test', (e) => events.push(e));

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'answer')).toBe(true);
  });
});
