import { describe, it, expect } from 'vitest';
import { defineSkill, renderInstructions } from '../skill.js';
import type { Skill } from '../skill.js';

// ============================================================
// defineSkill
// ============================================================

describe('defineSkill', () => {
  it('应返回传入的 Skill 配置', () => {
    const skill = defineSkill({
      metadata: { name: 'test-skill', description: '测试技能' },
      instructions: '你是一个测试助手',
    });

    expect(skill.metadata.name).toBe('test-skill');
    expect(skill.metadata.description).toBe('测试技能');
    expect(skill.instructions).toBe('你是一个测试助手');
  });

  it('没有 name 时应抛出错误', () => {
    expect(() =>
      defineSkill({
        metadata: { name: '', description: '测试' },
        instructions: 'test',
      }),
    ).toThrow('Skill must have a name and description');
  });

  it('没有 description 时应抛出错误', () => {
    expect(() =>
      defineSkill({
        metadata: { name: 'test', description: '' },
        instructions: 'test',
      }),
    ).toThrow('Skill must have a name and description');
  });

  it('应支持完整配置', () => {
    const skill = defineSkill({
      metadata: {
        name: 'full-skill',
        description: '完整配置技能',
        version: '1.0.0',
        tags: ['test', 'demo'],
        triggers: ['测试', 'test'],
        author: 'TinyAgent',
      },
      instructions: '指令内容',
      allowedTools: ['read_file', 'search'],
      caps: {
        maxTokens: 4096,
        temperature: 0.2,
        preferredModel: 'gpt-4',
      },
      promptVariables: { language: 'TypeScript' },
    });

    expect(skill.metadata.version).toBe('1.0.0');
    expect(skill.metadata.tags).toEqual(['test', 'demo']);
    expect(skill.allowedTools).toEqual(['read_file', 'search']);
    expect(skill.caps?.maxTokens).toBe(4096);
    expect(skill.promptVariables?.language).toBe('TypeScript');
  });
});

// ============================================================
// renderInstructions
// ============================================================

describe('renderInstructions', () => {
  it('应替换 ${variable} 占位符', () => {
    const result = renderInstructions(
      '你是一个 ${role}，使用 ${language} 编程',
      { role: '代码审查助手', language: 'TypeScript' },
    );
    expect(result).toBe('你是一个 代码审查助手，使用 TypeScript 编程');
  });

  it('运行时变量应覆盖技能自身变量', () => {
    const result = renderInstructions(
      '使用 ${language}',
      { language: 'Python' },
      { language: 'TypeScript' },
    );
    expect(result).toBe('使用 TypeScript');
  });

  it('未定义的变量应替换为空字符串', () => {
    const result = renderInstructions(
      '你好 ${name}，欢迎 ${place}',
      { name: '小明' },
    );
    expect(result).toBe('你好 小明，欢迎 ');
  });

  it('无变量时应返回原文', () => {
    const result = renderInstructions('没有变量的指令');
    expect(result).toBe('没有变量的指令');
  });

  it('应只替换 ${word} 格式，忽略其他模式', () => {
    const result = renderInstructions(
      '$name ${name} {name} $${name}',
      { name: 'test' },
    );
    expect(result).toBe('$name test {name} $test');
  });
});
