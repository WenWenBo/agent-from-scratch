/**
 * Agent 集成测试
 * 使用真实 LLM API 验证 ReAct 循环的端到端工作
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import 'dotenv/config';
import { Agent } from '../agent.js';
import { OpenAIProvider } from '../providers/openai.js';
import { ToolRegistry, defineTool } from '../tools/index.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});

const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

describe('Agent Integration', () => {
  // ----------------------------------------------------------
  // 1. 纯对话
  // ----------------------------------------------------------

  it('应完成纯对话交互', async () => {
    const agent = new Agent({
      provider,
      model,
      systemPrompt: 'You are a helpful assistant. Reply in English.',
    });

    const result = await agent.run('What is 2 + 2? Reply with just the number.');

    expect(result.content).toBeTruthy();
    expect(result.content).toContain('4');
    expect(result.steps).toBe(1);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  }, 30000);

  // ----------------------------------------------------------
  // 2. 单工具调用循环
  // ----------------------------------------------------------

  it('应完成工具调用 ReAct 循环', async () => {
    const calculatorTool = defineTool({
      name: 'calculator',
      description: 'Calculate a math expression. Returns the numeric result.',
      parameters: z.object({
        expression: z.string().describe('Math expression like "2 + 3 * 4"'),
      }),
      execute: async ({ expression }) => {
        const result = Function(`"use strict"; return (${expression})`)();
        return { result: Number(result) };
      },
    });

    const tools = new ToolRegistry();
    tools.register(calculatorTool);

    const agent = new Agent({
      provider,
      model,
      systemPrompt: 'You are a math assistant. Use the calculator tool for any calculation. Reply in English.',
      tools,
    });

    const result = await agent.run('What is 17 * 23?');

    expect(result.content).toContain('391');
    expect(result.steps).toBeGreaterThanOrEqual(2);

    const toolCallEvents = result.events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);

    const toolResultEvents = result.events.filter((e) => e.type === 'tool_result');
    expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  // ----------------------------------------------------------
  // 3. 多工具 Agent
  // ----------------------------------------------------------

  it('应能在多个工具中选择正确的工具', async () => {
    const weatherTool = defineTool({
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: z.object({
        city: z.string().describe('City name'),
      }),
      execute: async ({ city }) => ({
        city,
        temperature: 22,
        condition: 'sunny',
      }),
    });

    const timeTool = defineTool({
      name: 'get_time',
      description: 'Get current time for a timezone',
      parameters: z.object({
        timezone: z.string().describe('Timezone like "Asia/Shanghai"'),
      }),
      execute: async ({ timezone }) => ({
        timezone,
        time: '14:30:00',
      }),
    });

    const tools = new ToolRegistry();
    tools.registerMany([weatherTool, timeTool]);

    const agent = new Agent({
      provider,
      model,
      systemPrompt: 'You are a helpful assistant with access to weather and time tools. Reply in English.',
      tools,
    });

    const result = await agent.run('What is the weather in Beijing?');

    expect(result.content.toLowerCase()).toMatch(/beijing|sunny|22/i);

    const toolCallEvents = result.events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents.length).toBeGreaterThanOrEqual(1);
    if (toolCallEvents[0]?.type === 'tool_call') {
      expect(toolCallEvents[0].toolName).toBe('get_weather');
    }
  }, 30000);

  // ----------------------------------------------------------
  // 4. 事件流验证
  // ----------------------------------------------------------

  it('事件回调应被实时触发', async () => {
    const echoTool = defineTool({
      name: 'echo',
      description: 'Echo back the input message',
      parameters: z.object({ message: z.string() }),
      execute: async ({ message }) => ({ echo: message }),
    });

    const tools = new ToolRegistry();
    tools.register(echoTool);

    const agent = new Agent({
      provider,
      model,
      systemPrompt: 'You are a test assistant. Use the echo tool to echo the user message, then confirm you did it. Reply in English.',
      tools,
    });

    const liveEvents: string[] = [];
    const result = await agent.run('Echo hello', (event) => {
      liveEvents.push(event.type);
    });

    // 至少应有 tool_call → tool_result → answer
    expect(liveEvents).toContain('tool_call');
    expect(liveEvents).toContain('tool_result');
    expect(liveEvents).toContain('answer');
    expect(result.events.length).toBe(liveEvents.length);
  }, 30000);
});
