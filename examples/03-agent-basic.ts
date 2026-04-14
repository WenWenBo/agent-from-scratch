/**
 * 示例：最简单的 Agent -- 纯对话模式
 * 展示 Agent 如何在没有工具的情况下工作
 */

import 'dotenv/config';
import { Agent, OpenAIProvider } from '../src/index.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});

const agent = new Agent({
  provider,
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  systemPrompt: '你是一个友好的中文助手。回答要简洁明了。',
});

async function main() {
  console.log('=== Agent 基础对话 ===\n');

  const result = await agent.run('请用一句话解释什么是 ReAct 模式');

  console.log('回复:', result.content);
  console.log('步数:', result.steps);
  console.log('Token 用量:', result.usage);
}

main().catch(console.error);
