/**
 * 示例 02b: 工具 + LLM 手动循环
 * 演示 LLM 选择工具 → 执行工具 → 返回结果 → LLM 生成最终回复 的完整过程
 * （这个手动过程就是 Chapter 03 ReAct 循环要自动化的逻辑）
 *
 * 运行方式: pnpm example examples/02-tool-with-llm.ts
 */

import { config } from 'dotenv';
config();

import { OpenAIProvider } from '../src/providers/openai.js';
import { ToolRegistry, calculatorTool, currentTimeTool, stringTool } from '../src/tools/index.js';
import type { Message } from '../src/types.js';

const provider = new OpenAIProvider();
const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const registry = new ToolRegistry();
registry.registerMany([calculatorTool, currentTimeTool, stringTool]);

async function main() {
  const messages: Message[] = [
    {
      role: 'system',
      content: '你是一个助手。需要计算时使用 calculator，需要处理文本时使用 string_utils，需要时间时使用 current_time。',
    },
    { role: 'user', content: '现在几点了？另外帮我算一下 2024 的平方根（保留两位小数）' },
  ];

  console.log('用户:', messages[messages.length - 1]!.content);
  console.log('---');

  // 可能需要多轮工具调用
  for (let step = 0; step < 5; step++) {
    const response = await provider.chat({
      model,
      messages,
      tools: registry.toDefinitions(),
      temperature: 0,
    });

    if (response.finishReason === 'stop') {
      console.log('\nAssistant:', response.content);
      break;
    }

    if (response.finishReason === 'tool_calls' && response.toolCalls) {
      // 将 assistant 消息（含 toolCalls）加入历史
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // 并行执行所有工具调用
      const results = await registry.executeMany(response.toolCalls);

      for (const tc of response.toolCalls) {
        const result = results.get(tc.id)!;
        console.log(`[Step ${step + 1}] 工具: ${tc.function.name}(${tc.function.arguments})`);
        console.log(`  结果: ${result.success ? JSON.stringify(result.result) : result.error}`);

        // 将工具结果加入历史
        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          content: result.success ? JSON.stringify(result.result) : `Error: ${result.error}`,
        });
      }
    }
  }
}

main().catch(console.error);
