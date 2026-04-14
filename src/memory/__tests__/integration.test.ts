/**
 * 记忆系统集成测试
 * 使用真实 LLM API 验证记忆系统的端到端工作
 */

import { describe, it, expect } from 'vitest';
import 'dotenv/config';
import { MemoryAgent } from '../memory-agent.js';
import { InMemoryStore } from '../memory-store.js';
import { OpenAIProvider } from '../../providers/openai.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});

const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

describe('MemoryAgent 集成测试', () => {
  it('多轮对话应保持上下文', async () => {
    const agent = new MemoryAgent({
      provider,
      model,
      systemPrompt: 'You are a helpful assistant. Reply in English. Keep replies very short (1-2 sentences).',
    });

    const r1 = await agent.chat('My name is Alice.');
    expect(r1.content).toBeTruthy();

    const r2 = await agent.chat('What is my name?');
    expect(r2.content.toLowerCase()).toContain('alice');
  }, 30000);

  it('长期记忆应影响回复', async () => {
    const store = new InMemoryStore();
    await store.add({
      content: 'The user prefers TypeScript over JavaScript.',
      metadata: { source: 'profile' },
      importance: 0.9,
    });

    const agent = new MemoryAgent({
      provider,
      model,
      systemPrompt: 'You are a helpful assistant. Use relevant memories to personalize responses. Reply in English. Keep replies short.',
      longTermMemory: store,
    });

    const result = await agent.chat('What programming language should I learn next?');
    const lower = result.content.toLowerCase();
    // 长期记忆说用户喜欢 TS，回复应体现这一偏好
    expect(lower).toMatch(/typescript|ts/i);
  }, 30000);

  it('重置后应丢失短期记忆', async () => {
    const agent = new MemoryAgent({
      provider,
      model,
      systemPrompt: 'You are a helpful assistant. Reply in English. Keep replies very short.',
    });

    await agent.chat('Remember: the secret code is BLUE42.');
    agent.resetConversation();

    const r2 = await agent.chat('What is the secret code?');
    const lower = r2.content.toLowerCase();
    // 重置后不应记得 secret code
    expect(lower).not.toContain('blue42');
  }, 30000);
});
