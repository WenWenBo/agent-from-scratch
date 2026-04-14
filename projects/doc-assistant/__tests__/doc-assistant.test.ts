/**
 * DocAssistant 集成测试
 * 使用真实 LLM API 验证端到端功能
 *
 * 注意：这些测试需要有效的 LLM API 连接和额度
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import 'dotenv/config';
import { DocAssistant } from '../doc-assistant.js';
import type { AgentEvent } from '../../../src/index.js';

const sampleDocsDir = path.join(import.meta.dirname, '..', 'sample-docs');

function createAssistant() {
  return new DocAssistant({
    apiKey: process.env.OPENAI_API_KEY!,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    docsDir: sampleDocsDir,
    embeddingDimension: 256,
  });
}

describe('DocAssistant 集成测试', () => {
  it('应能索引文档', async () => {
    const assistant = createAssistant();
    const stats = await assistant.indexDocuments();

    expect(stats.indexed).toBeGreaterThanOrEqual(3);
    expect(stats.chunks).toBeGreaterThan(0);
    expect(assistant.isIndexed()).toBe(true);
  });

  it('应能列出文档并回答问题', async () => {
    const assistant = createAssistant();
    await assistant.indexDocuments();

    const answer = await assistant.ask('List all documents in the knowledge base');
    expect(answer).toBeTruthy();
    expect(answer.length).toBeGreaterThan(10);
  }, 30000);

  it('应能通过搜索回答知识库问题', async () => {
    const assistant = createAssistant();
    await assistant.indexDocuments();

    const answer = await assistant.ask(
      'Search the documents for information about the ReAct loop. How does it work?'
    );
    expect(answer).toBeTruthy();
    expect(answer.length).toBeGreaterThan(20);
  }, 30000);

  it('应能回答会议纪要中的细节', async () => {
    const assistant = createAssistant();
    await assistant.indexDocuments();

    const answer = await assistant.ask(
      'Search the meeting notes. What is the database connection pool leak priority?'
    );
    expect(answer).toBeTruthy();
  }, 30000);

  it('流式输出应产出事件', async () => {
    const assistant = createAssistant();
    await assistant.indexDocuments();

    const events: AgentEvent[] = [];
    for await (const event of assistant.chat('Say hello briefly')) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === 'text_delta' || e.type === 'answer')).toBe(true);
  }, 30000);

  it('应能写入笔记文件', async () => {
    const assistant = createAssistant();
    await assistant.indexDocuments();

    const notePath = path.join(sampleDocsDir, 'test-note.md');
    try {
      const answer = await assistant.ask(
        'Use the write_note tool to save a file named "test-note.md" with content "Hello from test"'
      );
      expect(answer).toBeTruthy();
    } finally {
      await fs.rm(notePath, { force: true });
    }
  }, 30000);
});
