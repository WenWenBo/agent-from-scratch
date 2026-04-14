/**
 * CodeReviewer -- 自动化代码审查 Agent (Project B)
 *
 * 架构：Multi-Agent Pipeline + Guardrails
 *
 * Pipeline 流程：
 *   1. CodeAnalyzer      -- 读取代码、统计指标、识别基础问题
 *   2. SecurityScanner   -- 安全漏洞扫描（eval、硬编码密钥、注入风险）
 *   3. StyleChecker      -- 代码风格检查（嵌套深度、函数长度、类型使用）
 *   4. ReviewSummarizer  -- 汇总上面三个步骤的结果，生成结构化审查报告
 *
 * 综合运用的框架模块：
 * - Chapter 01: LLM Provider
 * - Chapter 02: 工具系统（自定义文件分析工具）
 * - Chapter 03: Agent ReAct 循环
 * - Chapter 07: Multi-Agent Sequential Pipeline
 * - Chapter 09: Guardrails（输出安全过滤，避免审查报告泄露原始密钥内容）
 */

import { OpenAIProvider } from '../../src/providers/openai.js';
import { Agent } from '../../src/agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { AgentWrapper } from '../../src/multi-agent/agent-wrapper.js';
import { SequentialPipeline } from '../../src/multi-agent/sequential.js';
import { PIIDetector } from '../../src/guardrails/pii-detector.js';
import { GuardrailPipeline } from '../../src/guardrails/guardrail.js';
import type { BaseAgent, MultiAgentEvent } from '../../src/multi-agent/base-agent.js';

import {
  setCodeDir,
  listFilesTool,
  readFileTool,
  countLinesTool,
  searchPatternTool,
} from './tools.js';

// ============================================================
// 审查报告类型
// ============================================================

export interface ReviewIssue {
  file: string;
  line?: number;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  description: string;
  suggestion?: string;
}

export interface ReviewReport {
  summary: string;
  issues: ReviewIssue[];
  metrics: {
    totalFiles: number;
    totalLines: number;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
  };
  score: number;
  rawContent: string;
}

// ============================================================
// 配置
// ============================================================

export interface CodeReviewerConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  codeDir: string;
}

// ============================================================
// CodeReviewer 核心类
// ============================================================

export class CodeReviewer {
  private provider: OpenAIProvider;
  private model: string;
  private pipeline: SequentialPipeline;
  private outputGuardrail: GuardrailPipeline;
  private codeDir: string;

