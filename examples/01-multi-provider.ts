/**
 * 示例 01b: 多 Provider 切换
 * 演示同一段代码如何在 OpenAI 和 Anthropic 之间切换
 *
 * 运行方式: pnpm example examples/01-multi-provider.ts
 */

import { LLMProvider } from '../src/providers/base.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import type { Message } from '../src/types.js';

/**
 * 核心思想：业务代码依赖抽象（LLMProvider），不依赖具体实现
 * 切换模型只需要换一行创建 Provider 的代码
 */
async function askQuestion(provider: LLMProvider, question: string) {
  const messages: Message[] = [
    { role: 'system', content: '你是一个简洁的助手，用中文回答，不超过两句话。' },
    { role: 'user', content: question },
  ];

  const response = await provider.chat({
    model: '',
    messages,
  });

  return response;
}

async function main() {
  const question = '什么是 Prompt Engineering？';

  // 使用 OpenAI
  if (process.env.OPENAI_API_KEY) {
    console.log('--- OpenAI ---');
    const openai = new OpenAIProvider({ defaultModel: 'gpt-4o-mini' });
    const r1 = await askQuestion(openai, question);
    console.log('回复:', r1.content);
    console.log('Token:', r1.usage.totalTokens);
  }

  // 使用 Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('\n--- Anthropic ---');
    const anthropic = new AnthropicProvider({ defaultModel: 'claude-sonnet-4-20250514' });
    const r2 = await askQuestion(anthropic, question);
    console.log('回复:', r2.content);
    console.log('Token:', r2.usage.totalTokens);
  }

  // 使用 DeepSeek（兼容 OpenAI 格式）
  if (process.env.DEEPSEEK_API_KEY) {
    console.log('\n--- DeepSeek ---');
    const deepseek = new OpenAIProvider({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
    });
    const r3 = await askQuestion(deepseek, question);
    console.log('回复:', r3.content);
    console.log('Token:', r3.usage.totalTokens);
  }
}

main().catch(console.error);
