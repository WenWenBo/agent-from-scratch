/**
 * PromptOptimizer -- 单元测试
 */

import { describe, it, expect } from 'vitest';
import { PromptOptimizer } from '../prompt-optimizer.js';
import type { ChatRequest, Message } from '../../types.js';

const system: Message = { role: 'system', content: 'You are a helpful assistant.' };

function makeConversation(turns: number): ChatRequest {
  const messages: Message[] = [system];
  for (let i = 0; i < turns; i++) {
    messages.push({ role: 'user', content: `User message ${i}` });
    messages.push({ role: 'assistant', content: `Assistant response ${i} with some details.` });
  }
  return { model: 'gpt-4o', messages };
}

describe('PromptOptimizer', () => {
  describe('压缩空白', () => {
    it('应移除多余换行和空格', () => {
      const optimizer = new PromptOptimizer();
      const request: ChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Hello\n\n\n\nWorld   foo    bar' },
          { role: 'user', content: 'Test   message' },
        ],
      };

      const result = optimizer.optimize(request);
      expect(result.request.messages[0]!.content).toBe('Hello\n\nWorld foo bar');
      expect(result.request.messages[1]!.content).toBe('Test message');
      expect(result.actions.some((a) => a.includes('Compressed'))).toBe(true);
    });

    it('已精简的内容不应产生 action', () => {
      const optimizer = new PromptOptimizer();
      const request: ChatRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Clean content.' }],
      };

      const result = optimizer.optimize(request);
      expect(result.actions.filter((a) => a.includes('Compressed'))).toHaveLength(0);
    });
  });

  describe('移除注释', () => {
    it('应移除 system 消息中的注释行', () => {
      const optimizer = new PromptOptimizer({ removeComments: true });
      const request: ChatRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: '# This is a comment\nYou are helpful.\n// Another comment\nBe concise.',
          },
          { role: 'user', content: '// Not a system message' },
        ],
      };

      const result = optimizer.optimize(request);
      expect(result.request.messages[0]!.content).toBe('You are helpful.\nBe concise.');
      // user 消息不受影响
      expect(result.request.messages[1]!.content).toBe('// Not a system message');
    });
  });

  describe('消息裁剪', () => {
    it('超预算时应裁剪早期消息', () => {
      const optimizer = new PromptOptimizer({
        maxTokenBudget: 50,
        minTurnsToKeep: 1,
      });

      const request = makeConversation(10);
      const result = optimizer.optimize(request);

      expect(result.request.messages.length).toBeLessThan(request.messages.length);
      expect(result.actions.some((a) => a.includes('Trimmed'))).toBe(true);
      // system 消息应保留
      expect(result.request.messages[0]!.role).toBe('system');
    });

    it('消息数少于 minTurnsToKeep 时不应裁剪', () => {
      const optimizer = new PromptOptimizer({
        maxTokenBudget: 10,
        minTurnsToKeep: 5,
      });

      const request = makeConversation(3);
      const result = optimizer.optimize(request);

      // 3 轮 < 5 轮最小保留，不裁剪
      const nonSystemCount = result.request.messages.filter((m) => m.role !== 'system').length;
      expect(nonSystemCount).toBe(6); // 3 轮 × 2 = 6
    });
  });

  describe('工具精简', () => {
    it('工具数量超过 5 时应精简', () => {
      const optimizer = new PromptOptimizer();
      const tools = Array.from({ length: 8 }, (_, i) => ({
        type: 'function' as const,
        function: {
          name: `tool_${i}`,
          description: `Description for tool ${i}`,
          parameters: {},
        },
      }));

      const request: ChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Use tool_0 and tool_1 to help me' },
        ],
        tools,
      };

      const result = optimizer.optimize(request);
      expect(result.actions.some((a) => a.includes('Pruned'))).toBe(true);
    });
  });

  describe('Token 估算', () => {
    it('应估算 token 数', () => {
      const optimizer = new PromptOptimizer();
      const request: ChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'System prompt here.' },
          { role: 'user', content: 'Hello world' },
        ],
      };

      const tokens = optimizer.estimateTokens(request);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(100);
    });
  });

  describe('综合优化', () => {
    it('应返回完整的优化结果', () => {
      const optimizer = new PromptOptimizer({ maxTokenBudget: 100 });
      const request: ChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Be helpful.\n\n\n\nBe concise.' },
          { role: 'user', content: 'Tell  me  something' },
        ],
      };

      const result = optimizer.optimize(request);
      expect(result.originalTokenEstimate).toBeGreaterThan(0);
      expect(result.optimizedTokenEstimate).toBeLessThanOrEqual(result.originalTokenEstimate);
      expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
      expect(result.savingsPercent).toBeGreaterThanOrEqual(0);
      expect(result.savingsPercent).toBeLessThanOrEqual(1);
    });
  });
});
