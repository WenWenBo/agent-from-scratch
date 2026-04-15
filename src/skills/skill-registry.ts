/**
 * SkillRegistry -- 技能注册中心
 *
 * 只负责 存储 和 发现，不涉及运行时状态。
 * 支持按名称精确查找、按标签搜索、按触发词匹配。
 */

import type { Skill } from './skill.js';

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  // ============================================================
  // 注册 / 注销
  // ============================================================

  register(skill: Skill): void {
    const name = skill.metadata.name;
    if (this.skills.has(name)) {
      throw new Error(`Skill "${name}" is already registered`);
    }
    this.skills.set(name, skill);
  }

  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  // ============================================================
  // 查询
  // ============================================================

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** 列出所有技能的元数据摘要（轻量） */
  listMetadata(): Array<{ name: string; description: string; tags?: string[] }> {
    return this.listAll().map(s => ({
      name: s.metadata.name,
      description: s.metadata.description,
      tags: s.metadata.tags,
    }));
  }

  // ============================================================
  // 搜索
  // ============================================================

  /** 按标签搜索 */
  searchByTag(tag: string): Skill[] {
    return this.listAll().filter(
      s => s.metadata.tags?.includes(tag),
    );
  }

  /** 按触发关键词匹配（返回所有匹配的技能） */
  findByTrigger(userInput: string): Skill[] {
    const lower = userInput.toLowerCase();
    return this.listAll().filter(s => {
      if (!s.metadata.triggers || s.metadata.triggers.length === 0) return false;
      return s.metadata.triggers.some(t => lower.includes(t.toLowerCase()));
    });
  }

  /** 按关键词模糊搜索 name / description */
  search(keyword: string): Skill[] {
    const lower = keyword.toLowerCase();
    return this.listAll().filter(s =>
      s.metadata.name.toLowerCase().includes(lower)
      || s.metadata.description.toLowerCase().includes(lower),
    );
  }

  get size(): number {
    return this.skills.size;
  }

  clear(): void {
    this.skills.clear();
  }
}
