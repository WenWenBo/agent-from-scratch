/**
 * 示例 02: 工具系统基础
 * 演示如何定义工具、注册到 Registry、导出 Schema、执行工具
 *
 * 运行方式: pnpm example examples/02-tool-basics.ts
 */

import { z } from 'zod';
import { defineTool, ToolRegistry, calculatorTool, currentTimeTool, stringTool } from '../src/tools/index.js';

// 1. 自定义工具
const greetTool = defineTool({
  name: 'greet',
  description: '用指定语言打招呼',
  parameters: z.object({
    name: z.string().describe('人名'),
    language: z.enum(['zh', 'en', 'ja']).describe('语言'),
  }),
  execute: async ({ name, language }) => {
    const greetings = { zh: '你好', en: 'Hello', ja: 'こんにちは' };
    return { greeting: `${greetings[language]}, ${name}!` };
  },
});

// 2. 注册到 Registry
const registry = new ToolRegistry({ executionTimeout: 5000 });
registry.registerMany([calculatorTool, currentTimeTool, stringTool, greetTool]);

async function main() {
  // 3. 导出给 LLM 的 ToolDefinition（这就是发给 API 的 tools 参数）
  console.log('=== 注册的工具 ===');
  const definitions = registry.toDefinitions();
  for (const def of definitions) {
    console.log(`- ${def.function.name}: ${def.function.description}`);
  }

  console.log('\n=== JSON Schema（LLM 看到的参数格式）===');
  console.log(JSON.stringify(definitions[0]!.function.parameters, null, 2));

  // 4. 模拟 LLM 返回的 ToolCall，手动执行
  console.log('\n=== 执行工具 ===');

  const result1 = await registry.execute({
    id: 'call_1',
    function: { name: 'calculator', arguments: '{"expression":"(2+3)*4"}' },
  });
  console.log('calculator:', result1);

  const result2 = await registry.execute({
    id: 'call_2',
    function: { name: 'greet', arguments: '{"name":"小明","language":"zh"}' },
  });
  console.log('greet:', result2);

  // 5. 错误场景
  console.log('\n=== 错误处理 ===');

  const badResult = await registry.execute({
    id: 'call_3',
    function: { name: 'calculator', arguments: '{"expression":"invalid chars: abc"}' },
  });
  console.log('执行错误:', badResult);

  const notFound = await registry.execute({
    id: 'call_4',
    function: { name: 'nonexistent', arguments: '{}' },
  });
  console.log('工具不存在:', notFound);
}

main().catch(console.error);
