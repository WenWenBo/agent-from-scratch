/**
 * 示例 01: 基础对话
 * 演示如何使用 OpenAI Provider 发送一个简单的对话请求
 *
 * 运行方式: pnpm example examples/01-basic-chat.ts
 */

import { OpenAIProvider } from '../src/providers/openai.js';

async function main() {
  // 创建 Provider 实例（自动从环境变量读取 API Key）
  const provider = new OpenAIProvider();

  // 发送非流式请求
  console.log('--- 非流式请求 ---');
  const response = await provider.chat({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: '你是一个简洁的助手，用中文回答。' },
      { role: 'user', content: '用一句话解释什么是 Agent。' },
    ],
    temperature: 0.7,
  });

  console.log('回复:', response.content);
  console.log('Token 用量:', response.usage);
  console.log('结束原因:', response.finishReason);

  // 发送流式请求
  console.log('\n--- 流式请求 ---');
  process.stdout.write('回复: ');
  for await (const chunk of provider.stream({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: '你是一个简洁的助手，用中文回答。' },
      { role: 'user', content: '用一句话解释什么是 LLM。' },
    ],
  })) {
    if (chunk.type === 'text_delta') {
      process.stdout.write(chunk.content ?? '');
    } else if (chunk.type === 'usage') {
      console.log('\nToken 用量:', chunk.usage);
    }
  }
  console.log();
}

main().catch(console.error);
