/**
 * Evaluator -- 评估器抽象接口
 *
 * 所有评估器实现统一接口，可在 EvalRunner 中自由组合。
 *
 * 参考：
 * - LangSmith Evaluation: https://docs.smith.langchain.com/evaluation
 * - Langfuse Scores: https://langfuse.com/docs/scores
 * - Ragas: https://docs.ragas.io/
 */

// ============================================================
// 评估输入
// ============================================================

export interface EvalInput {
  /** 用户输入 / 问题 */
  input: string;
  /** Agent 的实际输出 */
  output: string;
  /** 期望的参考答案（如果有） */
  expected?: string;
  /** 检索到的上下文（RAG 场景） */
  context?: string[];
  /** 额外的元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// 评估结果
// ============================================================

export interface EvalResult {
  /** 评估器名称 */
  evaluatorName: string;
  /** 分数 0-1，1 为最佳 */
  score: number;
  /** 是否通过（可由评估器自定义阈值） */
  passed: boolean;
  /** 可读的理由说明 */
  reason: string;
  /** 额外的结构化数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// Evaluator 接口
// ============================================================

export interface Evaluator {
  readonly name: string;
  evaluate(input: EvalInput): Promise<EvalResult>;
}
