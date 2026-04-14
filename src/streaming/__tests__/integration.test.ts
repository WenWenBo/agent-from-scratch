/**
 * 流式输出集成测试
 * 使用真实 LLM API 验证流式 Agent 的端到端工作
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import 'dotenv/config';
import { StreamingAgent } from '../streaming-agent.js';
import type { StreamingAgentEvent } from '../streaming-agent.js';
import { OpenAIProvider } from '../../providers/openai.js';
import { ToolRegistry, defineTool } from '../../tools/index.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

describe('StreamingAgent 集成测试', () => {
  it('纯文本应逐字流式输出', async () => {
    const agent = new StreamingAgent({
      provider,
      model,
      systemPrompt: 'Reply in English. Keep it to one short sentence.',
    });

    const textDeltas: string[] = [];
    const result = await agent.run('Say hello', (event) => {
      if (event.type === 'text_delta') {
        textDeltas.push(event.content);
      }
    });

    expect(result.content).toBeTruthy();
    expect(textDeltas.length).toBeGreaterThan(0);
    // 所有 delta 拼接应等于最终内容
    expect(textDeltas.join('')).toBe(result.content);
  }, 15000);

  it('流式工具调用应完整执行 ReAct 循环', async () => {
    const calcTool = defineTool({
      name: 'calculator',
      description: 'Calculate a math expression',
      parameters: z.object({
        expression: z.string().describe('Math expression'),
      }),
      execute: async ({ expression }) => {
        const result = Function(`"use strict"; return (${expression})`)();
        return { result: Number(result) };
      },
    });

    const tools = new ToolRegistry();
    tools.register(calcTool);

    const agent = new StreamingAgent({
      provider,
      model,
      systemPrompt: 'Use the calculator tool for math. Reply in English.',
      tools,
    });

    const eventTypes: string[] = [];
    const result = await agent.run('What is 15 * 23?', (event) => {
      eventTypes.push(event.type);
    });

    expect(result.content).toContain('345');
    expect(eventTypes).toContain('tool_call');
    expect(eventTypes).toContain('tool_result');
    // 最终回复应有 text_delta
    expect(eventTypes).toContain('text_delta');
  }, 30000);

  it('runStream AsyncGenerator 应正确工作', async () => {
    const agent = new StreamingAgent({
      provider,
      model,
      systemPrompt: 'Reply with just "OK" in English.',
    });

    const events: StreamingAgentEvent[] = [];
    const gen = agent.runStream('test');
    let result = await gen.next();

    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }

    const agentResult = result.value;
    expect(agentResult.content).toBeTruthy();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
    expect(events[events.length - 1]!.type).toBe('answer');
  }, 15000);
});
