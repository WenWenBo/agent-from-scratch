import { describe, it, expect, beforeEach } from 'vitest';
import { SkillManager } from '../skill-manager.js';
import { SkillRegistry } from '../skill-registry.js';
import { defineSkill } from '../skill.js';
import type { Skill } from '../skill.js';
import { z } from 'zod';

function makeSkill(overrides: Partial<Skill> & { metadata: Skill['metadata'] }): Skill {
  return {
    instructions: '默认指令',
    ...overrides,
  };
}

describe('SkillManager', () => {
  let registry: SkillRegistry;
  let manager: SkillManager;

  beforeEach(() => {
    registry = new SkillRegistry();
    registry.register(
      makeSkill({
        metadata: {
          name: 'code-review',
          description: '代码审查',
          triggers: ['review', '审查'],
        },
        instructions: '你是代码审查助手，使用 ${language} 审查代码',
        allowedTools: ['read_file', 'search'],
        caps: { maxTokens: 4096, temperature: 0.2 },
        promptVariables: { language: 'TypeScript' },
      }),
    );
    registry.register(
      makeSkill({
        metadata: {
          name: 'translator',
          description: '翻译助手',
          triggers: ['翻译', 'translate'],
        },
        instructions: '你是多语言翻译助手',
        caps: { maxTokens: 2048, temperature: 0.5, preferredModel: 'gpt-4' },
      }),
    );
    registry.register(
      makeSkill({
        metadata: {
          name: 'creative-writer',
          description: '创意写作',
          triggers: ['写作', 'write story'],
        },
        instructions: '你是创意写作助手',
        tools: [
          {
            name: 'generate_outline',
            description: '生成写作大纲',
            parameters: z.object({ topic: z.string() }),
            execute: async (params: { topic: string }) => `大纲: ${params.topic}`,
          },
        ],
      }),
    );

    manager = new SkillManager({ registry, maxActiveSkills: 3 });
  });

  // ============================================================
  // 激活 / 停用
  // ============================================================

  describe('activate / deactivate', () => {
    it('应成功激活技能', () => {
      manager.activate('code-review');
      expect(manager.isActive('code-review')).toBe(true);
      expect(manager.getActiveSkillNames()).toEqual(['code-review']);
    });

    it('重复激活应静默忽略', () => {
      manager.activate('code-review');
      manager.activate('code-review');
      expect(manager.getActiveSkills().length).toBe(1);
    });

    it('激活不存在的技能应抛出错误', () => {
      expect(() => manager.activate('nonexistent')).toThrow('not found');
    });

    it('超过最大激活数应抛出错误', () => {
      manager.activate('code-review');
      manager.activate('translator');
      manager.activate('creative-writer');
      expect(() => manager.activate('code-review')).not.toThrow();

      registry.register(
        makeSkill({ metadata: { name: 'extra', description: '额外' }, instructions: 'x' }),
      );
      expect(() => manager.activate('extra')).toThrow('maximum active skills');
    });

    it('应成功停用技能', () => {
      manager.activate('code-review');
      expect(manager.deactivate('code-review')).toBe(true);
      expect(manager.isActive('code-review')).toBe(false);
    });

    it('deactivateAll 应清除所有活跃技能', () => {
      manager.activate('code-review');
      manager.activate('translator');
      manager.deactivateAll();
      expect(manager.getActiveSkills().length).toBe(0);
    });
  });

  // ============================================================
  // 自动激活
  // ============================================================

  describe('autoActivate', () => {
    it('应根据触发词自动激活', () => {
      const activated = manager.autoActivate('请帮我审查代码');
      expect(activated).toEqual(['code-review']);
      expect(manager.isActive('code-review')).toBe(true);
    });

    it('应支持多技能同时触发', () => {
      const activated = manager.autoActivate('review and translate this');
      expect(activated.length).toBe(2);
      expect(activated).toContain('code-review');
      expect(activated).toContain('translator');
    });

    it('已激活的技能不应重复激活', () => {
      manager.activate('code-review');
      const activated = manager.autoActivate('请帮我审查代码');
      expect(activated.length).toBe(0);
    });

    it('达到上限后不再激活', () => {
      manager.activate('code-review');
      manager.activate('translator');
      manager.activate('creative-writer');
      const activated = manager.autoActivate('请帮我审查代码');
      expect(activated.length).toBe(0);
    });
  });

  // ============================================================
  // buildContext
  // ============================================================

  describe('buildContext', () => {
    const BASE_PROMPT = '你是 TinyAgent';

    it('无活跃技能时应返回原始 prompt', () => {
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.systemPrompt).toBe(BASE_PROMPT);
      expect(ctx.allowedTools).toBeNull();
      expect(ctx.skillTools.length).toBe(0);
      expect(ctx.caps).toEqual({});
    });

    it('应拼接活跃技能的 instructions', () => {
      manager.activate('code-review');
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.systemPrompt).toContain(BASE_PROMPT);
      expect(ctx.systemPrompt).toContain('<skill name="code-review">');
      expect(ctx.systemPrompt).toContain('你是代码审查助手');
    });

    it('应渲染 Prompt 模板变量', () => {
      manager.activate('code-review');
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.systemPrompt).toContain('使用 TypeScript 审查代码');
    });

    it('运行时变量应覆盖技能自身变量', () => {
      manager.activate('code-review', { language: 'Python' });
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.systemPrompt).toContain('使用 Python 审查代码');
    });

    it('应收集工具白名单', () => {
      manager.activate('code-review');
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.allowedTools).toEqual(['read_file', 'search']);
    });

    it('多技能时应合并工具白名单（去重）', () => {
      registry.register(
        makeSkill({
          metadata: { name: 'another', description: 'x' },
          instructions: 'x',
          allowedTools: ['search', 'write_file'],
        }),
      );
      // 需要提升 maxActiveSkills 或先清一个
      manager.deactivateAll();
      manager.activate('code-review');
      // 需要 extra slot
      const mgr2 = new SkillManager({ registry, maxActiveSkills: 5 });
      mgr2.activate('code-review');
      mgr2.activate('another');
      const ctx = mgr2.buildContext(BASE_PROMPT);
      expect(ctx.allowedTools).toContain('read_file');
      expect(ctx.allowedTools).toContain('search');
      expect(ctx.allowedTools).toContain('write_file');
      expect(new Set(ctx.allowedTools).size).toBe(ctx.allowedTools!.length);
    });

    it('无工具限制的技能不应产生白名单', () => {
      manager.activate('translator');
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.allowedTools).toBeNull();
    });

    it('应收集技能自带的工具', () => {
      manager.activate('creative-writer');
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.skillTools.length).toBe(1);
      expect(ctx.skillTools[0]!.name).toBe('generate_outline');
    });

    it('应合并 caps（maxTokens 取最大值）', () => {
      manager.activate('code-review');
      manager.activate('translator');
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.caps.maxTokens).toBe(4096);
    });

    it('应合并 caps（temperature 取后激活的）', () => {
      manager.activate('code-review');
      manager.activate('translator');
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.caps.temperature).toBe(0.5);
    });

    it('应合并 caps（preferredModel 取后激活的）', () => {
      manager.activate('code-review');
      manager.activate('translator');
      const ctx = manager.buildContext(BASE_PROMPT);
      expect(ctx.caps.preferredModel).toBe('gpt-4');
    });
  });
});
