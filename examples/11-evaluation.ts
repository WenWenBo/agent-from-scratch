/**
 * Chapter 11 示例：评估体系
 *
 * 演示：
 * 1. 基础评估器（ExactMatch、Contains、Regex）
 * 2. LLM-as-a-Judge 多维度评估
 * 3. 黄金数据集批量评估
 * 4. 评估报告输出
 *
 * 运行: npx tsx examples/11-evaluation.ts
 */

import 'dotenv/config';
import { OpenAIProvider } from '../src/providers/openai.js';
import { Agent } from '../src/agent.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/tool.js';
import { z } from 'zod';

import {
  ExactMatchEvaluator,
  ContainsEvaluator,
  CompositeEvaluator,
  LLMJudge,
  GoldenDataset,
  EvalRunner,
} from '../src/evaluation/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

if (!apiKey) {
  console.error('需要在 .env 中配置 OPENAI_API_KEY');
  process.exit(1);
}

// ============================================================
// 1. 准备 Agent
// ============================================================

const calcTool = defineTool({
  name: 'calculator',
  description: 'Perform arithmetic calculations',
  parameters: z.object({ expression: z.string() }),
  execute: async ({ expression }) => {
    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
    return new Function(`return ${sanitized}`)();
  },
});

const tools = new ToolRegistry();
tools.register(calcTool);

const provider = new OpenAIProvider({ apiKey, baseUrl });
const agent = new Agent({
  provider,
  model,
  systemPrompt: 'You are a math assistant. Always use the calculator tool. Give concise answers.',
  tools,
  maxSteps: 5,
  temperature: 0,
});

// ============================================================
// 2. 构建黄金数据集
// ============================================================

const dataset = new GoldenDataset('math-qa');
dataset.addMany([
  { id: 'add-1', input: 'What is 2 + 3?', expected: '5', tags: ['addition'] },
  { id: 'mul-1', input: 'What is 7 * 8?', expected: '56', tags: ['multiplication'] },
  { id: 'div-1', input: 'What is 100 / 4?', expected: '25', tags: ['division'] },
  { id: 'complex-1', input: 'What is (10 + 5) * 3?', expected: '45', tags: ['complex'] },
  { id: 'sub-1', input: 'What is 99 - 42?', expected: '57', tags: ['subtraction'] },
]);

console.log('=== 评估体系演示 ===\n');
console.log(`Dataset: ${dataset.name}, ${dataset.size} cases`);
console.log(`Tags: ${dataset.getTags().join(', ')}\n`);

// ============================================================
// 3. 运行评估
// ============================================================

async function main() {
  // 基础评估器组合
  const basicEval = new CompositeEvaluator({
    evaluators: [
      new ContainsEvaluator({ keywords: [] }), // 占位，实际在运行时按 expected 设置
      new ExactMatchEvaluator({ ignoreCase: true, trim: true }),
    ],
    strategy: 'any',
  });

  // 对每个 case 使用 Contains 检查答案关键词
  const containsAnswer = new ContainsEvaluator({
    keywords: ['5', '56', '25', '45', '57'],
    minMatches: 1,
  });

  const runner = new EvalRunner({
    target: agent,
    evaluators: [containsAnswer],
    concurrency: 1,
    timeoutMs: 30000,
    onProgress: (completed, total, result) => {
      const icon = result.passed ? '✓' : '✗';
      console.log(`  ${icon} [${completed}/${total}] ${result.caseId}: score=${(result.avgScore * 100).toFixed(0)}% (${result.durationMs}ms)`);
    },
  });

  console.log('Running evaluation...\n');
  const report = await runner.run(dataset);

  console.log('\n');
  console.log(EvalRunner.formatReport(report));
}

main().catch(console.error);
