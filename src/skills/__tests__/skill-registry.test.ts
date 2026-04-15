import { describe, it, expect, beforeEach } from 'vitest';
import { SkillRegistry } from '../skill-registry.js';
import type { Skill } from '../skill.js';

function createSkill(overrides: Partial<Skill> & { metadata: Skill['metadata'] }): Skill {
  return {
    instructions: '默认指令',
    ...overrides,
  };
}

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  // ============================================================
  // 注册 / 注销
  // ============================================================

  describe('register / unregister', () => {
    it('应成功注册技能', () => {
      const skill = createSkill({
        metadata: { name: 'code-review', description: '代码审查' },
      });
      registry.register(skill);
      expect(registry.size).toBe(1);
      expect(registry.has('code-review')).toBe(true);
    });

    it('重复注册应抛出错误', () => {
      const skill = createSkill({
        metadata: { name: 'dup', description: '重复' },
      });
      registry.register(skill);
      expect(() => registry.register(skill)).toThrow('already registered');
    });

    it('注销已存在的技能应返回 true', () => {
      registry.register(
        createSkill({ metadata: { name: 'temp', description: '临时' } }),
      );
      expect(registry.unregister('temp')).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('注销不存在的技能应返回 false', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  // ============================================================
  // 查询
  // ============================================================

  describe('get / has / listAll / listMetadata', () => {
    beforeEach(() => {
      registry.register(
        createSkill({
          metadata: { name: 'alpha', description: '技能A', tags: ['code'] },
        }),
      );
      registry.register(
        createSkill({
          metadata: { name: 'beta', description: '技能B', tags: ['test'] },
        }),
      );
    });

    it('get 应返回正确的技能', () => {
      expect(registry.get('alpha')?.metadata.description).toBe('技能A');
    });

    it('get 不存在的技能应返回 undefined', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('listAll 应返回所有技能', () => {
      expect(registry.listAll().length).toBe(2);
    });

    it('listMetadata 应返回轻量摘要', () => {
      const meta = registry.listMetadata();
      expect(meta).toEqual([
        { name: 'alpha', description: '技能A', tags: ['code'] },
        { name: 'beta', description: '技能B', tags: ['test'] },
      ]);
    });
  });

  // ============================================================
  // 搜索
  // ============================================================

  describe('搜索功能', () => {
    beforeEach(() => {
      registry.register(
        createSkill({
          metadata: {
            name: 'code-review',
            description: '自动代码审查',
            tags: ['code', 'review'],
            triggers: ['review', '审查', 'code review'],
          },
        }),
      );
      registry.register(
        createSkill({
          metadata: {
            name: 'test-writer',
            description: '自动编写测试用例',
            tags: ['test', 'code'],
            triggers: ['测试', 'test', 'write test'],
          },
        }),
      );
      registry.register(
        createSkill({
          metadata: {
            name: 'translator',
            description: '多语言翻译',
            tags: ['language'],
            triggers: ['翻译', 'translate'],
          },
        }),
      );
    });

    it('searchByTag 应按标签搜索', () => {
      const codeSkills = registry.searchByTag('code');
      expect(codeSkills.length).toBe(2);
      expect(codeSkills.map(s => s.metadata.name)).toContain('code-review');
      expect(codeSkills.map(s => s.metadata.name)).toContain('test-writer');
    });

    it('searchByTag 无匹配时应返回空数组', () => {
      expect(registry.searchByTag('nonexistent').length).toBe(0);
    });

    it('findByTrigger 应按触发词匹配', () => {
      const matched = registry.findByTrigger('请帮我审查这段代码');
      expect(matched.length).toBe(1);
      expect(matched[0]!.metadata.name).toBe('code-review');
    });

    it('findByTrigger 应支持多技能匹配', () => {
      const matched = registry.findByTrigger('review code and write test');
      expect(matched.length).toBe(2);
    });

    it('findByTrigger 应大小写不敏感', () => {
      const matched = registry.findByTrigger('请 TRANSLATE 这段话');
      expect(matched.length).toBe(1);
      expect(matched[0]!.metadata.name).toBe('translator');
    });

    it('search 应模糊搜索 name 和 description', () => {
      const byName = registry.search('review');
      expect(byName.length).toBe(1);
      expect(byName[0]!.metadata.name).toBe('code-review');

      const byDesc = registry.search('翻译');
      expect(byDesc.length).toBe(1);
      expect(byDesc[0]!.metadata.name).toBe('translator');
    });
  });

  // ============================================================
  // clear
  // ============================================================

  describe('clear', () => {
    it('应清除所有技能', () => {
      registry.register(
        createSkill({ metadata: { name: 'a', description: 'A' } }),
      );
      registry.register(
        createSkill({ metadata: { name: 'b', description: 'B' } }),
      );
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });
});
