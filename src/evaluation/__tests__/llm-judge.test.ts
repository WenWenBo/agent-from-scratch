/**
 * LLM-as-a-Judge -- 单元测试
 *
 * 使用 mock LLM 验证评估逻辑
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMJudge } from '../llm-judge.js';
import type { EvalInput } from '../evaluator.js';

function createMockProvider(responses: string[]) {
  let callIndex = 0;
  return {
    chat: vi.fn().mockImplementation(async () => ({
      id: `mock-${callIndex}`,
      content: responses[callIndex++] ?? '{"score": 5, "reason": "default"}',
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      finishReason: 'stop',
    })),
    stream: vi.fn(),
  };
}

const makeInput = (output: string, expected?: string): EvalInput => ({
  input: 'What is the capital of France?',
  output,
  expected,
});

describe('LLMJudge', () => {
  it('应正确解析 LLM 评分', async () => {
    const provider = createMockProvider([
      '{"score": 9, "reason": "Correct and well-explained"}',
    ]);

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [{ dimension: 'correctness' }],
    });

    const result = await judge.evaluate(makeInput('Paris is the capital of France.', 'Paris'));
    expect(result.score).toBeCloseTo(0.9, 1);
    expect(result.passed).toBe(true);
  });

  it('低分应标记为 failed', async () => {
    const provider = createMockProvider([
      '{"score": 3, "reason": "Incorrect answer"}',
    ]);

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [{ dimension: 'correctness', threshold: 0.6 }],
    });

    const result = await judge.evaluate(makeInput('Berlin is the capital.', 'Paris'));
    expect(result.score).toBeCloseTo(0.3, 1);
    expect(result.passed).toBe(false);
  });

  it('应支持多维度评估', async () => {
    const provider = createMockProvider([
      '{"score": 8, "reason": "Accurate"}',
      '{"score": 7, "reason": "Helpful"}',
      '{"score": 9, "reason": "Very relevant"}',
    ]);

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [
        { dimension: 'correctness' },
        { dimension: 'helpfulness' },
        { dimension: 'relevance' },
      ],
    });

    const result = await judge.evaluate(makeInput('Paris is the capital of France.'));
    expect(result.score).toBeCloseTo(0.8, 1);
    expect(result.passed).toBe(true);
    expect((result.metadata?.dimensionScores as any[]).length).toBe(3);
  });

  it('应支持自定义维度', async () => {
    const provider = createMockProvider([
      '{"score": 7, "reason": "Mostly formal"}',
    ]);

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [{
        dimension: 'custom',
        customName: 'formality',
        customDescription: 'Evaluate the formality level of the response.',
      }],
    });

    const result = await judge.evaluate(makeInput('The capital is Paris.'));
    expect(result.passed).toBe(true);
    const dims = result.metadata?.dimensionScores as any[];
    expect(dims[0].dimension).toBe('formality');
  });

  it('应支持加权评估', async () => {
    const provider = createMockProvider([
      '{"score": 10, "reason": "Perfect"}',
      '{"score": 0, "reason": "Terrible"}',
    ]);

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [
        { dimension: 'correctness', weight: 3 },
        { dimension: 'helpfulness', weight: 1 },
      ],
    });

    const result = await judge.evaluate(makeInput('Paris'));
    // (10/10 * 3 + 0/10 * 1) / 4 = 0.75
    expect(result.score).toBeCloseTo(0.75, 1);
  });

  it('LLM 返回非 JSON 时应 fallback 解析', async () => {
    const provider = createMockProvider([
      'I would rate this 8 out of 10 because it is mostly correct.',
    ]);

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [{ dimension: 'correctness' }],
    });

    const result = await judge.evaluate(makeInput('Paris'));
    expect(result.score).toBeCloseTo(0.8, 1);
  });

  it('LLM 调用失败时应返回 score 0', async () => {
    const provider = createMockProvider([]);
    provider.chat.mockRejectedValueOnce(new Error('API timeout'));

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [{ dimension: 'correctness' }],
    });

    const result = await judge.evaluate(makeInput('Paris'));
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    // 错误详情在 dimensionScores 中
    const dims = result.metadata?.dimensionScores as any[];
    expect(dims[0].reason).toContain('API timeout');
  });

  it('应将 score 限制在 0-10 范围内', async () => {
    const provider = createMockProvider([
      '{"score": 15, "reason": "Over the top"}',
    ]);

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [{ dimension: 'correctness' }],
    });

    const result = await judge.evaluate(makeInput('Paris'));
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('应在 prompt 中包含 expected 和 context', async () => {
    const provider = createMockProvider([
      '{"score": 8, "reason": "Good"}',
    ]);

    const judge = new LLMJudge({
      provider: provider as any,
      model: 'gpt-4o',
      criteria: [{ dimension: 'correctness' }],
    });

    await judge.evaluate({
      input: 'Question',
      output: 'Answer',
      expected: 'Expected answer',
      context: ['Context 1', 'Context 2'],
    });

    const calledPrompt = provider.chat.mock.calls[0][0].messages[1].content;
    expect(calledPrompt).toContain('Expected answer');
    expect(calledPrompt).toContain('Context 1');
  });
});
