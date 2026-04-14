/**
 * 工具系统集成测试
 * 验证 LLM 能正确选择工具、生成参数，且工具执行结果能正确返回
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { config } from 'dotenv';
import { OpenAIProvider } from '../../providers/openai.js';
import { ToolRegistry } from '../registry.js';
import { calculatorTool, currentTimeTool, stringTool } from '../builtin.js';
import type { Message } from '../../types.js';

config();

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const canRun = !!apiKey && !!baseUrl;

describe.skipIf(!canRun)('工具系统集成测试（真实 API）', () => {
  let provider: OpenAIProvider;
  let registry: ToolRegistry;

  beforeAll(() => {
    provider = new OpenAIProvider({
      apiKey: apiKey!,
      baseUrl: baseUrl!,
      defaultModel: model,
    });
    registry = new ToolRegistry();
    registry.registerMany([calculatorTool, currentTimeTool, stringTool]);
  });

  it('LLM 应选择 calculator 工具并生成正确参数', async () => {
    const response = await provider.chat({
      model,
      messages: [
        { role: 'system', content: '你是助手。需要计算时必须使用 calculator 工具。' },
        { role: 'user', content: '请计算 256 * 37 等于多少' },
      ],
      tools: registry.toDefinitions(),
      temperature: 0,
    });

    expect(response.finishReason).toBe('tool_calls');
    expect(response.toolCalls).toBeDefined();

    const call = response.toolCalls![0]!;
    expect(call.function.name).toBe('calculator');
    console.log('[集成] LLM 生成的计算参数:', call.function.arguments);

    // 执行工具
    const execResult = await registry.execute(call);
    expect(execResult.success).toBe(true);
    console.log('[集成] 工具执行结果:', execResult.result);
  }, 30000);

  it('完整循环：LLM 调用工具 → 执行 → 返回结果 → LLM 生成最终回复', async () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '你是助手。需要计算时必须使用 calculator 工具。根据工具返回的结果回答用户。',
      },
      { role: 'user', content: '99 的平方是多少？' },
    ];

    // 第 1 轮：LLM 决定调用工具
    const step1 = await provider.chat({
      model,
      messages,
      tools: registry.toDefinitions(),
      temperature: 0,
    });

    expect(step1.toolCalls).toBeDefined();
    const toolCall = step1.toolCalls![0]!;
    console.log('[集成] 第1轮 - 工具调用:', toolCall.function);

    // 执行工具
    const execResult = await registry.execute(toolCall);
    expect(execResult.success).toBe(true);
    console.log('[集成] 工具结果:', execResult.result);

    // 第 2 轮：把结果返回给 LLM
    messages.push({
      role: 'assistant',
      content: step1.content,
      toolCalls: step1.toolCalls,
    });
    messages.push({
      role: 'tool',
      toolCallId: toolCall.id,
      content: JSON.stringify(execResult.result),
    });

    const step2 = await provider.chat({
      model,
      messages,
      tools: registry.toDefinitions(),
      temperature: 0,
    });

    console.log('[集成] 第2轮 - 最终回复:', step2.content);
    expect(step2.finishReason).toBe('stop');
    expect(step2.content).toBeTruthy();
    expect(step2.content!).toContain('9801');
  }, 60000);

  it('LLM 应能在多个工具中选择正确的一个', async () => {
    const response = await provider.chat({
      model,
      messages: [
        { role: 'system', content: '你是助手。使用合适的工具回答问题。' },
        { role: 'user', content: '请把 "hello world" 转为大写' },
      ],
      tools: registry.toDefinitions(),
      temperature: 0,
    });

    expect(response.toolCalls).toBeDefined();
    const call = response.toolCalls![0]!;
    expect(call.function.name).toBe('string_utils');

    const args = JSON.parse(call.function.arguments);
    expect(args.operation).toBe('uppercase');
    console.log('[集成] LLM 正确选择了 string_utils 工具:', args);

    const execResult = await registry.execute(call);
    expect(execResult.success).toBe(true);
    expect((execResult.result as any).result).toBe('HELLO WORLD');
  }, 30000);
});
