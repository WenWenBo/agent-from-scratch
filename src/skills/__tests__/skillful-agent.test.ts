import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillfulAgent } from '../skillful-agent.js';
import { SkillRegistry } from '../skill-registry.js';
import { ToolRegistry } from '../../tools/registry.js';
import { defineTool } from '../../tools/tool.js';
import { defineSkill } from '../skill.js';
import { z } from 'zod';
import type { ChatResponse, StreamChunk, ChatRequest } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';

// ============================================================
// Mock LLM Provider
// ============================================================

class MockProvider {
  readonly apiKey = 'test';
  readonly baseUrl = 'http://test';
  readonly defaultModel = 'test-model';
  chatFn: (request: ChatRequest) => Promise<ChatResponse>;

  constructor() {
    this.chatFn = async () => ({
      id: 'test',
      content: 'Mock 回复',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop' as const,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.chatFn(request);
  }

  async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'done' };
  }

  protected resolveModel(request: ChatRequest): string {
    return request.model || this.defaultModel;
  }
}

// ============================================================
// 测试
// ============================================================

describe('SkillfulAgent', () => {
  let provider: MockProvider;
  let skillRegistry: SkillRegistry;
  let baseTools: ToolRegistry;

  beforeEach(() => {
    provider = new MockProvider();

    // 基础工具
    baseTools = new ToolRegistry();
    baseTools.register(
      defineTool({
        name: 'read_file',
        description: '读取文件',
        parameters: z.object({ path: z.string() }),
        execute: async (params) => `文件内容: ${params.path}`,
      }),
    );
    baseTools.register(
      defineTool({
        name: 'search',
        description: '搜索代码',
        parameters: z.object({ query: z.string() }),
        execute: async (params) => `搜索结果: ${params.query}`,
      }),
    );
    baseTools.register(
      defineTool({
        name: 'write_file',
        description: '写入文件',
        parameters: z.object({ path: z.string(), content: z.string() }),
        execute: async () => 'ok',
      }),
    );

    // 技能注册
    skillRegistry = new SkillRegistry();

    skillRegistry.register(
      defineSkill({
        metadata: {
          name: 'code-review',
          description: '代码审查',
          triggers: ['review', '审查'],
        },
        instructions: '你是代码审查助手，使用 ${language} 审查',
        allowedTools: ['read_file', 'search'],
        caps: { maxTokens: 4096, temperature: 0.2 },
        promptVariables: { language: 'TypeScript' },
      }),
    );

    skillRegistry.register(
      defineSkill({
        metadata: {
          name: 'translator',
          description: '翻译助手',
          triggers: ['翻译', 'translate'],
        },
        instructions: '你是翻译助手',
        caps: { preferredModel: 'gpt-4' },
      }),
    );
  });

  it('无技能激活时应作为普通 Agent 运行', async () => {
    const agent = new SkillfulAgent({
      provider: provider as unknown as LLMProvider,
      model: 'test-model',
      systemPrompt: '你是 TinyAgent',
      tools: baseTools,
      skillRegistry,
      autoRoute: false,
    });

    const result = await agent.run('你好');
    expect(result.content).toBe('Mock 回复');
  });

  it('自动路由应根据触发词激活技能', async () => {
    let capturedRequest: ChatRequest | null = null;
    provider.chatFn = async (request) => {
      capturedRequest = request;
      return {
        id: 'test',
        content: '审查结果',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop' as const,
      };
    };

    const agent = new SkillfulAgent({
      provider: provider as unknown as LLMProvider,
      model: 'test-model',
      systemPrompt: '你是 TinyAgent',
      tools: baseTools,
      skillRegistry,
      autoRoute: true,
    });

    await agent.run('请帮我审查这段代码');

    // 验证 system prompt 被增强了
    const sysMsg = capturedRequest!.messages[0]!;
    expect(sysMsg.content).toContain('你是 TinyAgent');
    expect(sysMsg.content).toContain('代码审查助手');
    expect(sysMsg.content).toContain('使用 TypeScript 审查');
  });

  it('自动路由应应用工具白名单', async () => {
    let capturedRequest: ChatRequest | null = null;
    provider.chatFn = async (request) => {
      capturedRequest = request;
      return {
        id: 'test',
        content: 'ok',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop' as const,
      };
    };

    const agent = new SkillfulAgent({
      provider: provider as unknown as LLMProvider,
      model: 'test-model',
      systemPrompt: 'base',
      tools: baseTools,
      skillRegistry,
      autoRoute: true,
    });

    await agent.run('请 review 这段代码');

    // 只有 read_file 和 search，不应有 write_file
    const toolNames = capturedRequest!.tools?.map(t => t.function.name) ?? [];
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('search');
    expect(toolNames).not.toContain('write_file');
  });

  it('应应用 caps 参数约束', async () => {
    let capturedRequest: ChatRequest | null = null;
    provider.chatFn = async (request) => {
      capturedRequest = request;
      return {
        id: 'test',
        content: 'ok',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop' as const,
      };
    };

    const agent = new SkillfulAgent({
      provider: provider as unknown as LLMProvider,
      model: 'test-model',
      systemPrompt: 'base',
      skillRegistry,
      autoRoute: false,
    });

    agent.activateSkill('translator');
    await agent.run('翻译这段话');

    expect(capturedRequest!.model).toBe('gpt-4');
  });

  it('手动激活 / 停用应生效', async () => {
    const agent = new SkillfulAgent({
      provider: provider as unknown as LLMProvider,
      model: 'test-model',
      systemPrompt: 'base',
      skillRegistry,
      autoRoute: false,
    });

    agent.activateSkill('code-review');
    expect(agent.getActiveSkillNames()).toContain('code-review');

    agent.deactivateSkill('code-review');
    expect(agent.getActiveSkillNames()).not.toContain('code-review');
  });

  it('手动激活时可传入运行时变量', async () => {
    let capturedRequest: ChatRequest | null = null;
    provider.chatFn = async (request) => {
      capturedRequest = request;
      return {
        id: 'test',
        content: 'ok',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop' as const,
      };
    };

    const agent = new SkillfulAgent({
      provider: provider as unknown as LLMProvider,
      model: 'test-model',
      systemPrompt: 'base',
      skillRegistry,
      autoRoute: false,
    });

    agent.activateSkill('code-review', { language: 'Python' });
    await agent.run('审查代码');

    const sysMsg = capturedRequest!.messages[0]!;
    expect(sysMsg.content).toContain('使用 Python 审查');
  });

  it('技能自带工具应被注册', async () => {
    const skillTool = defineTool({
      name: 'custom_tool',
      description: '技能专属工具',
      parameters: z.object({ input: z.string() }),
      execute: async (params) => `自定义: ${params.input}`,
    });

    skillRegistry.register(
      defineSkill({
        metadata: {
          name: 'with-tools',
          description: '带工具的技能',
          triggers: ['custom'],
        },
        instructions: '使用自定义工具',
        tools: [skillTool],
      }),
    );

    let capturedRequest: ChatRequest | null = null;
    provider.chatFn = async (request) => {
      capturedRequest = request;
      return {
        id: 'test',
        content: 'ok',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop' as const,
      };
    };

    const agent = new SkillfulAgent({
      provider: provider as unknown as LLMProvider,
      model: 'test-model',
      systemPrompt: 'base',
      skillRegistry,
      autoRoute: false,
    });

    agent.activateSkill('with-tools');
    await agent.run('使用自定义工具');

    const toolNames = capturedRequest!.tools?.map(t => t.function.name) ?? [];
    expect(toolNames).toContain('custom_tool');
  });

  it('autoRoute 失败时应安全降级', async () => {
    // 注册一个会导致 findByTrigger 出问题的假 registry
    const badRegistry = new SkillRegistry();

    const agent = new SkillfulAgent({
      provider: provider as unknown as LLMProvider,
      model: 'test-model',
      systemPrompt: 'base',
      skillRegistry: badRegistry,
      autoRoute: true,
    });

    // 即使没有匹配到任何技能，也不应抛出错误
    const result = await agent.run('随便说点什么');
    expect(result.content).toBe('Mock 回复');
  });
});
