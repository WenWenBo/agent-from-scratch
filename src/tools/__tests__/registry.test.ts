/**
 * ToolRegistry 单元测试
 * 覆盖：注册、查找、Schema 导出、执行、参数校验、超时、并行执行
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import { defineTool } from '../tool.js';
import type { ToolCall } from '../../types.js';

// ============================================================
// 测试用工具
// ============================================================

const echoTool = defineTool({
  name: 'echo',
  description: '回显输入',
  parameters: z.object({
    message: z.string().describe('要回显的消息'),
  }),
  execute: async ({ message }) => ({ echo: message }),
});

const addTool = defineTool({
  name: 'add',
  description: '两数相加',
  parameters: z.object({
    a: z.number().describe('第一个数'),
    b: z.number().describe('第二个数'),
  }),
  execute: async ({ a, b }) => ({ result: a + b }),
});

const failTool = defineTool({
  name: 'fail',
  description: '总是失败的工具',
  parameters: z.object({}),
  execute: async () => {
    throw new Error('Intentional failure');
  },
});

const slowTool = defineTool({
  name: 'slow',
  description: '执行很慢的工具',
  parameters: z.object({}),
  execute: async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return { done: true };
  },
});

// ============================================================
// 测试
// ============================================================

describe('ToolRegistry', () => {
  // ----------------------------------------------------------
  // 注册与查找
  // ----------------------------------------------------------

  describe('注册与查找', () => {
    it('应成功注册工具', () => {
      const registry = new ToolRegistry();
      registry.register(echoTool);

      expect(registry.has('echo')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('应支持链式注册', () => {
      const registry = new ToolRegistry();
      registry.register(echoTool).register(addTool);

      expect(registry.size).toBe(2);
    });

    it('应支持批量注册', () => {
      const registry = new ToolRegistry();
      registry.registerMany([echoTool, addTool]);

      expect(registry.size).toBe(2);
      expect(registry.has('echo')).toBe(true);
      expect(registry.has('add')).toBe(true);
    });

    it('重复注册应抛出错误', () => {
      const registry = new ToolRegistry();
      registry.register(echoTool);

      expect(() => registry.register(echoTool)).toThrow(
        'Tool "echo" is already registered'
      );
    });

    it('get 应返回工具实例', () => {
      const registry = new ToolRegistry();
      registry.register(echoTool);

      const tool = registry.get('echo');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('echo');
    });

    it('get 不存在的工具应返回 undefined', () => {
      const registry = new ToolRegistry();
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('list 应返回所有工具', () => {
      const registry = new ToolRegistry();
      registry.registerMany([echoTool, addTool]);

      const tools = registry.list();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(['add', 'echo']);
    });
  });

  // ----------------------------------------------------------
  // Schema 导出
  // ----------------------------------------------------------

  describe('Schema 导出', () => {
    it('toDefinitions 应生成 ToolDefinition 数组', () => {
      const registry = new ToolRegistry();
      registry.registerMany([echoTool, addTool]);

      const defs = registry.toDefinitions();

      expect(defs).toHaveLength(2);
      expect(defs[0]!.type).toBe('function');
      expect(defs.map((d) => d.function.name).sort()).toEqual(['add', 'echo']);
    });

    it('空注册表应返回空数组', () => {
      const registry = new ToolRegistry();
      expect(registry.toDefinitions()).toEqual([]);
    });
  });

  // ----------------------------------------------------------
  // 工具执行
  // ----------------------------------------------------------

  describe('execute - 正常执行', () => {
    it('应成功执行工具并返回结果', async () => {
      const registry = new ToolRegistry();
      registry.register(echoTool);

      const toolCall: ToolCall = {
        id: 'call_1',
        function: { name: 'echo', arguments: '{"message":"hello"}' },
      };

      const result = await registry.execute(toolCall);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ echo: 'hello' });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('应正确传递参数', async () => {
      const registry = new ToolRegistry();
      registry.register(addTool);

      const result = await registry.execute({
        id: 'call_2',
        function: { name: 'add', arguments: '{"a":10,"b":20}' },
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ result: 30 });
    });
  });

  // ----------------------------------------------------------
  // 错误处理
  // ----------------------------------------------------------

  describe('execute - 错误处理', () => {
    it('工具不存在时应返回友好错误', async () => {
      const registry = new ToolRegistry();
      registry.register(echoTool);

      const result = await registry.execute({
        id: 'call_x',
        function: { name: 'nonexistent', arguments: '{}' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.error).toContain('echo'); // 提示可用工具列表
    });

    it('JSON 解析失败应返回友好错误', async () => {
      const registry = new ToolRegistry();
      registry.register(echoTool);

      const result = await registry.execute({
        id: 'call_y',
        function: { name: 'echo', arguments: 'not json' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('Zod 参数校验失败应返回详细错误', async () => {
      const registry = new ToolRegistry();
      registry.register(addTool);

      const result = await registry.execute({
        id: 'call_z',
        function: { name: 'add', arguments: '{"a":"not_a_number","b":10}' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
    });

    it('缺少必填参数应返回校验错误', async () => {
      const registry = new ToolRegistry();
      registry.register(echoTool);

      const result = await registry.execute({
        id: 'call_w',
        function: { name: 'echo', arguments: '{}' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
    });

    it('工具抛出异常应被捕获', async () => {
      const registry = new ToolRegistry();
      registry.register(failTool);

      const result = await registry.execute({
        id: 'call_fail',
        function: { name: 'fail', arguments: '{}' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Intentional failure');
    });
  });

  // ----------------------------------------------------------
  // 超时控制
  // ----------------------------------------------------------

  describe('execute - 超时', () => {
    it('超过超时时间应返回超时错误', async () => {
      const registry = new ToolRegistry({ executionTimeout: 100 });
      registry.register(slowTool);

      const result = await registry.execute({
        id: 'call_slow',
        function: { name: 'slow', arguments: '{}' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.error).toContain('100ms');
    });
  });

  // ----------------------------------------------------------
  // 并行执行
  // ----------------------------------------------------------

  describe('executeMany - 并行执行', () => {
    it('应并行执行多个工具调用', async () => {
      const registry = new ToolRegistry();
      registry.registerMany([echoTool, addTool]);

      const toolCalls: ToolCall[] = [
        { id: 'call_a', function: { name: 'echo', arguments: '{"message":"hi"}' } },
        { id: 'call_b', function: { name: 'add', arguments: '{"a":1,"b":2}' } },
      ];

      const results = await registry.executeMany(toolCalls);

      expect(results.size).toBe(2);
      expect(results.get('call_a')!.success).toBe(true);
      expect(results.get('call_a')!.result).toEqual({ echo: 'hi' });
      expect(results.get('call_b')!.success).toBe(true);
      expect(results.get('call_b')!.result).toEqual({ result: 3 });
    });

    it('部分失败不应影响其他工具', async () => {
      const registry = new ToolRegistry();
      registry.registerMany([echoTool, failTool]);

      const toolCalls: ToolCall[] = [
        { id: 'call_ok', function: { name: 'echo', arguments: '{"message":"ok"}' } },
        { id: 'call_fail', function: { name: 'fail', arguments: '{}' } },
      ];

      const results = await registry.executeMany(toolCalls);

      expect(results.get('call_ok')!.success).toBe(true);
      expect(results.get('call_fail')!.success).toBe(false);
    });
  });
});
