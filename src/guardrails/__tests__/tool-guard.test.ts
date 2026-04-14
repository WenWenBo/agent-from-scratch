/**
 * ToolCallGuard 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCallGuard } from '../tool-guard.js';

describe('ToolCallGuard', () => {
  describe('白名单/黑名单', () => {
    it('黑名单工具应被拦截', () => {
      const guard = new ToolCallGuard({
        blockedTools: ['exec_shell', 'delete_all'],
      });

      const r1 = guard.check('exec_shell', { command: 'rm -rf /' });
      expect(r1.allowed).toBe(false);
      expect(r1.reason).toContain('blocked');

      const r2 = guard.check('read_file', { path: '/etc/passwd' });
      expect(r2.allowed).toBe(true);
    });

    it('不在白名单中的工具应被拦截', () => {
      const guard = new ToolCallGuard({
        allowedTools: ['calculator', 'search'],
      });

      const r1 = guard.check('calculator', { a: 1, b: 2 });
      expect(r1.allowed).toBe(true);

      const r2 = guard.check('exec_shell', { command: 'ls' });
      expect(r2.allowed).toBe(false);
      expect(r2.reason).toContain('not in the allowed list');
    });
  });

  describe('参数安全规则', () => {
    it('应拦截危险参数值', () => {
      const guard = new ToolCallGuard({
        parameterRules: [
          {
            toolName: 'read_file',
            paramPath: 'path',
            blockedPattern: /\.\.\//,
            reason: 'Path traversal detected',
          },
          {
            toolName: '*',
            paramPath: 'command',
            blockedPattern: /rm\s+-rf/,
            reason: 'Destructive command detected',
          },
        ],
      });

      const r1 = guard.check('read_file', { path: '../../etc/passwd' });
      expect(r1.allowed).toBe(false);
      expect(r1.reason).toBe('Path traversal detected');

      const r2 = guard.check('exec', { command: 'rm -rf /' });
      expect(r2.allowed).toBe(false);
      expect(r2.reason).toBe('Destructive command detected');

      const r3 = guard.check('read_file', { path: '/safe/file.txt' });
      expect(r3.allowed).toBe(true);
    });

    it('应支持嵌套参数路径', () => {
      const guard = new ToolCallGuard({
        parameterRules: [
          {
            toolName: 'api_call',
            paramPath: 'config.url',
            blockedPattern: /localhost|127\.0\.0\.1/,
            reason: 'Local network access not allowed',
          },
        ],
      });

      const r1 = guard.check('api_call', { config: { url: 'http://localhost:3000' } });
      expect(r1.allowed).toBe(false);

      const r2 = guard.check('api_call', { config: { url: 'https://api.example.com' } });
      expect(r2.allowed).toBe(true);
    });
  });

  describe('人工确认标记', () => {
    it('需要确认的工具应标记 requiresConfirmation', () => {
      const guard = new ToolCallGuard({
        requireConfirmation: ['delete_file', 'send_email'],
      });

      const r1 = guard.check('delete_file', { path: '/tmp/test' });
      expect(r1.allowed).toBe(true);
      expect(r1.requiresConfirmation).toBe(true);

      const r2 = guard.check('read_file', { path: '/tmp/test' });
      expect(r2.allowed).toBe(true);
      expect(r2.requiresConfirmation).toBeUndefined();
    });
  });

  describe('速率限制', () => {
    it('超过每分钟限制应拦截', () => {
      const guard = new ToolCallGuard({ maxCallsPerMinute: 3 });

      expect(guard.check('tool1', {}).allowed).toBe(true);
      expect(guard.check('tool2', {}).allowed).toBe(true);
      expect(guard.check('tool3', {}).allowed).toBe(true);
      expect(guard.check('tool4', {}).allowed).toBe(false);
    });

    it('重置速率限制后应恢复', () => {
      const guard = new ToolCallGuard({ maxCallsPerMinute: 1 });

      expect(guard.check('tool', {}).allowed).toBe(true);
      expect(guard.check('tool', {}).allowed).toBe(false);

      guard.resetRateLimit();
      expect(guard.check('tool', {}).allowed).toBe(true);
    });
  });

  describe('无配置', () => {
    it('默认配置应放行所有调用', () => {
      const guard = new ToolCallGuard();

      const result = guard.check('any_tool', { any: 'param' });
      expect(result.allowed).toBe(true);
    });
  });
});
