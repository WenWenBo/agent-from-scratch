/**
 * 客服智能体 -- 工具定义
 *
 * 模拟真实客服场景中的业务工具：
 * - 用户信息查询
 * - 订单管理
 * - 工单创建/转人工
 * - 知识库搜索（RAG）
 */

import { z } from 'zod';
import { defineTool } from '../../src/tools/tool.js';
import type { RAGPipeline } from '../../src/rag/rag-pipeline.js';

// ============================================================
// 模拟数据库
// ============================================================

export interface UserRecord {
  userId: string;
  name: string;
  email: string;
  plan: 'free' | 'lite' | 'pro';
  registeredAt: string;
  apiCalls: number;
  dialogCount: number;
}

export interface OrderRecord {
  orderId: string;
  userId: string;
  plan: string;
  amount: number;
  status: 'active' | 'cancelled' | 'refunded' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export interface TicketRecord {
  ticketId: string;
  userId: string;
  subject: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
}

const users: Map<string, UserRecord> = new Map([
  ['U001', {
    userId: 'U001', name: '张三', email: 'zhangsan@example.com',
    plan: 'pro', registeredAt: '2025-01-15', apiCalls: 4520, dialogCount: 230,
  }],
  ['U002', {
    userId: 'U002', name: '李四', email: 'lisi@example.com',
    plan: 'lite', registeredAt: '2025-06-20', apiCalls: 0, dialogCount: 85,
  }],
  ['U003', {
    userId: 'U003', name: '王五', email: 'wangwu@example.com',
    plan: 'free', registeredAt: '2026-03-01', apiCalls: 0, dialogCount: 8,
  }],
]);

const orders: Map<string, OrderRecord> = new Map([
  ['ORD-2025-001', {
    orderId: 'ORD-2025-001', userId: 'U001', plan: 'TinyBot Pro 年付',
    amount: 2999, status: 'active', createdAt: '2025-01-15', expiresAt: '2026-01-15',
  }],
  ['ORD-2025-002', {
    orderId: 'ORD-2025-002', userId: 'U001', plan: 'TinyBot Pro 年付',
    amount: 2999, status: 'active', createdAt: '2026-01-15', expiresAt: '2027-01-15',
  }],
  ['ORD-2025-003', {
    orderId: 'ORD-2025-003', userId: 'U002', plan: 'TinyBot Lite 月付',
    amount: 99, status: 'active', createdAt: '2026-03-20', expiresAt: '2026-04-20',
  }],
]);

const tickets: TicketRecord[] = [];

// ============================================================
// RAG Pipeline（运行时注入）
// ============================================================

let ragPipeline: RAGPipeline | undefined;

export function setRAGPipeline(pipeline: RAGPipeline): void {
  ragPipeline = pipeline;
}

// ============================================================
// 工具定义
// ============================================================

export const lookupUserTool = defineTool({
  name: 'lookup_user',
  description: '根据用户 ID 或邮箱查询用户信息，包括当前套餐、注册时间、使用量等',
  parameters: z.object({
    query: z.string().describe('用户 ID（如 U001）或邮箱地址'),
  }),
  execute: async ({ query }) => {
    const user = users.get(query)
      ?? [...users.values()].find((u) => u.email === query);

    if (!user) {
      return JSON.stringify({ found: false, message: `未找到用户: ${query}` });
    }

    return JSON.stringify({
      found: true,
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        plan: user.plan,
        registeredAt: user.registeredAt,
        usage: {
          apiCalls: user.apiCalls,
          dialogCount: user.dialogCount,
        },
      },
    });
  },
});

export const queryOrdersTool = defineTool({
  name: 'query_orders',
  description: '查询用户的订单记录，包括套餐名称、金额、状态、有效期等',
  parameters: z.object({
    userId: z.string().describe('用户 ID'),
  }),
  execute: async ({ userId }) => {
    const userOrders = [...orders.values()].filter((o) => o.userId === userId);
    if (userOrders.length === 0) {
      return JSON.stringify({ found: false, message: `用户 ${userId} 没有订单记录` });
    }
    return JSON.stringify({ found: true, orders: userOrders });
  },
});

export const createTicketTool = defineTool({
  name: 'create_ticket',
  description: '为用户创建客服工单。用于需要人工跟进的问题，如退款、账户异常、技术故障等',
  parameters: z.object({
    userId: z.string().describe('用户 ID'),
    subject: z.string().describe('工单主题'),
    description: z.string().describe('问题详细描述'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).describe('优先级'),
  }),
  execute: async ({ userId, subject, description, priority }) => {
    const ticket: TicketRecord = {
      ticketId: `TK-${Date.now()}`,
      userId,
      subject,
      description,
      priority,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    tickets.push(ticket);
    return JSON.stringify({
      success: true,
      ticket: { ticketId: ticket.ticketId, status: ticket.status },
      message: `工单已创建，编号 ${ticket.ticketId}。我们的客服团队会尽快处理。`,
    });
  },
});

export const transferToHumanTool = defineTool({
  name: 'transfer_to_human',
  description: '将对话转接给人工客服。当 AI 无法解决问题或用户要求转人工时使用',
  parameters: z.object({
    userId: z.string().describe('用户 ID'),
    reason: z.string().describe('转接原因'),
    summary: z.string().describe('对话摘要，帮助人工客服快速了解上下文'),
  }),
  execute: async ({ userId, reason, summary }) => {
    return JSON.stringify({
      success: true,
      message: '已为您转接人工客服，预计等待时间 2-5 分钟。',
      transferInfo: { userId, reason, summary, queuePosition: 3 },
    });
  },
});

export const searchKnowledgeTool = defineTool({
  name: 'search_knowledge',
  description: '搜索客服知识库，查找产品信息、FAQ、政策等。用于回答用户关于产品功能、价格、使用方法的问题',
  parameters: z.object({
    query: z.string().describe('搜索关键词或问题'),
  }),
  execute: async ({ query }) => {
    if (!ragPipeline) {
      return JSON.stringify({ error: '知识库未初始化' });
    }
    const results = await ragPipeline.retrieve(query);
    if (results.length === 0) {
      return JSON.stringify({ found: false, message: '未找到相关信息' });
    }
    return JSON.stringify({
      found: true,
      results: results.map((r) => ({
        content: r.content,
        score: r.score.toFixed(3),
        source: r.metadata?.source ?? 'unknown',
      })),
    });
  },
});

export const checkServiceStatusTool = defineTool({
  name: 'check_service_status',
  description: '检查 TinyBot 各服务的运行状态',
  parameters: z.object({}),
  execute: async () => {
    return JSON.stringify({
      services: [
        { name: 'TinyBot API', status: 'operational', latency: '120ms' },
        { name: 'Web 客户端', status: 'operational', latency: '85ms' },
        { name: '知识库服务', status: 'operational', latency: '200ms' },
        { name: '支付系统', status: 'operational', latency: '150ms' },
      ],
      lastChecked: new Date().toISOString(),
    });
  },
});

// ============================================================
// 获取所有工具
// ============================================================

export function getAllTools() {
  return [
    lookupUserTool,
    queryOrdersTool,
    createTicketTool,
    transferToHumanTool,
    searchKnowledgeTool,
    checkServiceStatusTool,
  ];
}

export function getTickets(): TicketRecord[] {
  return [...tickets];
}

export function resetTickets(): void {
  tickets.length = 0;
}
