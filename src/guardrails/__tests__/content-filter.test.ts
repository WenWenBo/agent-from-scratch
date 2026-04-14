/**
 * ContentFilter 单元测试
 */

import { describe, it, expect } from 'vitest';
import { ContentFilter } from '../content-filter.js';

describe('ContentFilter', () => {
  it('正常内容应通过', async () => {
    const filter = new ContentFilter({
      blockedKeywords: ['bomb', 'weapon'],
    });

    const result = await filter.check('What is the weather today?');
    expect(result.passed).toBe(true);
    expect(result.violations).toBeUndefined();
  });

  it('包含黑名单关键词应拦截', async () => {
    const filter = new ContentFilter({
      blockedKeywords: ['bomb', 'weapon'],
    });

    const result = await filter.check('How to make a bomb at home');
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations![0]!.type).toBe('blocked_keyword');
    expect(result.violations![0]!.detail).toContain('bomb');
    expect(result.violations![0]!.position).toBeDefined();
  });

  it('关键词匹配应不区分大小写', async () => {
    const filter = new ContentFilter({
      blockedKeywords: ['dangerous'],
    });

    const result = await filter.check('This is DANGEROUS content');
    expect(result.passed).toBe(false);
  });

  it('正则模式应能匹配', async () => {
    const filter = new ContentFilter({
      blockedPatterns: [
        { pattern: /\b(hack|crack)\s+password/i, description: 'Password attack' },
      ],
    });

    const result = await filter.check('How to hack password for WiFi');
    expect(result.passed).toBe(false);
    expect(result.violations![0]!.detail).toBe('Password attack');
  });

  it('超长内容应触发长度限制', async () => {
    const filter = new ContentFilter({ maxContentLength: 50 });

    const result = await filter.check('a'.repeat(100));
    expect(result.passed).toBe(false);
    expect(result.violations![0]!.type).toBe('content_too_long');
  });

  it('多个违规项应全部报告', async () => {
    const filter = new ContentFilter({
      blockedKeywords: ['badword1', 'badword2'],
    });

    const result = await filter.check('This has badword1 and also badword2');
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('默认配置（无规则）应放行所有内容', async () => {
    const filter = new ContentFilter();
    const result = await filter.check('Any content here');
    expect(result.passed).toBe(true);
  });

  it('应记录检查耗时', async () => {
    const filter = new ContentFilter();
    const result = await filter.check('test');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.guardrailName).toBe('content-filter');
  });
});
