/**
 * 安全护栏模块导出
 */

// 核心接口
export { GuardrailPipeline } from './guardrail.js';
export type {
  Guardrail,
  GuardrailResult,
  GuardrailContext,
  GuardrailStage,
  Violation,
  GuardrailPipelineResult,
} from './guardrail.js';

// 内容过滤
export { ContentFilter } from './content-filter.js';
export type { ContentFilterOptions } from './content-filter.js';

// Prompt 注入防御
export { PromptInjectionDetector } from './prompt-injection.js';
export type { PromptInjectionOptions } from './prompt-injection.js';

// PII 检测
export { PIIDetector } from './pii-detector.js';
export type { PIIDetectorOptions, PIICategory } from './pii-detector.js';

// 工具调用守卫
export { ToolCallGuard } from './tool-guard.js';
export type { ToolCallGuardOptions, ParameterRule, ToolCallCheckResult } from './tool-guard.js';

// 速率限制
export { RateLimiter } from './rate-limiter.js';
export type { RateLimiterOptions } from './rate-limiter.js';

// GuardedAgent
export { GuardedAgent } from './guarded-agent.js';
export type { GuardedAgentOptions, GuardrailEvent } from './guarded-agent.js';
