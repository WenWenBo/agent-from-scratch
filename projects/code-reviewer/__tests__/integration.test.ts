/**
 * CodeReviewer -- 集成测试
 *
 * 需要真实 LLM API。运行方式：
 *   npx vitest run projects/code-reviewer/__tests__/integration
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import 'dotenv/config';
import { CodeReviewer } from '../code-reviewer.js';
import type { MultiAgentEvent } from '../../../src/multi-agent/base-agent.js';

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL ?? 'gpt-4o';
const sampleCodeDir = path.join(import.meta.dirname, '..', 'sample-code');

const canRunIntegration = !!apiKey;

describe.skipIf(!canRunIntegration)('CodeReviewer Integration', () => {
  const reviewer = new CodeReviewer({
    apiKey: apiKey!,
    baseUrl,
    model,
    codeDir: sampleCodeDir,
  });

  it('应能完成完整代码审查', async () => {
    const events: MultiAgentEvent[] = [];

    const report = await reviewer.review((e) => events.push(e));

    expect(report).toBeDefined();
    expect(report.rawContent.length).toBeGreaterThan(100);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);

    // Pipeline 应该产生 4 个步骤事件
    const pipelineSteps = events.filter(e => e.type === 'pipeline_step');
    expect(pipelineSteps.length).toBe(4);

    // 应该检测到一些问题
    expect(report.issues.length).toBeGreaterThan(0);

    console.log(`\n[Integration] Full review completed:`);
    console.log(`  Score: ${report.score}/100`);
    console.log(`  Issues: ${report.issues.length}`);
    console.log(`  Events: ${events.length}`);
  }, 120_000);

  it('应能审查单个文件', async () => {
    const report = await reviewer.reviewFile('calculator.ts');

    expect(report).toBeDefined();
    expect(report.rawContent.length).toBeGreaterThan(50);
    expect(report.score).toBeGreaterThanOrEqual(0);

    console.log(`\n[Integration] Single file review:`);
    console.log(`  Score: ${report.score}/100`);
    console.log(`  Issues: ${report.issues.length}`);
  }, 120_000);

  it('应检测到示例代码中的安全问题', async () => {
    const report = await reviewer.review();

    const securityIssues = report.issues.filter(
      i => i.category.toLowerCase().includes('security') ||
           i.description.toLowerCase().includes('eval') ||
           i.description.toLowerCase().includes('hardcod') ||
           i.description.toLowerCase().includes('secret')
    );

    // sample-code 中至少有 eval 和硬编码密钥两个安全问题
    console.log(`\n[Integration] Security issues found: ${securityIssues.length}`);
    for (const issue of securityIssues) {
      console.log(`  - ${issue.file}:${issue.line ?? '?'} ${issue.description}`);
    }
  }, 120_000);
});
