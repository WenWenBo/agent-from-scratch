/**
 * Project C: 客服智能体系统
 *
 * 综合运用全部 12 章技术：
 * - Ch01 LLM Provider:      OpenAI API 调用
 * - Ch02 工具系统:           客服业务工具（查用户、查订单、创建工单等）
 * - Ch03 ReAct 循环:         Agent 推理与工具调用
 * - Ch04 记忆系统:           多轮对话记忆 + 用户长期记忆
 * - Ch05 RAG:               知识库检索（产品、FAQ、政策）
 * - Ch06 流式输出:           实时流式回复
 * - Ch07 Multi-Agent:       意图识别 → 专家 Agent 路由（Orchestrator 模式）
 * - Ch08 MCP:               （架构预留，可扩展外部工具）
 * - Ch09 安全护栏:           输入过滤 + PII 检测 + 速率限制
 * - Ch10 可观测性:           全链路追踪 + 指标收集
 * - Ch11 评估:              回复质量评估
 * - Ch12 性能优化:          响应缓存 + 成本追踪
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { OpenAIProvider } from '../../src/providers/openai.js';
import { Agent, type AgentOptions, type AgentEvent } from '../../src/agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { StreamingAgent } from '../../src/streaming/streaming-agent.js';
import { ConversationMemory } from '../../src/memory/conversation-memory.js';
import { RAGPipeline } from '../../src/rag/rag-pipeline.js';
import { VectorStore } from '../../src/rag/vector-store.js';
import { SimpleEmbedder } from '../../src/rag/embedder.js';
import { MarkdownChunker } from '../../src/rag/chunker.js';
import { ContentFilter } from '../../src/guardrails/content-filter.js';
import { PromptInjectionDetector } from '../../src/guardrails/prompt-injection.js';
import { PIIDetector } from '../../src/guardrails/pii-detector.js';
import { RateLimiter } from '../../src/guardrails/rate-limiter.js';
import { GuardrailPipeline } from '../../src/guardrails/guardrail.js';
import { Tracer } from '../../src/observability/tracer.js';
import { InMemoryExporter } from '../../src/observability/exporters.js';
import { MetricsCollector } from '../../src/observability/metrics.js';
import { TracedAgent } from '../../src/observability/traced-agent.js';
import { Dashboard } from '../../src/observability/dashboard.js';
import { LLMCache } from '../../src/optimization/cache.js';
import { CostTracker, type CostAlert } from '../../src/optimization/cost-tracker.js';
import { PromptOptimizer } from '../../src/optimization/prompt-optimizer.js';

import {
  getAllTools,
  setRAGPipeline,
  getTickets,
  resetTickets,
  type UserRecord,
  type TicketRecord,
} from './tools.js';
import type { AgentResult } from '../../src/agent.js';
import type { Message } from '../../src/types.js';

// ============================================================
// 配置
// ============================================================

export interface CustomerServiceConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  knowledgeDir?: string;
  /** 总预算上限（USD），默认 1.0 */
  budget?: number;
  /** 是否启用缓存，默认 true */
  enableCache?: boolean;
  /** 是否启用护栏，默认 true */
  enableGuardrails?: boolean;
}

// ============================================================
// 会话状态
// ============================================================

export interface SessionState {
  sessionId: string;
  userId?: string;
  turnCount: number;
  startedAt: number;
  satisfaction?: number;
}

// ============================================================
// CustomerServiceBot
// ============================================================

export class CustomerServiceBot {
  private provider: OpenAIProvider;
  private model: string;
  private agent!: Agent;
  private streamingAgent!: StreamingAgent;
  private tracedAgent!: TracedAgent;
  private registry: ToolRegistry;
  private memory: ConversationMemory;
  private ragPipeline?: RAGPipeline;
  private inputGuardrail?: GuardrailPipeline;
  private outputGuardrail?: GuardrailPipeline;
  private rateLimiter?: RateLimiter;
  private tracer: Tracer;
  private exporter: InMemoryExporter;
  private metrics: MetricsCollector;
  private dashboard: Dashboard;
  private cache?: LLMCache;
  private costTracker: CostTracker;
  private promptOptimizer: PromptOptimizer;

  private session: SessionState;
  private config: CustomerServiceConfig;

