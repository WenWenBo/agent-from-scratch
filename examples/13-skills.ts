/**
 * Chapter 13 示例：技能系统（Skills System）
 *
 * 演示：
 * 1. 定义技能（代码级 defineSkill）
 * 2. 从文件系统加载技能（SkillLoader）
 * 3. 技能注册中心（SkillRegistry）的搜索能力
 * 4. SkillManager 的激活/停用和上下文构建
 * 5. SkillfulAgent 的自动路由
 *
 * 运行：npx tsx examples/13-skills.ts
 */

import {
  defineSkill,
  renderInstructions,
  SkillRegistry,
  SkillManager,
  SkillLoader,
} from '../src/skills/index.js';
import { z } from 'zod';
import * as path from 'path';

async function main() {
  console.log('=== Chapter 13: 技能系统 ===\n');

  // ============================================================
  // 1. 定义技能（代码级）
  // ============================================================

  console.log('--- 1. 代码级技能定义 ---\n');

  const codeReviewSkill = defineSkill({
    metadata: {
      name: 'code-review',
      description: '自动代码审查',
      version: '1.0.0',
      tags: ['code', 'review'],
      triggers: ['review', '审查', 'code review'],
    },
    instructions: '你是代码审查助手，专注 ${language} 代码质量分析。\n严重级别：${severity_levels}',
    allowedTools: ['read_file', 'search'],
    caps: {
      maxTokens: 4096,
      temperature: 0.1,
    },
    promptVariables: {
      language: 'TypeScript',
      severity_levels: 'critical, warning, info',
    },
  });

  console.log(`技能名: ${codeReviewSkill.metadata.name}`);
  console.log(`描述: ${codeReviewSkill.metadata.description}`);
  console.log(`触发词: ${codeReviewSkill.metadata.triggers?.join(', ')}`);
  console.log(`工具白名单: ${codeReviewSkill.allowedTools?.join(', ')}`);

  // ============================================================
  // 2. Prompt 模板渲染
  // ============================================================

  console.log('\n--- 2. Prompt 模板渲染 ---\n');

  const rendered = renderInstructions(
    codeReviewSkill.instructions,
    codeReviewSkill.promptVariables,
  );
  console.log('默认渲染:', rendered);

  const customRendered = renderInstructions(
    codeReviewSkill.instructions,
    codeReviewSkill.promptVariables,
    { language: 'Python' },
  );
  console.log('运行时覆盖:', customRendered);

  // ============================================================
  // 3. 技能注册中心
  // ============================================================

  console.log('\n--- 3. 技能注册中心 ---\n');

  const registry = new SkillRegistry();

  registry.register(codeReviewSkill);
  registry.register(
    defineSkill({
      metadata: {
        name: 'translator',
        description: '多语言翻译',
        tags: ['language'],
        triggers: ['翻译', 'translate'],
      },
      instructions: '你是翻译助手',
      caps: { maxTokens: 2048, temperature: 0.3, preferredModel: 'gpt-4' },
    }),
  );
  registry.register(
    defineSkill({
      metadata: {
        name: 'test-writer',
        description: '自动编写测试用例',
        tags: ['code', 'test'],
        triggers: ['测试', 'test', 'write test'],
      },
      instructions: '你是测试专家',
      tools: [
        {
          name: 'run_test',
          description: '运行测试',
          parameters: z.object({ testFile: z.string() }),
          execute: async (params: { testFile: string }) => `测试结果: ${params.testFile} PASSED`,
        },
      ],
    }),
  );

  console.log(`已注册技能: ${registry.size} 个`);

  // 元数据摘要
  console.log('\n技能元数据摘要:');
  for (const meta of registry.listMetadata()) {
    console.log(`  - ${meta.name}: ${meta.description} [${meta.tags?.join(', ')}]`);
  }

  // 按标签搜索
  console.log('\n标签搜索 "code":', registry.searchByTag('code').map(s => s.metadata.name));

  // 触发词匹配
  console.log('触发词匹配 "请帮我审查代码":', registry.findByTrigger('请帮我审查代码').map(s => s.metadata.name));
  console.log('触发词匹配 "translate this":', registry.findByTrigger('translate this').map(s => s.metadata.name));

  // ============================================================
  // 4. SkillManager 运行时管理
  // ============================================================

  console.log('\n--- 4. SkillManager 运行时管理 ---\n');

  const manager = new SkillManager({ registry, maxActiveSkills: 3 });

  // 手动激活
  manager.activate('code-review');
  console.log('活跃技能:', manager.getActiveSkillNames());

  // 自动激活
  const autoActivated = manager.autoActivate('请帮我翻译这段代码');
  console.log('自动激活:', autoActivated);
  console.log('当前活跃:', manager.getActiveSkillNames());

  // 构建增强上下文
  const ctx = manager.buildContext('你是 TinyAgent 助手');
  console.log('\n增强后的 System Prompt:');
  console.log(ctx.systemPrompt.substring(0, 200) + '...');
  console.log('\n工具白名单:', ctx.allowedTools);
  console.log('Caps:', JSON.stringify(ctx.caps, null, 2));

  // 停用
  manager.deactivate('translator');
  console.log('\n停用 translator 后:', manager.getActiveSkillNames());
  manager.deactivateAll();
  console.log('全部停用后:', manager.getActiveSkillNames());

  // ============================================================
  // 5. 文件系统加载
  // ============================================================

  console.log('\n--- 5. 文件系统加载 ---\n');

  const loader = new SkillLoader();
  const skillsDir = path.resolve(import.meta.dirname ?? '.', 'skills');

  try {
    const skills = await loader.loadAllFromDirectory(skillsDir);
    console.log(`从 ${skillsDir} 加载了 ${skills.length} 个技能:`);

    for (const skill of skills) {
      console.log(`  - ${skill.metadata.name} v${skill.metadata.version ?? '?'}`);
      console.log(`    描述: ${skill.metadata.description}`);
      console.log(`    标签: ${skill.metadata.tags?.join(', ') ?? '无'}`);
      console.log(`    触发词: ${skill.metadata.triggers?.join(', ') ?? '无'}`);
      if (skill.caps) console.log(`    Caps: ${JSON.stringify(skill.caps)}`);
      if (skill.resources?.length) {
        console.log(`    资源: ${skill.resources.map(r => r.name).join(', ')}`);
      }
      console.log();
    }

    // 加载后注册
    const fileRegistry = new SkillRegistry();
    for (const skill of skills) {
      fileRegistry.register(skill);
    }
    console.log(`文件注册中心: ${fileRegistry.size} 个技能`);

  } catch (err) {
    console.log(`加载技能目录失败: ${err}`);
  }

  // ============================================================
  // 6. 渐进式披露演示
  // ============================================================

  console.log('\n--- 6. 渐进式披露 ---\n');

  console.log('第 1 层（元数据）—— 30-50 tokens，启动时全量加载:');
  for (const meta of registry.listMetadata()) {
    console.log(`  ${meta.name}: ${meta.description}`);
  }

  console.log('\n第 2 层（指令内容）—— 匹配时才加载:');
  const matched = registry.findByTrigger('请帮我审查');
  if (matched.length > 0) {
    const skill = matched[0]!;
    const instructions = renderInstructions(
      skill.instructions,
      skill.promptVariables,
    );
    console.log(`  加载 ${skill.metadata.name} 的 instructions:`);
    console.log(`  ${instructions.substring(0, 100)}...`);
  }

  console.log('\n第 3 层（扩展资源）—— 显式需要时才加载:');
  console.log('  资源文件在首次 loadResource() 时才从磁盘读取');

  console.log('\n=== 完成 ===');
}

main().catch(console.error);
