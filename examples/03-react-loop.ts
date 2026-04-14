/**
 * 示例：完整的 ReAct 循环
 * 展示 Agent 如何自主地 Think → Act → Observe → Answer
 * 通过 onEvent 回调实时观测每一步
 */

import 'dotenv/config';
import {
  Agent,
  OpenAIProvider,
  ToolRegistry,
  defineTool,
} from '../src/index.js';
import type { AgentEvent } from '../src/index.js';
import { z } from 'zod';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});

// 定义工具
const weatherTool = defineTool({
  name: 'get_weather',
  description: '获取指定城市的天气信息',
  parameters: z.object({
    city: z.string().describe('城市名称'),
  }),
  execute: async ({ city }) => {
    // 模拟天气 API
    const weatherData: Record<string, { temp: number; condition: string }> = {
      '北京': { temp: 18, condition: '晴' },
      '上海': { temp: 22, condition: '多云' },
      '深圳': { temp: 28, condition: '阵雨' },
    };
    return weatherData[city] ?? { temp: 25, condition: '未知' };
  },
});

const calculatorTool = defineTool({
  name: 'calculator',
  description: '计算数学表达式',
  parameters: z.object({
    expression: z.string().describe('数学表达式'),
  }),
  execute: async ({ expression }) => {
    const result = Function(`"use strict"; return (${expression})`)();
    return { result: Number(result) };
  },
});

const tools = new ToolRegistry();
tools.registerMany([weatherTool, calculatorTool]);

const agent = new Agent({
  provider,
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  systemPrompt: `你是一个智能助手，可以查天气和做计算。
  当用户问天气时，使用 get_weather 工具。
  当用户问数学问题时，使用 calculator 工具。
  回答用中文。`,
  tools,
  maxSteps: 5,
});

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'thinking':
      return `💭 [Step ${event.step}] 思考: ${event.content}`;
    case 'tool_call':
      return `🔧 [Step ${event.step}] 调用工具: ${event.toolName}(${event.arguments})`;
    case 'tool_result':
      return `📋 [Step ${event.step}] 工具结果: ${event.result.success ? JSON.stringify(event.result.result) : event.result.error}`;
    case 'answer':
      return `✅ [Step ${event.step}] 最终回复: ${event.content}`;
    case 'error':
      return `❌ [Step ${event.step}] 错误: ${event.error}`;
    case 'max_steps_reached':
      return `⚠️ [Step ${event.step}] 达到最大步数`;
  }
}

async function main() {
  console.log('=== ReAct 循环演示 ===\n');

  // 场景 1: 需要调用工具
  console.log('--- 场景 1: 查天气 ---');
  const r1 = await agent.run(
    '北京今天天气怎么样？',
    (event) => console.log(formatEvent(event))
  );
  console.log(`\n总步数: ${r1.steps}, Token: ${r1.usage.totalTokens}\n`);

  // 场景 2: 多步骤任务
  console.log('--- 场景 2: 天气 + 计算 ---');
  const r2 = await agent.run(
    '深圳天气多少度？如果明天降温 5 度，温度是多少？',
    (event) => console.log(formatEvent(event))
  );
  console.log(`\n总步数: ${r2.steps}, Token: ${r2.usage.totalTokens}\n`);
}

main().catch(console.error);
