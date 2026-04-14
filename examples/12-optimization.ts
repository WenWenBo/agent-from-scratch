/**
 * Chapter 12 示例 -- 性能与成本优化
 *
 * 演示 LLMCache、ModelRouter、PromptOptimizer、CostTracker、RequestBatcher 的用法
 *
 * 运行: npx tsx examples/12-optimization.ts
 */

import 'dotenv/config';
import { OpenAIProvider } from '../src/providers/openai.js';
import { LLMCache } from '../src/optimization/cache.js';
import { ModelRouter, type ModelConfig } from '../src/optimization/model-router.js';
import { PromptOptimizer } from '../src/optimization/prompt-optimizer.js';
import { CostTracker } from '../src/optimization/cost-tracker.js';
import { RequestBatcher } from '../src/optimization/request-batcher.js';
import type { ChatRequest, ChatResponse, Message } from '../src/types.js';

// ============================================================
// 1. LLM Response Cache
// ============================================================

async function demoCache() {
  console.log('\n' + '='.repeat(60));
  console.log('1. LLM Response Cache');
  console.log('='.repeat(60));

  const cache = new LLMCache({ maxSize: 50, ttlMs: 300000 });

  const request: ChatRequest = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is 2 + 2?' },
    ],
  };

  const mockResponse: ChatResponse = {
    id: 'cached-resp',
    content: '2 + 2 = 4',
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    finishReason: 'stop',
  };

  // 模拟：第一次 miss，写入缓存
  console.log('\n第一次请求（miss）:', cache.get(request) ? 'HIT' : 'MISS');
  cache.set(request, mockResponse);

  // 第二次 hit
  const cached = cache.get(request);
  console.log('第二次请求（hit）:', cached ? 'HIT' : 'MISS');
  console.log('缓存内容:', cached?.content);

  // 不同请求仍然 miss
  const otherReq: ChatRequest = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'What is 3 + 3?' }],
  };
  console.log('不同请求:', cache.get(otherReq) ? 'HIT' : 'MISS');

  console.log('\n缓存统计:', cache.getStats());
}

// ============================================================
// 2. Model Router
// ============================================================

async function demoModelRouter() {
  console.log('\n' + '='.repeat(60));
  console.log('2. Model Router -- 智能模型选择');
  console.log('='.repeat(60));

  const mockProvider = { chat: async () => ({} as any), stream: async function* () {} } as any;

  const models: ModelConfig[] = [
    { name: 'gpt-4o-mini', provider: mockProvider, costPer1MPrompt: 0.15, costPer1MCompletion: 0.6, maxTokens: 16384, capabilityLevel: 3 },
    { name: 'gpt-4o', provider: mockProvider, costPer1MPrompt: 2.5, costPer1MCompletion: 10, maxTokens: 128000, capabilityLevel: 8 },
  ];

  const router = new ModelRouter({ models, defaultModel: 'gpt-4o' });

  // 简单问题
  const simple: ChatRequest = { model: '', messages: [{ role: 'user', content: 'Hi' }] };
  const r1 = router.route(simple);
  console.log('\n"Hi" →', r1.model.name, `(${r1.reason})`);

  // 复杂问题
  const complex: ChatRequest = {
    model: '',
    messages: [{ role: 'user', content: 'Please analyze in detail the architectural trade-offs between microservices and monoliths, step by step, considering scalability and maintainability' }],
    tools: [{ type: 'function', function: { name: 'search', description: 'search', parameters: {} } }],
  };
  const r2 = router.route(complex);
  console.log('"Complex analysis..." →', r2.model.name, `(${r2.reason})`);

  console.log('\n路由统计:', router.getRoutingStats());
}

// ============================================================
// 3. Prompt Optimizer
// ============================================================

