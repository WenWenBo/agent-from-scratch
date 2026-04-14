/**
 * 示例：带记忆的 Agent
 * 展示短期记忆（多轮对话上下文）和长期记忆（跨会话持久化）
 */

import 'dotenv/config';
import {
  OpenAIProvider,
  MemoryAgent,
  InMemoryStore,
} from '../src/index.js';
import type { AgentEvent } from '../src/index.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});

const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'thinking': return `  💭 思考: ${event.content}`;
    case 'tool_call': return `  🔧 调用: ${event.toolName}`;
    case 'tool_result': return `  📋 结果: ${JSON.stringify(event.result.result ?? event.result.error)}`;
    case 'answer': return `  ✅ 回复: ${event.content}`;
    case 'error': return `  ❌ 错误: ${event.error}`;
    case 'max_steps_reached': return `  ⚠️ 达到最大步数`;
  }
}

async function main() {
  // ========================================================
  // 场景 1: 短期记忆 -- 多轮对话
  // ========================================================
  console.log('=== 场景 1: 短期记忆（多轮对话）===\n');

  const agent1 = new MemoryAgent({
    provider,
    model,
    systemPrompt: '你是一个友好的中文助手。回答要简洁。',
  });

  const r1 = await agent1.chat('我叫小明，我是一名前端工程师');
  console.log('User: 我叫小明，我是一名前端工程师');
  console.log('Agent:', r1.content);

  const r2 = await agent1.chat('我叫什么名字？我的职业是什么？');
  console.log('\nUser: 我叫什么名字？我的职业是什么？');
  console.log('Agent:', r2.content);
  console.log(`(消息历史: ${agent1.getMessageCount()} 条)\n`);

  // ========================================================
  // 场景 2: 长期记忆 -- 跨会话
  // ========================================================
  console.log('=== 场景 2: 长期记忆（跨会话）===\n');

  const longTermStore = new InMemoryStore();

  const agent2 = new MemoryAgent({
    provider,
    model,
    systemPrompt: '你是一个个性化助手。利用你知道的关于用户的信息来提供定制化建议。用中文回答。',
    longTermMemory: longTermStore,
  });

  // 存入长期记忆
  await agent2.remember('用户喜欢 TypeScript 和 React', { source: 'profile' }, 0.9);
  await agent2.remember('用户正在学习 Agent 开发', { source: 'conversation' }, 0.8);
  await agent2.remember('用户偏好简洁的代码风格', { source: 'preference' }, 0.7);

  const r3 = await agent2.chat('给我推荐一些学习资源');
  console.log('User: 给我推荐一些学习资源');
  console.log('Agent:', r3.content);

  // 重置对话但保留长期记忆
  agent2.resetConversation();
  console.log('\n--- 新会话 (短期记忆已清空，长期记忆保留) ---\n');

  const r4 = await agent2.chat('我适合学什么技术？');
  console.log('User: 我适合学什么技术？');
  console.log('Agent:', r4.content);

  // ========================================================
  // 场景 3: 记忆回顾
  // ========================================================
  console.log('\n=== 场景 3: 搜索长期记忆 ===\n');
  const memories = await agent2.recall('TypeScript');
  console.log('搜索 "TypeScript" 相关记忆:');
  memories.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
}

main().catch(console.error);
