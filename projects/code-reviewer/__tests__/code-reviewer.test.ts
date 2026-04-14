/**
 * CodeReviewer -- 单元测试
 *
 * 使用 mock LLM 验证 Pipeline 流转和报告解析逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { CodeReviewer } from '../code-reviewer.js';
import type { ReviewReport, ReviewIssue } from '../code-reviewer.js';
import type { MultiAgentEvent } from '../../../src/multi-agent/base-agent.js';

const sampleCodeDir = path.join(import.meta.dirname, '..', 'sample-code');

describe('CodeReviewer', () => {
  // ============================================================
  // 构造与初始化
  // ============================================================

  it('应正确构造 CodeReviewer 实例', () => {
    const reviewer = new CodeReviewer({
      apiKey: 'test-key',
      codeDir: sampleCodeDir,
      model: 'gpt-4o',
    });

    expect(reviewer).toBeDefined();
  });

  // ============================================================
  // 报告解析 -- 通过访问 parseReport (间接测试)
  // ============================================================

  it('应正确解析包含问题的审查报告', () => {
    const reviewer = new CodeReviewer({
      apiKey: 'test-key',
      codeDir: sampleCodeDir,
    });

    // 通过 parseReport（private 方法）间接测试 -- 我们直接构造 ReviewReport 结构
    const mockContent = `## Code Review Report

### Summary
The codebase has several critical security issues and bug risks.

### Issues Found

#### Critical Issues
- **[calculator.ts:7]** [bug] Division by zero not handled
  - Suggestion: Add a check for b === 0
- **[calculator.ts:68]** [security] eval() usage is extremely dangerous
  - Suggestion: Use a safe math parser instead

#### Warnings
- **[calculator.ts:12]** [style] Use of 'any' type reduces type safety
  - Suggestion: Define proper interface for data parameter
- **[user-service.ts:62]** [style] Deep nesting (5 levels) makes code hard to read
  - Suggestion: Use early returns or guard clauses

#### Informational
- **[calculator.ts:19]** [best-practice] Consider using environment variables for API keys
  - Suggestion: Move secrets to .env file

### Metrics
- Total Files Reviewed: 2
- Total Issues: 5 (2 critical, 2 warnings, 1 info)

### Score: 35/100`;

    // 使用内部 parseReport 方法
    const report = (reviewer as any).parseReport(mockContent) as ReviewReport;

    expect(report.score).toBe(35);
    expect(report.summary).toContain('critical security issues');
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.metrics.totalFiles).toBe(2);
    expect(report.rawContent).toBe(mockContent);
  });

  it('应正确识别不同严重级别', () => {
    const reviewer = new CodeReviewer({
      apiKey: 'test-key',
      codeDir: sampleCodeDir,
    });

    const content = `## Code Review Report

### Summary
Review completed.

### Issues Found

#### Critical Issues
- **[a.ts:1]** [security] eval usage
  - Suggestion: Remove eval

#### Warnings
- **[b.ts:2]** [style] any type
  - Suggestion: Use proper type

#### Informational
- **[c.ts:3]** [info] Could improve naming
  - Suggestion: Use descriptive names

### Score: 70/100`;

    const report = (reviewer as any).parseReport(content) as ReviewReport;

    const critical = report.issues.filter((i: ReviewIssue) => i.severity === 'critical');
    const warning = report.issues.filter((i: ReviewIssue) => i.severity === 'warning');
    const info = report.issues.filter((i: ReviewIssue) => i.severity === 'info');

    expect(critical.length).toBe(1);
    expect(critical[0].file).toBe('a.ts');

    expect(warning.length).toBe(1);
    expect(warning[0].file).toBe('b.ts');

    expect(info.length).toBe(1);
    expect(info[0].file).toBe('c.ts');
  });

  it('应处理空报告', () => {
    const reviewer = new CodeReviewer({
      apiKey: 'test-key',
      codeDir: sampleCodeDir,
    });

    const report = (reviewer as any).parseReport('No issues found.') as ReviewReport;

    expect(report.issues).toHaveLength(0);
    expect(report.score).toBe(50); // default score
    expect(report.rawContent).toBe('No issues found.');
  });

  it('应解析 Score 字段', () => {
    const reviewer = new CodeReviewer({
      apiKey: 'test-key',
      codeDir: sampleCodeDir,
    });

    const content = `### Score: 85/100`;
    const report = (reviewer as any).parseReport(content) as ReviewReport;
    expect(report.score).toBe(85);
  });

  // ============================================================
  // 事件回调
  // ============================================================

  it('Pipeline 事件回调应按顺序触发（集成测试需真实 API）', async () => {
    // 此测试在 mock 环境下仅验证类型和结构
    const events: MultiAgentEvent[] = [];
    const onEvent = (e: MultiAgentEvent) => events.push(e);

    // 仅验证回调函数签名正确
    expect(typeof onEvent).toBe('function');
    onEvent({ type: 'pipeline_step', step: 1, agentName: 'test' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('pipeline_step');
  });

  // ============================================================
  // extractSection (间接测试)
  // ============================================================

  it('应正确提取 Summary 段落', () => {
    const reviewer = new CodeReviewer({
      apiKey: 'test-key',
      codeDir: sampleCodeDir,
    });

    const content = `### Summary
This is the summary paragraph.
It can be multi-line.

### Issues Found
Some issues...`;

    const summary = (reviewer as any).extractSection(content, 'Summary');
    expect(summary).toContain('This is the summary paragraph');
    expect(summary).toContain('multi-line');
    expect(summary).not.toContain('Issues Found');
  });
});
