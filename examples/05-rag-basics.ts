/**
 * 示例：RAG 基础 -- 检索增强生成
 * 展示如何将知识库与 LLM 结合，让 Agent 能回答超出训练数据的问题
 */

import 'dotenv/config';
import {
  OpenAIProvider,
  SimpleEmbedder,
  VectorStore,
  RAGPipeline,
  ParagraphChunker,
  cosineSimilarity,
} from '../src/index.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function main() {
  // ========================================================
  // 1. 向量运算演示
  // ========================================================
  console.log('=== 向量运算演示 ===\n');

  const embedder = new SimpleEmbedder(128);

  const v1 = await embedder.embed('TypeScript is a programming language');
  const v2 = await embedder.embed('JavaScript is a scripting language');
  const v3 = await embedder.embed('How to cook pasta at home');

  console.log(`TS vs JS 相似度: ${cosineSimilarity(v1, v2).toFixed(4)}`);
  console.log(`TS vs 烹饪 相似度: ${cosineSimilarity(v1, v3).toFixed(4)}`);
  console.log('(相似主题的分数应更高)\n');

  // ========================================================
  // 2. RAG Pipeline 演示
  // ========================================================
  console.log('=== RAG Pipeline 演示 ===\n');

  const store = new VectorStore({ embedder });
  const pipeline = new RAGPipeline({
    vectorStore: store,
    topK: 3,
    minScore: 0,
  });

  // 索引一份"公司内部知识库"
  const knowledgeBase = `
公司简介：
TinyAgent 公司成立于 2024 年，专注于 AI Agent 开发框架。
公司总部位于深圳南山科技园。

产品信息：
TinyAgent 框架是一个开源的 TypeScript Agent 开发框架。
核心功能包括：ReAct 循环、记忆系统、RAG、MCP 协议支持。
目前最新版本是 v1.0，支持 OpenAI 和 Anthropic 两家 LLM 服务商。

技术栈：
- 语言：TypeScript / Node.js
- 验证：Zod
- 测试：Vitest
- 包管理：pnpm

联系方式：
技术支持邮箱：support@tinyagent.dev
GitHub：https://github.com/tiny-agent/framework
  `.trim();

  const chunks = await pipeline.indexDocument(
    knowledgeBase,
    new ParagraphChunker({ maxChunkSize: 200 }),
    { source: 'company-kb' }
  );
  console.log(`已索引 ${chunks.length} 个文档块\n`);

  // ========================================================
  // 3. 不用 RAG vs 用 RAG
  // ========================================================
  const question = 'TinyAgent 公司在哪里？使用什么技术栈？';

  // 不用 RAG
  console.log('--- 不用 RAG ---');
  const r1 = await provider.chat({
    model,
    messages: [
      { role: 'system', content: '用中文简短回答。' },
      { role: 'user', content: question },
    ],
  });
  console.log('回答:', r1.content);
  console.log('');

  // 用 RAG
  console.log('--- 用 RAG ---');
  const augmented = await pipeline.augment(question, [
    { role: 'system', content: '根据提供的上下文信息回答，用中文简短回答。如果上下文没有相关信息，就说不知道。' },
    { role: 'user', content: question },
  ]);
  const r2 = await provider.chat({ model, messages: augmented });
  console.log('回答:', r2.content);

  // 展示检索到的文档块
  console.log('\n--- 检索到的相关文档 ---');
  const results = await pipeline.retrieve(question);
  results.forEach((r, i) => {
    console.log(`\n[${i + 1}] 相似度: ${(r.score * 100).toFixed(1)}%`);
    console.log(`    ${r.entry.content.slice(0, 100)}...`);
  });
}

main().catch(console.error);
