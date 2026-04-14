/**
 * 记忆系统核心类型
 */

import type { Message } from '../types.js';

// ============================================================
// 记忆条目 -- 长期记忆的基本单元
// ============================================================

export interface MemoryEntry {
  /** 唯一标识 */
  id: string;

  /** 记忆内容 */
  content: string;

  /** 元数据（来源、标签等） */
  metadata: Record<string, unknown>;

  /** 创建时间 */
  createdAt: number;

  /** 最后访问时间（用于 LRU 策略） */
  lastAccessedAt: number;

  /** 重要性评分 0-1（越高越不容易被淘汰） */
  importance: number;
}

// ============================================================
// 会话摘要
// ============================================================

export interface ConversationSummary {
  /** 摘要内容 */
  content: string;

  /** 摘要覆盖的消息数 */
  messageCount: number;

  /** 生成时间 */
  createdAt: number;
}

// ============================================================
// MemoryStore 抽象接口 -- 策略模式
// ============================================================

export interface MemoryStore {
  /** 存储名称 */
  readonly name: string;

  /** 添加记忆 */
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<MemoryEntry>;

  /** 按 ID 获取 */
  get(id: string): Promise<MemoryEntry | null>;

  /** 搜索记忆（简单文本匹配，后续 RAG 章节会升级为向量搜索） */
  search(query: string, limit?: number): Promise<MemoryEntry[]>;

  /** 获取全部记忆 */
  list(): Promise<MemoryEntry[]>;

  /** 删除记忆 */
  delete(id: string): Promise<boolean>;

  /** 清空全部 */
  clear(): Promise<void>;

  /** 记忆条数 */
  size(): Promise<number>;
}

// ============================================================
// 对话窗口策略
// ============================================================

export interface WindowStrategy {
  /** 策略名称 */
  readonly name: string;

  /**
   * 从消息历史中选取要发送给 LLM 的消息
   * @param messages 完整的消息历史（不含 system prompt）
   * @param maxMessages 最大消息数
   * @returns 裁剪后的消息列表
   */
  apply(messages: Message[], maxMessages: number): Message[];
}
