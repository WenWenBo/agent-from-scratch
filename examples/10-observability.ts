/**
 * Chapter 10 示例：可观测性系统
 *
 * 演示：
 * 1. Tracer + Exporter 追踪 Agent 执行
 * 2. MetricsCollector 收集性能指标
 * 3. TracedAgent 自动包装
 * 4. Dashboard 文本报表
 *
 * 运行: npx tsx examples/10-observability.ts
 */

import 'dotenv/config';
import { z } from 'zod';
import { OpenAIProvider } from '../src/providers/openai.js';
import { Agent } from '../src/agent.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/tool.js';
import {
  Tracer,
  ConsoleExporter,
  InMemoryExporter,
  MetricsCollector,
  TracedAgent,
  Dashboard,
} from '../src/observability/index.js';

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

if (!apiKey) {
  console.error('需要在 .env 中配置 OPENAI_API_KEY');
  process.exit(1);
}

// ============================================================
// 1. 设置工具
// ============================================================

const calculatorTool = defineTool({
  name: 'calculator',
  description: 'Perform arithmetic calculations',
  parameters: z.object({
    expression: z.string().describe('Math expression like "2 + 3"'),
  }),
  execute: async ({ expression }) => {
    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
    return new Function(`return ${sanitized}`)();
  },
});

const tools = new ToolRegistry();
tools.register(calculatorTool);

// ============================================================
// 2. 设置可观测性
// ============================================================

const consoleExporter = new ConsoleExporter({ verbose: true });
const memoryExporter = new InMemoryExporter();
const metrics = new MetricsCollector();

const tracer = new Tracer({
  serviceName: 'observability-demo',
  exporters: [consoleExporter, memoryExporter],
});

// ============================================================
// 3. 创建 TracedAgent
// ============================================================

const provider = new OpenAIProvider({ apiKey, baseUrl });
const agent = new Agent({
  provider,
  model,
  systemPrompt: 'You are a helpful math assistant. Use the calculator tool for any arithmetic.',
  tools,
  maxSteps: 5,
  temperature: 0,
});

const tracedAgent = new TracedAgent({
  agent,
  tracer,
  metrics,
  model,
  attributes: { 'demo.scenario': 'math-assistant' },
});

// ============================================================
// 4. 运行多个请求
// ============================================================

async function main() {
  console.log('=== 可观测性系统演示 ===\n');

  const questions = [
    'What is 42 * 17?',
    'Calculate (100 + 200) * 3',
    'What is the square root of 144?',
  ];

  for (const q of questions) {
    console.log(`\nUser: ${q}`);

    try {
      const result = await tracedAgent.run(q);
      console.log(`Agent: ${result.content}\n`);
    } catch (err) {
      console.error(`Error: ${err}`);
    }
  }

  // ============================================================
  // 5. 查看报表
  // ============================================================

  const dashboard = new Dashboard(metrics);

  console.log('\n\n');
  console.log(dashboard.generateReport());

  // Trace 时间线
  const traces = memoryExporter.getTraces();
  if (traces.length > 0) {
    console.log('\n=== 最近一次 Trace 时间线 ===\n');
    console.log(dashboard.generateTraceTimeline(traces[traces.length - 1]!));
  }

  // 状态行
  console.log(`\n[Status] ${dashboard.generateStatusLine()}`);
}

main().catch(console.error);
