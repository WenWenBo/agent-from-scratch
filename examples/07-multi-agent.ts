/**
 * 示例：Multi-Agent 系统
 *
 * 展示三种协作模式：
 * 1. SequentialPipeline -- 研究 → 撰写 → 审校
 * 2. ParallelFanOut -- 多角度分析
 * 3. Orchestrator -- 智能路由
 */

import 'dotenv/config';
import {
  OpenAIProvider,
  AgentWrapper,
  SequentialPipeline,
  ParallelFanOut,
  Orchestrator,
} from '../src/index.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function main() {
  // ========================================================
  // 场景 1: SequentialPipeline -- 串行流水线
  // ========================================================
  console.log('=== 场景 1: 串行流水线（研究→撰写→审校） ===\n');

  const researcher = new AgentWrapper({
    name: 'researcher',
    description: 'Researches a topic and provides key facts',
    provider, model,
    systemPrompt: 'You are a researcher. Given a topic, list 3 key facts. Be concise.',
  });

  const writer = new AgentWrapper({
    name: 'writer',
    description: 'Writes a short article based on research',
    provider, model,
    systemPrompt: 'You are a writer. Turn the given research notes into a short, engaging paragraph.',
  });

  const pipeline = new SequentialPipeline({
    name: 'content-pipeline',
    description: 'Research → Write',
    agents: [researcher, writer],
  });

  const pipeResult = await pipeline.execute(
    { content: 'TypeScript generics' },
    (event) => {
      if (event.type === 'pipeline_step') {
        console.log(`  [Step ${event.step}] → ${event.agentName}`);
      }
    }
  );
  console.log(`\n结果:\n${pipeResult.content}\n`);

  // ========================================================
  // 场景 2: ParallelFanOut -- 多角度分析
  // ========================================================
  console.log('\n=== 场景 2: 并行分析（乐观派 vs 悲观派） ===\n');

  const optimist = new AgentWrapper({
    name: 'optimist',
    description: 'Provides optimistic analysis',
    provider, model,
    systemPrompt: 'You are an optimist. Analyze the topic highlighting opportunities and positives. Keep it to 2 sentences.',
  });

  const pessimist = new AgentWrapper({
    name: 'pessimist',
    description: 'Provides pessimistic analysis',
    provider, model,
    systemPrompt: 'You are a pessimist. Analyze the topic highlighting risks and challenges. Keep it to 2 sentences.',
  });

  const parallel = new ParallelFanOut({
    name: 'dual-analysis',
    description: 'Optimistic + Pessimistic analysis',
    agents: [optimist, pessimist],
    strategy: 'concatenate',
  });

  const parResult = await parallel.execute(
    { content: 'AI replacing software developers' },
    (event) => {
      if (event.type === 'parallel_start') {
        console.log(`  并行启动: ${event.agents.join(', ')}`);
      }
      if (event.type === 'parallel_done') {
        console.log(`  全部完成: ${event.results.length} 个 Agent`);
      }
    }
  );
  console.log(`\n结果:\n${parResult.content}\n`);

  // ========================================================
  // 场景 3: Orchestrator -- 智能路由
  // ========================================================
  console.log('\n=== 场景 3: 智能路由 ===\n');

  const mathAgent = new AgentWrapper({
    name: 'math-expert',
    description: 'Solves math problems and calculations',
    provider, model,
    systemPrompt: 'You are a math expert. Solve the given math problem step by step.',
  });

  const codeAgent = new AgentWrapper({
    name: 'code-expert',
    description: 'Writes and explains code',
    provider, model,
    systemPrompt: 'You are a coding expert. Write clean code with brief explanations.',
  });

  const orchestrator = new Orchestrator({
    name: 'smart-router',
    description: 'Routes tasks to the right expert',
    provider, model,
    agents: [mathAgent, codeAgent, writer],
  });

  const questions = [
    'What is the integral of x^2?',
    'Write a TypeScript function to reverse a string',
  ];

  for (const q of questions) {
    console.log(`Q: ${q}`);
    const result = await orchestrator.execute(
      { content: q },
      (event) => {
        if (event.type === 'orchestrator_thinking') {
          console.log(`  [Router] ${event.content}`);
        }
      }
    );
    console.log(`A (by ${result.agentName}): ${result.content.slice(0, 150)}...\n`);
  }
}

main().catch(console.error);