async function demoPromptOptimizer() {
  console.log('\n' + '='.repeat(60));
  console.log('3. Prompt Optimizer -- Token 节省');
  console.log('='.repeat(60));

  const optimizer = new PromptOptimizer({
    maxTokenBudget: 200,
    compressWhitespace: true,
    minTurnsToKeep: 2,
  });

  const messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.\n\n\n\nBe concise   and   accurate.' },
  ];

  for (let i = 0; i < 10; i++) {
    messages.push({ role: 'user', content: `Question ${i}: Tell me something interesting.` });
    messages.push({ role: 'assistant', content: `Answer ${i}: Here is something interesting about topic ${i}. ` + 'Extra detail. '.repeat(5) });
  }

  const request: ChatRequest = { model: 'gpt-4o', messages };
  const result = optimizer.optimize(request);

  console.log('\n优化前:', result.originalTokenEstimate, 'tokens');
  console.log('优化后:', result.optimizedTokenEstimate, 'tokens');
  console.log('节省:', result.tokensSaved, 'tokens', `(${(result.savingsPercent * 100).toFixed(1)}%)`);
  console.log('执行的优化:', result.actions);
  console.log('消息数变化:', messages.length, '→', result.request.messages.length);
}

// ============================================================
// 4. Cost Tracker
// ============================================================

async function demoCostTracker() {
  console.log('\n' + '='.repeat(60));
  console.log('4. Cost Tracker -- 成本追踪与预算控制');
  console.log('='.repeat(60));

  const tracker = new CostTracker(
    {
      totalBudget: 0.1,
      maxCostPerHour: 0.05,
      alertThreshold: 0.8,
    },
    (alert) => {
      console.log(`\n⚠️  告警 [${alert.type}]: ${alert.message}`);
    }
  );

  // 模拟多次调用
  tracker.record('gpt-4o-mini', 500, 200);
  console.log('\n调用 1 (gpt-4o-mini): $' + tracker.getTotalCost().toFixed(6));

  tracker.record('gpt-4o', 2000, 1000);
  console.log('调用 2 (gpt-4o): $' + tracker.getTotalCost().toFixed(6));

  tracker.record('gpt-4o', 50000, 20000);
  console.log('调用 3 (gpt-4o 大量 tokens): $' + tracker.getTotalCost().toFixed(6));

  const summary = tracker.getSummary();
  console.log('\n成本摘要:');
  console.log('  总调用次数:', summary.totalCalls);
  console.log('  总 token:', summary.totalTokens);
  console.log('  总成本: $' + summary.totalCost.toFixed(6));
  console.log('  每次平均: $' + summary.avgCostPerCall.toFixed(6));
  console.log('  剩余预算:', summary.budgetRemaining !== undefined ? '$' + summary.budgetRemaining.toFixed(6) : 'N/A');
  console.log('  按模型:', summary.byModel);
  console.log('  告警数:', summary.alerts.length);
}

// ============================================================
// 5. Request Batcher
// ============================================================

async function demoRequestBatcher() {
  console.log('\n' + '='.repeat(60));
  console.log('5. Request Batcher -- 并发控制与去重');
  console.log('='.repeat(60));

  let callCount = 0;
  const mockProvider = {
    chat: async (req: ChatRequest) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      const msg = req.messages[req.messages.length - 1]!;
      return {
        id: `resp-${callCount}`,
        content: `Response to: ${('content' in msg ? msg.content : '')}`,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
      } as ChatResponse;
    },
    stream: async function* () {},
  } as any;

  const batcher = new RequestBatcher({
    provider: mockProvider,
    maxConcurrency: 2,
    deduplication: true,
  });

  const requests: ChatRequest[] = [
    { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] },
    { model: 'gpt-4o', messages: [{ role: 'user', content: 'World' }] },
    { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }, // 重复
    { model: 'gpt-4o', messages: [{ role: 'user', content: 'Foo' }] },
  ];

  console.log(`\n提交 ${requests.length} 个请求（其中 1 个重复，并发上限 2）...`);
  const start = Date.now();
  const responses = await batcher.submitBatch(requests);
  const elapsed = Date.now() - start;

  console.log(`完成！耗时 ${elapsed}ms`);
  responses.forEach((r, i) => console.log(`  [${i}] ${r.content}`));

  const stats = batcher.getStats();
  console.log('\nBatcher 统计:', stats);
  console.log(`实际 LLM 调用次数: ${callCount}（去重节省了 ${stats.deduplicated} 次）`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  Chapter 12: 性能与成本优化 -- 示例演示        ║');
  console.log('╚════════════════════════════════════════════════╝');

  await demoCache();
  await demoModelRouter();
  await demoPromptOptimizer();
  await demoCostTracker();
  await demoRequestBatcher();

  console.log('\n' + '='.repeat(60));
  console.log('✅ 所有示例演示完成！');
  console.log('='.repeat(60));
}

main().catch(console.error);
