/**
 * RateLimiter 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  describe('RPM 限制', () => {
    it('超过每分钟请求数应拦截', async () => {
      const limiter = new RateLimiter({ maxRequestsPerMinute: 3 });

      const r1 = await limiter.check('msg1');
      const r2 = await limiter.check('msg2');
      const r3 = await limiter.check('msg3');
      const r4 = await limiter.check('msg4');

      expect(r1.passed).toBe(true);
      expect(r2.passed).toBe(true);
      expect(r3.passed).toBe(true);
      expect(r4.passed).toBe(false);
      expect(r4.violations![0]!.type).toBe('rate_limit_rpm');
    });
  });

  describe('TPM 限制', () => {
    it('超过每分钟 Token 数应拦截', async () => {
      const limiter = new RateLimiter({
        maxTokensPerMinute: 50,
        charsPerToken: 1, // 简化：1 char = 1 token
      });

      // 40 tokens
      const r1 = await limiter.check('a'.repeat(40));
      expect(r1.passed).toBe(true);

      // 再来 20 tokens → 总计 60 > 50
      const r2 = await limiter.check('a'.repeat(20));
      expect(r2.passed).toBe(false);
      expect(r2.violations![0]!.type).toBe('rate_limit_tpm');
    });
  });

  describe('轮次限制', () => {
    it('超过最大轮次应拦截', async () => {
      const limiter = new RateLimiter({ maxTurnsPerSession: 2 });

      const r1 = await limiter.check('turn 1', { stage: 'input', userId: 'u1' });
      const r2 = await limiter.check('turn 2', { stage: 'input', userId: 'u1' });
      const r3 = await limiter.check('turn 3', { stage: 'input', userId: 'u1' });

      expect(r1.passed).toBe(true);
      expect(r2.passed).toBe(true);
      expect(r3.passed).toBe(false);
      expect(r3.violations![0]!.type).toBe('rate_limit_turns');
    });

    it('不同用户应独立计数', async () => {
      const limiter = new RateLimiter({ maxTurnsPerSession: 1 });

      const r1 = await limiter.check('msg', { stage: 'input', userId: 'u1' });
      const r2 = await limiter.check('msg', { stage: 'input', userId: 'u2' });

      expect(r1.passed).toBe(true);
      expect(r2.passed).toBe(true);
    });

    it('resetSession 应重置指定用户', async () => {
      const limiter = new RateLimiter({ maxTurnsPerSession: 1 });

      await limiter.check('msg', { stage: 'input', userId: 'u1' });
      const r1 = await limiter.check('msg', { stage: 'input', userId: 'u1' });
      expect(r1.passed).toBe(false);

      limiter.resetSession('u1');
      const r2 = await limiter.check('msg', { stage: 'input', userId: 'u1' });
      expect(r2.passed).toBe(true);
    });
  });

  describe('reset 全量重置', () => {
    it('reset 后所有计数器应清零', async () => {
      const limiter = new RateLimiter({
        maxRequestsPerMinute: 1,
        maxTurnsPerSession: 1,
      });

      await limiter.check('msg', { stage: 'input', userId: 'u1' });
      expect((await limiter.check('msg2', { stage: 'input', userId: 'u1' })).passed).toBe(false);

      limiter.reset();
      expect((await limiter.check('msg3', { stage: 'input', userId: 'u1' })).passed).toBe(true);
    });
  });

  describe('无限制', () => {
    it('默认配置（无限制）应放行', async () => {
      const limiter = new RateLimiter();

      for (let i = 0; i < 100; i++) {
        const r = await limiter.check(`message ${i}`);
        expect(r.passed).toBe(true);
      }
    });
  });
});
