/**
 * 智能文档助手 -- Project A
 *
 * 综合运用 Chapter 01-06 的全部能力：
 * - LLM Provider（Chapter 01）：调用 LLM API
 * - 工具系统（Chapter 02）：文档 CRUD + 语义搜索
 * - ReAct 循环（Chapter 03）：自动推理和工具调用
 * - 记忆系统（Chapter 04）：多轮对话 + 长期偏好记忆
 * - RAG（Chapter 05）：文档知识库语义检索
 * - 流式输出（Chapter 06）：实时逐字回复
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  OpenAIProvider,
  StreamingAgent,
  ToolRegistry,
  RAGPipeline,
  VectorStore,
  SimpleEmbedder,
  MarkdownChunker,
  FixedSizeChunker,
  ConversationMemory,
  InMemoryStore,
} from '../../src/index.js';
import type { AgentEvent, Message } from '../../src/index.js';
import {
  listDocsTool,
  readDocTool,
  searchDocsTool,
  writeNoteTool,
  setDocsDir,
  getDocsDir,
  setRAGPipeline,
} from './tools.js';

// ============================================================
// DocAssistant 配置
// ============================================================

export interface DocAssistantConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  docsDir: string;
  embeddingDimension?: number;
}

// ============================================================
// DocAssistant 核心类
// ============================================================

export class DocAssistant {
  private agent: StreamingAgent;
  private rag: RAGPipeline;
  private memory: ConversationMemory;
  private longTermMemory: InMemoryStore;
  private docsDir: string;
  private indexed: boolean = false;

  constructor(config: DocAssistantConfig) {
    this.docsDir = config.docsDir;

    // --- 1. LLM Provider (Chapter 01) ---
    const provider = new OpenAIProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      defaultModel: config.model,
    });

    // --- 2. RAG Pipeline (Chapter 05) ---
    const embedder = new SimpleEmbedder({
      dimension: config.embeddingDimension ?? 256,
    });
    const vectorStore = new VectorStore({ embedder });
    this.rag = new RAGPipeline({
      vectorStore,
      topK: 5,
      minScore: 0,
    });

    // --- 3. 工具注册 (Chapter 02) ---
    setDocsDir(config.docsDir);
    setRAGPipeline(this.rag);

    const tools = new ToolRegistry();
    tools.register(listDocsTool);
    tools.register(readDocTool);
    tools.register(searchDocsTool);
    tools.register(writeNoteTool);

    // --- 4. 记忆系统 (Chapter 04) ---
    this.memory = new ConversationMemory({
      systemPrompt: SYSTEM_PROMPT,
      maxMessages: 30,
    });
    this.longTermMemory = new InMemoryStore();

    // --- 5. 流式 Agent (Chapter 03 + 06) ---
    this.agent = new StreamingAgent({
      provider,
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      tools,
      maxSteps: 8,
      temperature: 0,
    });
  }

  // ============================================================
  // 文档索引
  // ============================================================

  /**
   * 索引文档目录中的所有文件到 RAG 知识库
   */
  async indexDocuments(): Promise<{ indexed: number; chunks: number }> {
    const files = await fs.readdir(this.docsDir);
    let totalChunks = 0;
    let indexedFiles = 0;

    for (const file of files) {
      const filePath = path.join(this.docsDir, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;

      const content = await fs.readFile(filePath, 'utf-8');
      if (!content.trim()) continue;

      const chunker = file.endsWith('.md')
        ? new MarkdownChunker({ maxChunkSize: 800 })
        : new FixedSizeChunker({ chunkSize: 600, overlap: 100 });

      const chunks = await this.rag.indexDocument(content, chunker, {
        source: file,
        indexedAt: new Date().toISOString(),
      });

      totalChunks += chunks.length;
      indexedFiles++;
    }

    this.indexed = true;
    return { indexed: indexedFiles, chunks: totalChunks };
  }

  // ============================================================
  // 对话接口
  // ============================================================

  /**
   * 流式对话 -- 逐字输出
   */
  async *chat(input: string): AsyncGenerator<AgentEvent> {
    // 将用户消息加入记忆
    this.memory.addMessage({ role: 'user', content: input });

    // 构建带记忆的 system prompt
    const contextMessages = this.memory.getContextMessages();
    const systemContent = await this.buildEnhancedSystem(input, contextMessages);

    // 更新 agent 的 system prompt 并运行
    const gen = this.agent.runStream(input);
    let genResult = await gen.next();

    while (!genResult.done) {
      yield genResult.value;
      genResult = await gen.next();
    }

    const result = genResult.value;

    // 将 assistant 回复加入记忆
    this.memory.addMessage({ role: 'assistant', content: result.content });
  }

  /**
   * 非流式对话 -- 一次性返回
   */
  async ask(input: string): Promise<string> {
    this.memory.addMessage({ role: 'user', content: input });

    const result = await this.agent.run(input);

    this.memory.addMessage({ role: 'assistant', content: result.content });
    return result.content;
  }

  // ============================================================
  // 长期记忆管理
  // ============================================================

  async remember(content: string, importance: number = 0.5): Promise<void> {
    await this.longTermMemory.add({ content, metadata: {}, importance });
  }

  async recall(query: string): Promise<string[]> {
    const entries = await this.longTermMemory.search(query, 3);
    return entries.map((e) => e.content);
  }

  // ============================================================
  // 状态查询
  // ============================================================

  isIndexed(): boolean {
    return this.indexed;
  }

  getMessageCount(): number {
    return this.memory.getMessageCount();
  }

  resetConversation(): void {
    this.memory.clear();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async buildEnhancedSystem(
    query: string,
    contextMessages: Message[]
  ): Promise<string> {
    let system = SYSTEM_PROMPT;

    // 注入长期记忆
    const memories = await this.longTermMemory.search(query, 3);
    if (memories.length > 0) {
      const memText = memories.map((m) => `- ${m.content}`).join('\n');
      system += `\n\n[User Preferences & History]\n${memText}`;
    }

    return system;
  }
}

// ============================================================
// System Prompt
// ============================================================

const SYSTEM_PROMPT = `You are an intelligent document assistant. You help users manage, search, and understand their document library.

## Capabilities
1. **List documents** -- Show what's in the knowledge base
2. **Read documents** -- Retrieve and display document content
3. **Search documents** -- Use semantic search to find relevant passages
4. **Write notes** -- Save summaries or notes
5. **Answer questions** -- Use retrieved context to answer questions about documents

## Behavior Guidelines
- Always use the search_documents tool first when the user asks a question about content
- If search results are insufficient, try read_document to get the full text
- Cite sources when answering from documents (mention the filename)
- Be concise but thorough
- If you don't know something, say so rather than guessing
- Respond in the same language as the user's query`;