  constructor(config: CodeReviewerConfig) {
    this.codeDir = config.codeDir;
    this.model = config.model ?? 'gpt-4o';

    this.provider = new OpenAIProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });

    setCodeDir(config.codeDir);

    // 构建 Pipeline 中的四个专用 Agent
    const analyzer = this.createAnalyzerAgent();
    const securityScanner = this.createSecurityAgent();
    const styleChecker = this.createStyleAgent();
    const summarizer = this.createSummarizerAgent();

    this.pipeline = new SequentialPipeline({
      name: 'code-review-pipeline',
      description: 'Automated code review with analysis, security, style, and summary stages',
      agents: [analyzer, securityScanner, styleChecker, summarizer],
    });

    // 输出护栏：过滤审查报告中可能残留的真实密钥
    this.outputGuardrail = new GuardrailPipeline();
    this.outputGuardrail.add(new PIIDetector({
      enabledCategories: ['api_key', 'email'],
      action: 'flag',
    }));
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 执行完整代码审查
   */
  async review(
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<ReviewReport> {
    const input = `Please perform a thorough code review of all source files in the project. 
Analyze each file for:
1. Bug risks (divide by zero, null/undefined access, unhandled errors, empty array)
2. Security issues (hardcoded secrets, eval(), SQL injection, unsafe data handling)
3. Code style (any types, deep nesting, long functions, magic numbers, missing error handling)
4. Best practices (TypeScript strict mode, proper typing, error boundaries)

For each issue found, specify:
- The file name and line number
- Severity: critical / warning / info
- Category: bug / security / style / best-practice
- A clear description and fix suggestion

End with a summary and a score from 0-100.`;

    const result = await this.pipeline.execute(
      { content: input },
      onEvent
    );

    // 输出护栏检查
    const guardResult = await this.outputGuardrail.run(result.content, 'output');
    let finalContent = result.content;
    if (!guardResult.passed) {
      const piiDetector = new PIIDetector({
        enabledCategories: ['api_key', 'email'],
        action: 'flag',
      });
      finalContent = piiDetector.mask(result.content);
    }

    return this.parseReport(finalContent);
  }

  /**
   * 仅对指定文件进行审查
   */
  async reviewFile(
    filename: string,
    onEvent?: (event: MultiAgentEvent) => void
  ): Promise<ReviewReport> {
    const input = `Please review the file "${filename}" thoroughly.
Focus on: bugs, security issues, code style, and best practices.
Provide specific line numbers and fix suggestions for each issue found.
End with a summary and a score from 0-100.`;

    const result = await this.pipeline.execute(
      { content: input },
      onEvent
    );

    return this.parseReport(result.content);
  }

  // ============================================================
  // Pipeline Agent 构建
  // ============================================================

  private createAnalyzerAgent(): BaseAgent {
    const tools = new ToolRegistry();
    tools.register(listFilesTool);
    tools.register(readFileTool);
    tools.register(countLinesTool);

    const agent = new Agent({
      provider: this.provider,
      model: this.model,
      systemPrompt: `You are a Code Analyzer. Your job is to:
1. List all source files using the list_files tool
2. Read each file using the read_file tool
3. Get metrics for each file using count_lines tool
4. Identify potential BUGS such as:
   - Division by zero without checks
   - Accessing properties on potentially undefined values
   - Unhandled edge cases (empty arrays, null inputs)
   - Missing async error handling
   - Non-null assertion operator (!) on potentially undefined

Output a structured analysis with file name, line numbers, and descriptions.
Format each issue as: [BUG] file:line - description`,
      tools,
      maxSteps: 15,
      temperature: 0,
    });

    return new AgentWrapper({
      ...agent,
      provider: this.provider,
      model: this.model,
      systemPrompt: agent['systemPrompt'],
      tools,
      maxSteps: 15,
      temperature: 0,
      name: 'code-analyzer',
      description: 'Reads source files, collects metrics, and identifies bug risks',
    });
  }

  private createSecurityAgent(): BaseAgent {
    const tools = new ToolRegistry();
    tools.register(readFileTool);
    tools.register(searchPatternTool);

    const agent = new Agent({
      provider: this.provider,
      model: this.model,
      systemPrompt: `You are a Security Scanner. Based on the previous analysis, perform a security audit.

Use the search_pattern tool to find:
1. Hardcoded secrets: search for patterns like "API_KEY", "secret", "password", "sk-"
2. Dangerous functions: search for "eval(", "Function(", "exec("
3. Injection risks: search for string concatenation in SQL-like strings
4. Unsafe data handling: search for "JSON.parse" without try-catch

For each finding, use read_file to get the surrounding context.

Output format: [SECURITY:severity] file:line - description
Where severity is: CRITICAL, HIGH, MEDIUM, LOW`,
      tools,
      maxSteps: 15,
      temperature: 0,
    });

    return new AgentWrapper({
      ...agent,
      provider: this.provider,
      model: this.model,
      systemPrompt: agent['systemPrompt'],
      tools,
      maxSteps: 15,
      temperature: 0,
      name: 'security-scanner',
      description: 'Scans code for security vulnerabilities including hardcoded secrets, eval usage, and injection risks',
    });
  }

  private createStyleAgent(): BaseAgent {
    const tools = new ToolRegistry();
    tools.register(readFileTool);
    tools.register(countLinesTool);
    tools.register(searchPatternTool);

    const agent = new Agent({
      provider: this.provider,
      model: this.model,
      systemPrompt: `You are a Code Style Checker. Based on previous analysis, check for style issues.

Use tools to verify:
1. Use search_pattern to find "any" type usage
2. Use count_lines to check function complexity and nesting depth
3. Use read_file to identify:
   - Functions longer than 30 lines
   - Nesting deeper than 3 levels
   - Magic numbers (numeric literals that should be named constants)
   - Missing type annotations
   - console.log left in production code

Output format: [STYLE:severity] file:line - description
Where severity is: WARNING, INFO`,
      tools,
      maxSteps: 15,
      temperature: 0,
    });

    return new AgentWrapper({
      ...agent,
      provider: this.provider,
      model: this.model,
      systemPrompt: agent['systemPrompt'],
      tools,
      maxSteps: 15,
      temperature: 0,
      name: 'style-checker',
      description: 'Checks code style including type usage, complexity, nesting depth, and naming conventions',
    });
  }

  private createSummarizerAgent(): BaseAgent {
    const agent = new Agent({
      provider: this.provider,
      model: this.model,
      systemPrompt: `You are a Review Summarizer. You receive the combined output of three previous review stages:
1. Code Analysis (bugs)
2. Security Scan
3. Style Check

Your job is to produce a FINAL structured review report in this exact format:

## Code Review Report

### Summary
[One paragraph overview of the codebase health]

### Issues Found

#### Critical Issues
For each critical issue:
- **[FILE:LINE]** [CATEGORY] Description
  - Suggestion: How to fix

#### Warnings
For each warning:
- **[FILE:LINE]** [CATEGORY] Description
  - Suggestion: How to fix

#### Informational
For each info item:
- **[FILE:LINE]** [CATEGORY] Description
  - Suggestion: Improvement idea

### Metrics
- Total Files Reviewed: N
- Total Issues: N (X critical, Y warnings, Z info)
- Security Issues: N
- Style Issues: N

### Score: XX/100

Scoring criteria:
- Start at 100
- Critical issue: -15 each
- Warning: -5 each
- Info: -2 each
- Minimum score: 0`,
      maxSteps: 3,
      temperature: 0,
    });

    return new AgentWrapper({
      ...agent,
      provider: this.provider,
      model: this.model,
      systemPrompt: agent['systemPrompt'],
      maxSteps: 3,
      temperature: 0,
      name: 'review-summarizer',
      description: 'Aggregates analysis results into a structured final review report with scores',
    });
  }

  // ============================================================
  // 报告解析
  // ============================================================

  private parseReport(content: string): ReviewReport {
    const issues: ReviewIssue[] = [];

    // 先提取所有 section heading 的位置来决定 severity
    const sectionHeadings: Array<{ index: number; severity: ReviewIssue['severity'] }> = [];
    const headingRegex = /####\s*(Critical\s*Issues?|Warnings?|Informational)/gi;
    let headingMatch: RegExpExecArray | null;
    while ((headingMatch = headingRegex.exec(content)) !== null) {
      const label = headingMatch[1]!.toLowerCase();
      let sev: ReviewIssue['severity'] = 'info';
      if (label.includes('critical')) sev = 'critical';
      else if (label.includes('warning')) sev = 'warning';
      sectionHeadings.push({ index: headingMatch.index, severity: sev });
    }

    const getSeverityByPosition = (pos: number): ReviewIssue['severity'] => {
      let result: ReviewIssue['severity'] = 'info';
      for (const h of sectionHeadings) {
        if (h.index <= pos) result = h.severity;
        else break;
      }
      return result;
    };

    const fullPattern = /\*\*\[([^\]]+?)(?::(\d+))?\]\*\*\s*\[([^\]]+)\]\s*([^\n]+)(?:\n\s+-\s+Suggestion:\s*([^\n]+))?/g;
    let match: RegExpExecArray | null;

    while ((match = fullPattern.exec(content)) !== null) {
      const [, file, lineStr, category, description, suggestion] = match;
      const severity = getSeverityByPosition(match.index);

      issues.push({
        file: file?.trim() ?? 'unknown',
        line: lineStr ? parseInt(lineStr, 10) : undefined,
        severity,
        category: category?.trim() ?? 'general',
        description: description?.trim() ?? '',
        suggestion: suggestion?.trim(),
      });
    }

    // 解析 Score
    const scoreMatch = content.match(/Score:\s*(\d+)\s*\/\s*100/i);
    const score = scoreMatch ? parseInt(scoreMatch[1]!, 10) : 50;

    // 解析 Metrics
    const filesMatch = content.match(/Total Files Reviewed:\s*(\d+)/i);
    const totalFiles = filesMatch ? parseInt(filesMatch[1]!, 10) : 0;

    const linesMatch = content.match(/Total Lines:\s*(\d+)/i);
    const totalLines = linesMatch ? parseInt(linesMatch[1]!, 10) : 0;

    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const infoCount = issues.filter(i => i.severity === 'info').length;

    return {
      summary: this.extractSection(content, 'Summary') || 'Code review completed.',
      issues,
      metrics: {
        totalFiles,
        totalLines,
        criticalCount,
        warningCount,
        infoCount,
      },
      score,
      rawContent: content,
    };
  }

  private extractSection(content: string, heading: string): string {
    const regex = new RegExp(`###\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n###|$)`, 'i');
    const match = regex.exec(content);
    return match?.[1]?.trim() ?? '';
  }
}
