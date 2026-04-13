/**
 * LLM Provider 集成测试
 * 使用真实 API 验证端到端连通性
 *
 * 运行方式: pnpm test:integration
 * 需要在 .env 中配置 OPENAI_API_KEY 和 OPENAI_BASE_URL
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAIProvider } from '../openai.js';
import { config } from 'dotenv';
import type { ChatRequest, ToolDefinition } from '../../types.js';

config(); // 加载 .env

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const canRun = !!apiKey && !!baseUrl;

describe.skipIf(!canRun)('OpenAI Provider 集成测试（真实 API）', () => {
  let provider: OpenAIProvider;

  beforeAll(() => {
    provider = new OpenAIProvider({
      apiKey: apiKey!,
      baseUrl: baseUrl!,
      defaultModel: model,
    });
  });

  // ----------------------------------------------------------
  // 1. 基础连通性
  // ----------------------------------------------------------

  it('应成功完成一次基础对话', async () => {
    const result = await provider.chat({
      model,
      messages: [
        { role: 'system', content: '你是一个助手。只回复"OK"两个字母，不要其他内容。' },
        { role: 'user', content: '测试连通性' },
      ],
      temperature: 0,
      maxTokens: 10,
    });

    console.log('[集成测试] 基础对话回复:', result.content);
    console.log('[集成测试] Token 用量:', result.usage);

    expect(result.content).toBeTruthy();
    expect(result.id).toBeTruthy();
    expect(result.finishReason).toBe('stop');
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBe(
      result.usage.promptTokens + result.usage.completionTokens
    );
  }, 30000);

  // ----------------------------------------------------------
  // 2. 多轮对话（上下文保持）
  // ----------------------------------------------------------

  it('应正确处理多轮对话', async () => {
    const result = await provider.chat({
      model,
      messages: [
        { role: 'system', content: '你是一个助手，简短回答。' },
        { role: 'user', content: '我的名字是小明。记住它。' },
        { role: 'assistant', content: '好的，我记住了，你叫小明。' },
        { role: 'user', content: '我叫什么名字？' },
      ],
      temperature: 0,
      maxTokens: 50,
    });

    console.log('[集成测试] 多轮对话回复:', result.content);

    expect(result.content).toBeTruthy();
    expect(result.content!.toLowerCase()).toContain('小明');
  }, 30000);

  // ----------------------------------------------------------
  // 3. 流式输出
  // ----------------------------------------------------------

  it('应成功处理流式输出', async () => {
    const chunks: string[] = [];
    let hasDone = false;

    for await (const chunk of provider.stream({
      model,
      messages: [
        { role: 'system', content: '只回复"Hello World"这两个英文单词，不要其他内容。' },
        { role: 'user', content: '打招呼' },
      ],
      temperature: 0,
      maxTokens: 20,
    })) {
      if (chunk.type === 'text_delta' && chunk.content) {
        chunks.push(chunk.content);
      }
      if (chunk.type === 'done') {
        hasDone = true;
      }
    }

    const fullText = chunks.join('');
    console.log('[集成测试] 流式输出:', fullText);
    console.log('[集成测试] 分块数量:', chunks.length);

    expect(chunks.length).toBeGreaterThan(0);
    expect(fullText).toBeTruthy();
    expect(hasDone).toBe(true);
  }, 30000);

  // ----------------------------------------------------------
  // 4. Function Calling / Tool Use
  // ----------------------------------------------------------

  it('应成功触发工具调用', async () => {
    const tools: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: '获取指定城市的当前天气信息',
          parameters: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: '城市名称，如"北京"、"上海"',
              },
            },
            required: ['city'],
          },
        },
      },
    ];

    const result = await provider.chat({
      model,
      messages: [
        { role: 'system', content: '你是一个天气助手。当用户询问天气时，必须调用 get_weather 工具。' },
        { role: 'user', content: '北京今天天气怎么样？' },
      ],
      tools,
      temperature: 0,
    });

    console.log('[集成测试] 工具调用回复:', {
      content: result.content,
      finishReason: result.finishReason,
      toolCalls: result.toolCalls,
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThan(0);

    const call = result.toolCalls![0]!;
    expect(call.id).toBeTruthy();
    expect(call.function.name).toBe('get_weather');

    const args = JSON.parse(call.function.arguments);
    expect(args.city).toBeTruthy();
    console.log('[集成测试] 工具参数:', args);
  }, 30000);

  // ----------------------------------------------------------
  // 5. 工具调用完整循环（调用 → 返回结果 → 最终回复）
  // ----------------------------------------------------------

  it('应完成工具调用的完整循环', async () => {
    const tools: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'calculate',
          description: '计算数学表达式的结果',
          parameters: {
            type: 'object',
            properties: {
              expression: {
                type: 'string',
                description: '数学表达式，如 "2 + 3 * 4"',
              },
            },
            required: ['expression'],
          },
        },
      },
    ];

    // 第一轮：用户提问，LLM 决定调用工具
    const step1 = await provider.chat({
      model,
      messages: [
        { role: 'system', content: '你是一个计算助手。需要计算时必须调用 calculate 工具。' },
        { role: 'user', content: '请计算 17 * 24 的结果' },
      ],
      tools,
      temperature: 0,
    });

    expect(step1.toolCalls).toBeDefined();
    const toolCall = step1.toolCalls![0]!;

    console.log('[集成测试] 第一轮 - 工具调用:', toolCall.function);

    // 第二轮：把工具结果返回给 LLM，让它生成最终回答
    const step2 = await provider.chat({
      model,
      messages: [
        { role: 'system', content: '你是一个计算助手。需要计算时必须调用 calculate 工具。' },
        { role: 'user', content: '请计算 17 * 24 的结果' },
        {
          role: 'assistant',
          content: step1.content,
          toolCalls: step1.toolCalls,
        },
        {
          role: 'tool',
          toolCallId: toolCall.id,
          content: JSON.stringify({ result: 408 }),
        },
      ],
      tools,
      temperature: 0,
    });

    console.log('[集成测试] 第二轮 - 最终回复:', step2.content);

    expect(step2.finishReason).toBe('stop');
    expect(step2.content).toBeTruthy();
    expect(step2.content!).toContain('408');
  }, 60000);

  // ----------------------------------------------------------
  // 6. 错误处理：无效 API Key
  // ----------------------------------------------------------

  it('无效 API Key 应抛出明确错误', async () => {
    const badProvider = new OpenAIProvider({
      apiKey: 'invalid-key-12345',
      baseUrl: baseUrl!,
      defaultModel: model,
    });

    await expect(
      badProvider.chat({
        model,
        messages: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toThrow(/OpenAI API error/);
  }, 30000);
});
