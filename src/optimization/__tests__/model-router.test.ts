/**
 * ModelRouter -- 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { ModelRouter } from '../model-router.js';
import type { ModelConfig, RoutingRule } from '../model-router.js';
import type { ChatRequest } from '../../types.js';

function createMockModels(): ModelConfig[] {
  return [
    {
      name: 'gpt-4o-mini',
      provider: { chat: vi.fn(), stream: vi.fn() } as any,
      costPer1MPrompt: 0.15,
      costPer1MCompletion: 0.6,
      maxTokens: 16384,
      capabilityLevel: 3,
    },
    {
      name: 'gpt-4o',
      provider: { chat: vi.fn(), stream: vi.fn() } as any,
      costPer1MPrompt: 2.5,
      costPer1MCompletion: 10,
      maxTokens: 128000,
      capabilityLevel: 8,
    },
  ];
}

const makeRequest = (content: string, toolCount = 0): ChatRequest => ({
  model: '',
  messages: [{ role: 'user', content }],
  tools: toolCount > 0
    ? Array.from({ length: toolCount }, (_, i) => ({
        type: 'function' as const,
        function: { name: `tool_${i}`, description: `Tool ${i}`, parameters: {} },
      }))
    : undefined,
});

describe('ModelRouter', () => {
  it('简单请求应路由到低级模型', () => {
    const router = new ModelRouter({
      models: createMockModels(),
      defaultModel: 'gpt-4o',
    });

    const { model, reason } = router.route(makeRequest('Hi'));
    expect(model.name).toBe('gpt-4o-mini');
    expect(reason).toContain('simple');
  });

  it('复杂请求应路由到高级模型', () => {
    const router = new ModelRouter({
      models: createMockModels(),
      defaultModel: 'gpt-4o',
    });

    const { model } = router.route(
      makeRequest('Please analyze and compare the architectural patterns in detail, step by step, for this complex multi-tier distributed system with microservices and event sourcing', 3)
    );
    expect(model.name).toBe('gpt-4o');
  });

  it('显式规则应优先于复杂度分类', () => {
    const rules: RoutingRule[] = [{
      name: 'force-mini',
      condition: (req) => {
        const msg = req.messages[req.messages.length - 1];
        return 'content' in msg && (msg.content ?? '').includes('cheap');
      },
      targetModel: 'gpt-4o-mini',
      priority: 10,
    }];

    const router = new ModelRouter({
      models: createMockModels(),
      rules,
      defaultModel: 'gpt-4o',
    });

    const { model, reason } = router.route(
      makeRequest('Please analyze this complex system in detail cheap')
    );
    expect(model.name).toBe('gpt-4o-mini');
    expect(reason).toContain('Rule matched');
  });

  it('应支持自定义分类器', () => {
    const router = new ModelRouter({
      models: createMockModels(),
      defaultModel: 'gpt-4o',
      classifier: () => 'complex',
    });

    const { model } = router.route(makeRequest('hi'));
    expect(model.name).toBe('gpt-4o');
  });

  it('defaultClassifier 应识别简短问候为 simple', () => {
    const level = ModelRouter.defaultClassifier(makeRequest('Hello'));
    expect(level).toBe('simple');
  });

  it('defaultClassifier 应识别长复杂问题为 complex', () => {
    const level = ModelRouter.defaultClassifier(
      makeRequest(
        'Please analyze and compare in detail the architectural trade-offs between microservices and monoliths, step by step, considering scalability, maintainability, and deployment complexity. ' +
        'Also explain how event sourcing and CQRS patterns fit into each architecture. '.repeat(3),
        5
      )
    );
    expect(level).toBe('complex');
  });

  it('应记录路由历史统计', () => {
    const router = new ModelRouter({
      models: createMockModels(),
      defaultModel: 'gpt-4o',
    });

    router.route(makeRequest('Hi'));
    router.route(makeRequest('Hello'));
    router.route(makeRequest('Analyze this complex system in detail step by step with multiple architectural patterns'));

    const stats = router.getRoutingStats();
    expect(stats.totalRoutes).toBe(3);
    expect(stats.byModel['gpt-4o-mini']).toBeGreaterThanOrEqual(1);
  });

  it('chat() 应调用正确的 provider', async () => {
    const models = createMockModels();
    (models[0]!.provider.chat as any).mockResolvedValue({
      id: 'resp-1', content: 'Hi!', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, finishReason: 'stop',
    });

    const router = new ModelRouter({
      models,
      defaultModel: 'gpt-4o',
    });

    const response = await router.chat(makeRequest('Hi'));
    expect(response.content).toBe('Hi!');
    expect(response.routedModel).toBe('gpt-4o-mini');
    expect(models[0]!.provider.chat).toHaveBeenCalled();
  });

  it('getModelConfig 应返回配置', () => {
    const router = new ModelRouter({
      models: createMockModels(),
      defaultModel: 'gpt-4o',
    });

    expect(router.getModelConfig('gpt-4o')?.capabilityLevel).toBe(8);
    expect(router.getModelConfig('nonexistent')).toBeUndefined();
  });
});