  constructor(config: CustomerServiceConfig) {
    this.config = config;
    this.model = config.model ?? 'gpt-4o';

    // -- Ch01: LLM Provider --
    this.provider = new OpenAIProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: this.model,
    });

    // -- Ch02: 工具注册 --
    this.registry = new ToolRegistry();
    for (const tool of getAllTools()) {
      this.registry.register(tool);
    }

    // -- Ch04: 记忆系统 --
    this.memory = new ConversationMemory({ systemPrompt: 'TinyBot AI 客服' });

    // -- Ch09: 安全护栏 --
    if (config.enableGuardrails !== false) {
      this.inputGuardrail = new GuardrailPipeline()
        .add(new ContentFilter({ maxContentLength: 2000 }))
        .add(new PromptInjectionDetector({ sensitivity: 'medium' }));

      this.outputGuardrail = new GuardrailPipeline()
        .add(new PIIDetector({
          enabledCategories: ['email', 'phone', 'id_card', 'bank_card'],
          action: 'mask',
        }));

      this.rateLimiter = new RateLimiter({
        maxRequestsPerMinute: 20,
        maxTurnsPerSession: 50,
      });
    }

    // -- Ch10: 可观测性 --
    this.exporter = new InMemoryExporter();
    this.tracer = new Tracer({ exporters: [this.exporter] });
    this.metrics = new MetricsCollector();
    this.dashboard = new Dashboard(this.metrics);

    // -- Ch12: 优化 --
    if (config.enableCache !== false) {
      this.cache = new LLMCache({ maxSize: 200, ttlMs: 10 * 60 * 1000 });
    }

    this.costTracker = new CostTracker(
      { totalBudget: config.budget ?? 1.0, alertThreshold: 0.8 },
    );

    this.promptOptimizer = new PromptOptimizer({
      maxTokenBudget: 3000,
      minTurnsToKeep: 3,
      compressWhitespace: true,
    });

    // -- 会话 --
    this.session = {
      sessionId: `session-${Date.now()}`,
      turnCount: 0,
      startedAt: Date.now(),
    };

    // -- Ch03: 构建 Agent --
    this.buildAgent();
  }

  // ============================================================
  // 初始化
  // ============================================================

  private buildAgent(): void {
    const systemPrompt = `你是 TinyBot 的 AI 客服助手。你的职责是帮助用户解决关于 TinyBot 产品的问题。

## 工作原则
1. 始终保持礼貌、专业、耐心
2. 先理解用户问题，再提供解决方案
3. 优先使用知识库搜索获取准确信息
4. 需要查询用户信息时，先询问用户 ID 或邮箱
5. 不确定的信息如实告知，建议转人工客服
6. 涉及退款、账户安全等敏感操作时，创建工单并转人工

## 可用工具
- search_knowledge: 搜索产品信息、FAQ、政策
- lookup_user: 查询用户信息
- query_orders: 查询订单记录
- create_ticket: 创建客服工单
- transfer_to_human: 转接人工客服
- check_service_status: 检查服务状态

## 回复规范
- 使用中文回复
- 结尾询问"还有其他可以帮助您的吗？"
- 提供具体的操作步骤和链接`;

    const agentOptions: AgentOptions = {
      provider: this.provider,
      model: this.model,
      systemPrompt,
      tools: this.registry,
      maxSteps: 8,
    };

    // -- Ch03 + Ch06: Agent + StreamingAgent --
    this.agent = new Agent(agentOptions);
    this.streamingAgent = new StreamingAgent(agentOptions);

    // -- Ch10: 包装 TracedAgent --
    this.tracedAgent = new TracedAgent({
      agent: this.agent,
      tracer: this.tracer,
      metrics: this.metrics,
      model: this.model,
    });
  }

  /**
   * Ch05: 初始化 RAG 知识库
   */
  async initKnowledgeBase(knowledgeDir?: string): Promise<number> {
    let dir = knowledgeDir ?? this.config.knowledgeDir;
    if (!dir) {
      const currentFile = new URL(import.meta.url).pathname;
      dir = path.join(path.dirname(currentFile), 'knowledge-base');
    }

    const embedder = new SimpleEmbedder(128);
    const vectorStore = new VectorStore({ embedder });
    const chunker = new MarkdownChunker(500);

    this.ragPipeline = new RAGPipeline({
      vectorStore,
      topK: 3,
      minScore: 0,
    });

    let totalChunks = 0;

    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md') && !file.endsWith('.txt')) continue;
        const filePath = path.join(dir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const chunks = await this.ragPipeline.indexDocument(content, chunker, { source: file });
        totalChunks += chunks.length;
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        throw err;
      }
    }

    setRAGPipeline(this.ragPipeline);
    return totalChunks;
  }

  // ============================================================
  // 核心对话
  // ============================================================

  /**
   * 处理用户消息（非流式）
   */
  async chat(userInput: string, onEvent?: (event: AgentEvent) => void): Promise<string> {
    this.session.turnCount++;

    // -- Ch09: 速率限制 --
    if (this.rateLimiter) {
      const rateResult = await this.rateLimiter.check(userInput, {
        userId: this.session.sessionId,
      });
      if (!rateResult.passed) {
        return `抱歉，您的请求过于频繁，请稍后再试。${rateResult.reason ?? ''}`;
      }
    }

    // -- Ch09: 输入护栏 --
    if (this.inputGuardrail) {
      const inputCheck = await this.inputGuardrail.run(userInput, 'input', {
        userId: this.session.sessionId,
      });
      if (!inputCheck.passed) {
        return '抱歉，您的消息包含不当内容，请重新描述您的问题。';
      }
    }

    // -- Ch04: 添加到记忆 --
    this.memory.addMessage({ role: 'user', content: userInput });

    // -- Ch10: TracedAgent 运行 --
    const result: AgentResult = await this.tracedAgent.run(userInput, onEvent);
    let reply = result.content;

    // -- Ch09: 输出护栏（PII 脱敏） --
    if (this.outputGuardrail) {
      const outputCheck = await this.outputGuardrail.run(reply, 'output', {
        userId: this.session.sessionId,
      });
      if (!outputCheck.passed) {
        reply = '抱歉，回复内容包含敏感信息，已进行脱敏处理。';
      }
    }

    // -- Ch04: 记录助手回复 --
    this.memory.addMessage({ role: 'assistant', content: reply });

    // -- Ch12: 成本追踪 --
    if (result.usage) {
      this.costTracker.record(
        this.model,
        result.usage.promptTokens,
        result.usage.completionTokens,
      );
    }

    return reply;
  }

  /**
   * 处理用户消息（流式）
   * Ch06: StreamingAgent
   */
  async *chatStream(userInput: string): AsyncGenerator<AgentEvent> {
    this.session.turnCount++;

    // 护栏检查
    if (this.rateLimiter) {
      const rateResult = await this.rateLimiter.check(userInput, {
        userId: this.session.sessionId,
      });
      if (!rateResult.passed) {
        yield { type: 'answer', content: `抱歉，您的请求过于频繁，请稍后再试。` };
        return;
      }
    }

    if (this.inputGuardrail) {
      const inputCheck = await this.inputGuardrail.run(userInput, 'input', {
        userId: this.session.sessionId,
      });
      if (!inputCheck.passed) {
        yield { type: 'answer', content: '抱歉，您的消息包含不当内容，请重新描述您的问题。' };
        return;
      }
    }

    this.memory.addMessage({ role: 'user', content: userInput });

    let fullContent = '';
    for await (const event of this.streamingAgent.runStream(userInput)) {
      if (event.type === 'text_delta') {
        fullContent += event.content;
      }
      yield event;
    }

    this.memory.addMessage({ role: 'assistant', content: fullContent });
  }

  // ============================================================
  // 运营面板
  // ============================================================

  getSession(): SessionState {
    return { ...this.session };
  }

  getMetricsSummary(): string {
    return this.dashboard.generateReport();
  }

  getCostSummary() {
    return this.costTracker.getSummary();
  }

  getCacheStats() {
    return this.cache?.getStats();
  }

  getTraces() {
    return this.exporter.getTraces();
  }

  getTickets(): TicketRecord[] {
    return getTickets();
  }

  isBudgetExceeded(): boolean {
    return this.costTracker.isBudgetExceeded();
  }

  // ============================================================
  // 会话管理
  // ============================================================

  resetSession(): void {
    this.memory = new ConversationMemory({ systemPrompt: 'TinyBot AI 客服' });
    this.session = {
      sessionId: `session-${Date.now()}`,
      turnCount: 0,
      startedAt: Date.now(),
    };
    resetTickets();
  }
}
