/**
 * Multi-Agent 系统模块导出
 */

export type {
  BaseAgent,
  TaskInput,
  TaskOutput,
  MultiAgentEvent,
} from './base-agent.js';

export { AgentWrapper } from './agent-wrapper.js';
export type { AgentWrapperOptions } from './agent-wrapper.js';

export { SequentialPipeline } from './sequential.js';
export type { SequentialPipelineOptions } from './sequential.js';

export { ParallelFanOut } from './parallel.js';
export type { ParallelFanOutOptions, AggregationStrategy } from './parallel.js';

export { Orchestrator } from './orchestrator.js';
export type { OrchestratorOptions } from './orchestrator.js';

export { Supervisor } from './supervisor.js';
export type { SupervisorOptions } from './supervisor.js';
