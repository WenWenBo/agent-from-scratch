/**
 * Model Router -- 智能模型路由
 *
 * 根据任务复杂度自动选择合适的模型：
 * - 简单问题 → 便宜/快速的模型（如 gpt-4o-mini）
 * - 复杂问题 → 强大/昂贵的模型（如 gpt-4o）
 *
 * 路由策略：
 * 1. 基于规则的路由（关键词、长度、工具需求）
 * 2. 基于分类器的路由（LLM 判断复杂度）
 * 3. 级联路由（先用便宜模型，不满意再用贵模型）
 *
 * 参考:
 * - OpenRouter: https://openrouter.ai/
 * - Martian Model Router: https://docs.withmartian.com/
 */

import type { LLMProvider } from '../providers/base.js';
import type { ChatRequest, ChatResponse } from '../types.js';

// ============================================================
// 模型配置
// ============================================================

export interface ModelConfig {
  name: string;
  provider: LLMProvider;
  costPer1MPrompt: number;
  costPer1MCompletion: number;
  maxTokens: number;
  /** 能力等级 1-10，用于路由决策 */
  capabilityLevel: number;
}

// ============================================================
// 路由规则
// ============================================================

export interface RoutingRule {
  name: string;
  condition: (request: ChatRequest) => boolean;
  targetModel: string;
  priority: number;
}

// ============================================================
// 复杂度分类
// ============================================================

export type ComplexityLevel = 'simple' | 'moderate' | 'complex';

// ============================================================
// 配置
// ============================================================

export interface ModelRouterOptions {
  models: ModelConfig[];
  /** 路由规则（按 priority 降序排列） */
  rules?: RoutingRule[];
  /** 默认模型名称（无规则匹配时） */
  defaultModel: string;
  /** 用于复杂度判断的分类函数 */
  classifier?: (request: ChatRequest) => ComplexityLevel;
}

// ============================================================
// ModelRouter
// ============================================================

export class ModelRouter {
  private models: Map<string, ModelConfig> = new Map();
  private rules: RoutingRule[];
  private defaultModel: string;
  private classifier: (request: ChatRequest) => ComplexityLevel;
  private routingHistory: Array<{ model: string; complexity: ComplexityLevel; timestamp: number }> = [];

  constructor(options: ModelRouterOptions) {
    for (const model of options.models) {
      this.models.set(model.name, model);
    }
    this.rules = (options.rules ?? []).sort((a, b) => b.priority - a.priority);
    this.defaultModel = options.defaultModel;
    this.classifier = options.classifier ?? ModelRouter.defaultClassifier;
  }

  // ============================================================
  // 路由决策
  // ============================================================

  route(request: ChatRequest): { model: ModelConfig; reason: string } {
    // 1. 检查显式规则
    for (const rule of this.rules) {
      if (rule.condition(request)) {
        const model = this.models.get(rule.targetModel);
        if (model) {
          this.recordRouting(model.name, 'moderate');
          return { model, reason: `Rule matched: ${rule.name}` };
        }
      }
    }

    // 2. 基于复杂度分类
    const complexity = this.classifier(request);
    const model = this.selectByComplexity(complexity);

    this.recordRouting(model.name, complexity);
    return { model, reason: `Complexity: ${complexity}` };
  }

  /**
   * 执行路由并调用对应模型
   */
  async chat(request: ChatRequest): Promise<ChatResponse & { routedModel: string; routeReason: string }> {
    const { model, reason } = this.route(request);
    const response = await model.provider.chat({
      ...request,
      model: model.name,
    });

    return { ...response, routedModel: model.name, routeReason: reason };
  }

  // ============================================================
  // 复杂度分类
  // ============================================================

  private selectByComplexity(complexity: ComplexityLevel): ModelConfig {
    const models = [...this.models.values()].sort(
      (a, b) => a.capabilityLevel - b.capabilityLevel
    );

    switch (complexity) {
      case 'simple':
        return models[0] ?? this.getDefault();

      case 'moderate':
        return models[Math.floor(models.length / 2)] ?? this.getDefault();

      case 'complex':
        return models[models.length - 1] ?? this.getDefault();
    }
  }

  static defaultClassifier(request: ChatRequest): ComplexityLevel {
    const lastMessage = request.messages[request.messages.length - 1];
    const content = lastMessage && 'content' in lastMessage
      ? (lastMessage.content ?? '')
      : '';

    const hasTools = (request.tools?.length ?? 0) > 0;
    const messageCount = request.messages.length;
    const contentLength = content.length;

    // 复杂度信号
    let complexityScore = 0;

    if (contentLength > 500) complexityScore += 2;
    else if (contentLength > 200) complexityScore += 1;

    if (messageCount > 10) complexityScore += 2;
    else if (messageCount > 5) complexityScore += 1;

    if (hasTools) complexityScore += 1;

    const complexKeywords = /analyz|compar|explain.*detail|step.by.step|reason|complex|multi|architect/i;
    if (complexKeywords.test(content)) complexityScore += 2;

    const simpleKeywords = /^(hi|hello|yes|no|ok|thanks|what is|who is|when)/i;
    if (simpleKeywords.test(content) && contentLength < 50) complexityScore -= 2;

    if (complexityScore >= 4) return 'complex';
    if (complexityScore >= 2) return 'moderate';
    return 'simple';
  }

  // ============================================================
  // 统计
  // ============================================================

  getRoutingStats(): {
    totalRoutes: number;
    byModel: Record<string, number>;
    byComplexity: Record<ComplexityLevel, number>;
  } {
    const byModel: Record<string, number> = {};
    const byComplexity: Record<ComplexityLevel, number> = { simple: 0, moderate: 0, complex: 0 };

    for (const record of this.routingHistory) {
      byModel[record.model] = (byModel[record.model] ?? 0) + 1;
      byComplexity[record.complexity]++;
    }

    return { totalRoutes: this.routingHistory.length, byModel, byComplexity };
  }

  getModelConfig(name: string): ModelConfig | undefined {
    return this.models.get(name);
  }

  // ============================================================
  // 内部
  // ============================================================

  private getDefault(): ModelConfig {
    return this.models.get(this.defaultModel) ?? [...this.models.values()][0]!;
  }

  private recordRouting(model: string, complexity: ComplexityLevel): void {
    this.routingHistory.push({ model, complexity, timestamp: Date.now() });
  }
}
