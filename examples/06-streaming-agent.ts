/**
 * 示例：流式输出 Agent
 * 展示逐字输出效果和流式工具调用
 */

import 'dotenv/config';
import { z } from 'zod';
import {
  OpenAIProvider,
  StreamingAgent,
  ToolRegistry,
  defineTool,
} from '../src/index.js';
import type { AgentEvent } from '../src/index.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// 定义工具
const weatherTool = defineTool({
  name: 'get_weather',
  description: '获取城市天气',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => ({
    city,
    temp: city === '北京' ? 18 : 25,
    condition: city === '北京' ? '晴' : '多云',
  }),
});

const tools = new ToolRegistry();
tools.register(weatherTool);

async function main() {
  // ========================================================
  // 场景 1: 纯文本流式输出
  // ========================================================
  console.log('=== 场景 1: 纯文本流式输出 ===\n');

  const agent1 = new StreamingAgent({
    provider,
    model,
    systemPrompt: '你是一个友好的中文助手。',
  });

  process.stdout.write('Agent: ');
  await agent1.run('用三句话介绍 TypeScript', (event) => {
    if (event.type === 'text_delta') {
      process.stdout.write(event.content);
    }
  });
  console.log('\n');

  // ========================================================
  // 场景 2: 流式 + 工具调用
  // ========================================================
  console.log('=== 场景 2: 流式 + 工具调用 ===\n');

  const agent2 = new StreamingAgent({
    provider,
    model,
    systemPrompt: '你是一个天气助手。使用 get_weather 工具查询天气。用中文回答。',
    tools,
  });

  await agent2.run('北京天气怎么样？', (event) => {
    switch (event.type) {
      case 'text_delta':
        process.stdout.write(event.content);
        break;
      case 'tool_call':
        console.log(`\n🔧 调用工具: ${event.toolName}(${event.arguments})`);
        break;
      case 'tool_result':
        console.log(`📋 结果: ${JSON.stringify(event.result.result)}`);
        process.stdout.write('\nAgent: ');
        break;
      case 'answer':
        console.log('');
        break;
    }
  });

  // ========================================================
  // 场景 3: AsyncGenerator 模式
  // ========================================================
  console.log('\n=== 场景 3: AsyncGenerator 模式 ===\n');

  const agent3 = new StreamingAgent({
    provider,
    model,
    systemPrompt: 'Reply in English. Be brief.',
  });

  const gen = agent3.runStream('What is 2+2?');
  let genResult = await gen.next();
  let eventCount = 0;

  while (!genResult.done) {
    eventCount++;
    const event = genResult.value;
    if (event.type === 'text_delta') {
      process.stdout.write(event.content);
    }
    genResult = await gen.next();
  }

  const finalResult = genResult.value;
  console.log(`\n\n(${eventCount} 个事件, ${finalResult.steps} 步, ${finalResult.usage.totalTokens} tokens)`);
}

main().catch(console.error);
