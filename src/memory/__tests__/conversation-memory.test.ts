/**
 * ConversationMemory 单元测试
 */

import { describe, it, expect } from 'vitest';
import type { Message } from '../../types.js';
import { ConversationMemory } from '../conversation-memory.js';
import { TokenBudgetStrategy } from '../window-strategies.js';

describe('ConversationMemory', () => {
  // ----------------------------------------------------------
  // 基础消息管理
  // ----------------------------------------------------------

  describe('消息管理', () => {
    it('应添加并返回消息', () => {
      const mem = new ConversationMemory({ systemPrompt: 'You are a helper.' });
      mem.addMessage({ role: 'user', content: '你好' });
      mem.addMessage({ role: 'assistant', content: '你好！' });

      expect(mem.getMessages()).toHaveLength(2);
      expect(mem.getMessageCount()).toBe(2);
    });

    it('应忽略 system 消息', () => {
      const mem = new ConversationMemory({ systemPrompt: 'test' });
      mem.addMessage({ role: 'system', content: 'should be ignored' });
      expect(mem.getMessages()).toHaveLength(0);
    });

    it('批量添加应过滤 system 消息', () => {
      const mem = new ConversationMemory({ systemPrompt: 'test' });
      const messages: Message[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ];
      mem.addMessages(messages);
      expect(mem.getMessages()).toHaveLength(2);
    });

    it('clear 应清空消息和摘要', () => {
      const mem = new ConversationMemory({ systemPrompt: 'test' });
      mem.addMessage({ role: 'user', content: 'hi' });
      mem.setSummary('summary', 5);
      mem.clear();
      expect(mem.getMessages()).toHaveLength(0);
      expect(mem.getSummary()).toBeNull();
    });

    it('getMessages 应返回副本', () => {
      const mem = new ConversationMemory({ systemPrompt: 'test' });
      mem.addMessage({ role: 'user', content: 'hi' });
      const msgs = mem.getMessages();
      msgs.push({ role: 'user', content: 'injected' });
      expect(mem.getMessages()).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------
  // 上下文构建
  // ----------------------------------------------------------

  describe('getContextMessages', () => {
    it('应在消息前加上 system prompt', () => {
      const mem = new ConversationMemory({ systemPrompt: 'I am an AI.' });
      mem.addMessage({ role: 'user', content: '你好' });

      const ctx = mem.getContextMessages();
      expect(ctx).toHaveLength(2);
      expect(ctx[0]).toEqual({ role: 'system', content: 'I am an AI.' });
      expect(ctx[1]).toEqual({ role: 'user', content: '你好' });
    });

    it('消息数超过 maxMessages 时应裁剪', () => {
      const mem = new ConversationMemory({
        systemPrompt: 'test',
        maxMessages: 3,
      });

      for (let i = 0; i < 10; i++) {
        mem.addMessage({ role: 'user', content: `msg ${i}` });
      }

      const ctx = mem.getContextMessages();
      // system + 最近 3 条
      expect(ctx).toHaveLength(4);
      expect(ctx[1]).toEqual({ role: 'user', content: 'msg 7' });
    });

    it('有摘要时应注入 system 消息', () => {
      const mem = new ConversationMemory({ systemPrompt: 'Base prompt.' });
      mem.addMessage({ role: 'user', content: 'hi' });
      mem.setSummary('User asked about weather.', 5);

      const ctx = mem.getContextMessages();
      const sys = ctx[0]!;
      expect(sys.role).toBe('system');
      if (sys.role === 'system') {
        expect(sys.content).toContain('Base prompt.');
        expect(sys.content).toContain('User asked about weather.');
        expect(sys.content).toContain('[Previous conversation summary]');
      }
    });

    it('应支持自定义窗口策略', () => {
      const mem = new ConversationMemory({
        systemPrompt: 'test',
        windowStrategy: new TokenBudgetStrategy(50),
      });

      for (let i = 0; i < 20; i++) {
        mem.addMessage({ role: 'user', content: `这是一条测试消息 ${i}` });
      }

      const ctx = mem.getContextMessages();
      // token 预算限制，不会返回全部 20 条
      expect(ctx.length).toBeLessThan(22);
      expect(ctx.length).toBeGreaterThan(1); // 至少 system + 1 条
    });
  });

  // ----------------------------------------------------------
  // 摘要
  // ----------------------------------------------------------

  describe('摘要管理', () => {
    it('setSummary 和 getSummary 应正确工作', () => {
      const mem = new ConversationMemory({ systemPrompt: 'test' });
      mem.setSummary('This is a summary.', 10);

      const summary = mem.getSummary();
      expect(summary).not.toBeNull();
      expect(summary!.content).toBe('This is a summary.');
      expect(summary!.messageCount).toBe(10);
      expect(summary!.createdAt).toBeGreaterThan(0);
    });

    it('prepareForSummarization 应分离需要摘要的消息', () => {
      const mem = new ConversationMemory({ systemPrompt: 'test' });

      for (let i = 0; i < 10; i++) {
        mem.addMessage({ role: 'user', content: `msg ${i}` });
      }

      const toSummarize = mem.prepareForSummarization(4);
      expect(toSummarize).not.toBeNull();
      expect(toSummarize!).toHaveLength(6); // 10 - 4 = 6 条需要摘要
      expect(mem.getMessages()).toHaveLength(4); // 保留最近 4 条
      expect(mem.getMessages()[0]).toEqual({ role: 'user', content: 'msg 6' });
    });

    it('消息数不足时 prepareForSummarization 应返回 null', () => {
      const mem = new ConversationMemory({ systemPrompt: 'test' });
      mem.addMessage({ role: 'user', content: 'hi' });

      const result = mem.prepareForSummarization(5);
      expect(result).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // System Prompt 管理
  // ----------------------------------------------------------

  describe('System Prompt', () => {
    it('应支持动态更新', () => {
      const mem = new ConversationMemory({ systemPrompt: 'original' });
      mem.setSystemPrompt('updated');
      expect(mem.getSystemPrompt()).toBe('updated');

      const ctx = mem.getContextMessages();
      if (ctx[0]!.role === 'system') {
        expect(ctx[0]!.content).toBe('updated');
      }
    });
  });
});
