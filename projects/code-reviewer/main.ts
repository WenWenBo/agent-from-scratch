/**
 * 代码审查 Agent -- CLI 入口
 *
 * 用法: npx tsx projects/code-reviewer/main.ts [directory]
 */

import 'dotenv/config';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { CodeReviewer } from './code-reviewer.js';
import type { MultiAgentEvent } from '../../src/multi-agent/base-agent.js';

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

if (!apiKey) {
  console.error('Error: OPENAI_API_KEY is required in .env file');
  process.exit(1);
}

const codeDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(import.meta.dirname, 'sample-code');

const reviewer = new CodeReviewer({
  apiKey,
  baseUrl,
  model,
  codeDir,
});

function printEvent(event: MultiAgentEvent): void {
  switch (event.type) {
    case 'pipeline_step':
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📋 Step ${event.step}: ${event.agentName}`);
      console.log('='.repeat(60));
      break;
    case 'task_assigned':
      console.log(`  → Assigned to: ${event.agentName}`);
      break;
    case 'task_completed':
      console.log(`  ✓ ${event.agentName} completed (${event.durationMs}ms)`);
      break;
    case 'task_failed':
      console.log(`  ✗ ${event.agentName} failed: ${event.error}`);
      break;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    Automated Code Review Agent (v1.0)    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nReview target: ${codeDir}`);
  console.log(`Model: ${model}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  while (true) {
    const cmd = await ask('\n> Enter command (review / review <file> / quit): ');
    const trimmed = cmd.trim().toLowerCase();

    if (trimmed === 'quit' || trimmed === 'q') {
      console.log('Bye!');
      rl.close();
      break;
    }

    if (trimmed === 'review') {
      console.log('\nStarting full code review...\n');
      const startTime = Date.now();

      try {
        const report = await reviewer.review(printEvent);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('\n' + '='.repeat(60));
        console.log('FINAL REVIEW REPORT');
        console.log('='.repeat(60));
        console.log(`\n${report.summary}`);
        console.log(`\nScore: ${report.score}/100`);
        console.log(`Issues: ${report.metrics.criticalCount} critical, ${report.metrics.warningCount} warnings, ${report.metrics.infoCount} info`);
        console.log(`Time: ${elapsed}s`);

        if (report.issues.length > 0) {
          console.log('\nTop Issues:');
          for (const issue of report.issues.slice(0, 10)) {
            const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
            console.log(`  ${icon} ${issue.file}${issue.line ? ':' + issue.line : ''} [${issue.category}] ${issue.description}`);
          }
        }
      } catch (err) {
        console.error('Review failed:', err);
      }
    } else if (trimmed.startsWith('review ')) {
      const filename = cmd.trim().slice(7).trim();
      console.log(`\nReviewing ${filename}...\n`);

      try {
        const report = await reviewer.reviewFile(filename, printEvent);
        console.log(`\nScore: ${report.score}/100`);
        console.log(`Issues found: ${report.issues.length}`);

        for (const issue of report.issues) {
          const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵';
          console.log(`  ${icon} ${issue.file}${issue.line ? ':' + issue.line : ''} [${issue.category}] ${issue.description}`);
          if (issue.suggestion) {
            console.log(`    💡 ${issue.suggestion}`);
          }
        }
      } catch (err) {
        console.error('Review failed:', err);
      }
    } else {
      console.log('Unknown command. Available: review, review <filename>, quit');
    }
  }
}

main().catch(console.error);
