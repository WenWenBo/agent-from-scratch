/**
 * 客服智能体系统 -- CLI 入口
 *
 * 运行: npx tsx projects/customer-service/main.ts
 */

import 'dotenv/config';
import * as readline from 'node:readline';
import { CustomerServiceBot } from './customer-service.js';

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

  if (!apiKey) {
    console.error('请设置 OPENAI_API_KEY 环境变量');
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     TinyBot 客服智能体系统 v1.0               ║');
  console.log('║     Project C: 综合实战项目                    ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log();

  const bot = new CustomerServiceBot({
    apiKey,
    baseUrl,
    model,
    budget: 1.0,
  });

  console.log('正在初始化知识库...');
  const chunks = await bot.initKnowledgeBase();
  console.log(`知识库加载完成: ${chunks} 个文档片段`);
  console.log();
  console.log('可用命令:');
  console.log('  输入问题 → AI 客服回复');
  console.log('  /status  → 查看运营指标');
  console.log('  /cost    → 查看成本统计');
  console.log('  /tickets → 查看工单列表');
  console.log('  /reset   → 重置会话');
  console.log('  /quit    → 退出');
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): void => {
    rl.question('👤 您: ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
        return;
      }

      if (trimmed === '/quit') {
        console.log('\n感谢使用 TinyBot 客服系统，再见！');
        rl.close();
        return;
      }

      if (trimmed === '/status') {
        console.log('\n' + bot.getMetricsSummary());
        const session = bot.getSession();
        console.log(`当前会话: ${session.sessionId} | 对话轮次: ${session.turnCount}`);
        console.log();
        askQuestion();
        return;
      }

      if (trimmed === '/cost') {
        const cost = bot.getCostSummary();
        console.log('\n成本统计:');
        console.log(`  总花费: $${cost.totalCost.toFixed(6)}`);
        console.log(`  总调用: ${cost.totalCalls} 次`);
        console.log(`  总 Token: ${cost.totalTokens}`);
        console.log(`  平均每次: $${cost.avgCostPerCall.toFixed(6)}`);
        if (cost.budgetRemaining !== undefined) {
          console.log(`  剩余预算: $${cost.budgetRemaining.toFixed(6)}`);
        }
        const cache = bot.getCacheStats();
        if (cache) {
          console.log(`  缓存命中率: ${(cache.hitRate * 100).toFixed(1)}% (${cache.hits}/${cache.hits + cache.misses})`);
        }
        console.log();
        askQuestion();
        return;
      }

      if (trimmed === '/tickets') {
        const tickets = bot.getTickets();
        if (tickets.length === 0) {
          console.log('\n暂无工单');
        } else {
          console.log(`\n工单列表 (${tickets.length} 个):`);
          for (const t of tickets) {
            console.log(`  [${t.ticketId}] ${t.subject} | 优先级: ${t.priority} | 状态: ${t.status}`);
          }
        }
        console.log();
        askQuestion();
        return;
      }

      if (trimmed === '/reset') {
        bot.resetSession();
        console.log('\n会话已重置\n');
        askQuestion();
        return;
      }

      try {
        console.log();
        process.stdout.write('🤖 客服: ');

        const reply = await bot.chat(trimmed, (event) => {
          if (event.type === 'tool_call') {
            console.log(`\n  [工具调用] ${event.toolName}(${JSON.stringify(event.args).slice(0, 80)})`);
          }
          if (event.type === 'tool_result') {
            const preview = event.result?.slice(0, 60) ?? '';
            console.log(`  [工具结果] ${preview}...`);
          }
        });

        console.log(reply);
        console.log();
      } catch (err) {
        console.error('\n系统错误:', err instanceof Error ? err.message : err);
        console.log();
      }

      if (bot.isBudgetExceeded()) {
        console.log('⚠️  预算已超，系统即将停止服务');
        rl.close();
        return;
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
