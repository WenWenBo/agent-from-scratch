/**
 * 客服智能体 -- 集成测试（需要真实 LLM API）
 *
 * 跳过条件: OPENAI_API_KEY 未设置
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CustomerServiceBot } from '../customer-service.js';

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

const skipReason = !apiKey ? 'OPENAI_API_KEY not set' : undefined;

describe.skipIf(!!skipReason)('CustomerServiceBot 集成测试', () => {
  let bot: CustomerServiceBot;

  beforeAll(async () => {
    bot = new CustomerServiceBot({
      apiKey: apiKey!,
      baseUrl,
      model,
      budget: 0.5,
    });
    await bot.initKnowledgeBase();
  });

  it('应能回答产品价格问题', async () => {
    const reply = await bot.chat('TinyBot Pro 多少钱？');
    expect(reply).toBeTruthy();
    expect(reply.length).toBeGreaterThan(10);
    // 知识库包含 ¥299/月 的信息
    expect(reply).toMatch(/299|价格|月|年/);
  }, 30000);

  it('应能查询用户信息', async () => {
    const reply = await bot.chat('帮我查一下用户 U001 的信息');
    expect(reply).toBeTruthy();
    expect(reply).toMatch(/张三|Pro|用户/);
  }, 30000);

  it('应能回答 FAQ 问题', async () => {
    const reply = await bot.chat('如何升级套餐？');
    expect(reply).toBeTruthy();
    expect(reply.length).toBeGreaterThan(20);
  }, 30000);
});
