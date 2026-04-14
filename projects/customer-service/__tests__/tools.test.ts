/**
 * 客服工具 -- 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  lookupUserTool,
  queryOrdersTool,
  createTicketTool,
  transferToHumanTool,
  searchKnowledgeTool,
  checkServiceStatusTool,
  getAllTools,
  getTickets,
  resetTickets,
  setRAGPipeline,
} from '../tools.js';

describe('客服工具', () => {
  beforeEach(() => {
    resetTickets();
  });

  describe('lookup_user', () => {
    it('应通过 ID 查找用户', async () => {
      const result = JSON.parse(await lookupUserTool.execute({ query: 'U001' }));
      expect(result.found).toBe(true);
      expect(result.user.name).toBe('张三');
      expect(result.user.plan).toBe('pro');
    });

    it('应通过邮箱查找用户', async () => {
      const result = JSON.parse(await lookupUserTool.execute({ query: 'lisi@example.com' }));
      expect(result.found).toBe(true);
      expect(result.user.name).toBe('李四');
    });

    it('找不到用户时应返回 found: false', async () => {
      const result = JSON.parse(await lookupUserTool.execute({ query: 'U999' }));
      expect(result.found).toBe(false);
    });

    it('应返回用量信息', async () => {
      const result = JSON.parse(await lookupUserTool.execute({ query: 'U001' }));
      expect(result.user.usage.apiCalls).toBe(4520);
      expect(result.user.usage.dialogCount).toBe(230);
    });
  });

  describe('query_orders', () => {
    it('应查询用户订单', async () => {
      const result = JSON.parse(await queryOrdersTool.execute({ userId: 'U001' }));
      expect(result.found).toBe(true);
      expect(result.orders.length).toBe(2);
      expect(result.orders[0].plan).toContain('Pro');
    });

    it('无订单时应返回 found: false', async () => {
      const result = JSON.parse(await queryOrdersTool.execute({ userId: 'U003' }));
      expect(result.found).toBe(false);
    });
  });

  describe('create_ticket', () => {
    it('应成功创建工单', async () => {
      const result = JSON.parse(await createTicketTool.execute({
        userId: 'U001',
        subject: '退款申请',
        description: '要求退还年费',
        priority: 'high',
      }));

      expect(result.success).toBe(true);
      expect(result.ticket.ticketId).toMatch(/^TK-/);
      expect(result.ticket.status).toBe('open');
    });

    it('创建的工单应出现在工单列表中', async () => {
      await createTicketTool.execute({
        userId: 'U002',
        subject: '功能咨询',
        description: '如何使用知识库',
        priority: 'low',
      });

      const tickets = getTickets();
      expect(tickets.length).toBe(1);
      expect(tickets[0]!.subject).toBe('功能咨询');
      expect(tickets[0]!.userId).toBe('U002');
    });
  });

  describe('transfer_to_human', () => {
    it('应返回转接信息', async () => {
      const result = JSON.parse(await transferToHumanTool.execute({
        userId: 'U001',
        reason: '退款需求',
        summary: '用户要求退还 Pro 年费',
      }));

      expect(result.success).toBe(true);
      expect(result.transferInfo.queuePosition).toBeGreaterThan(0);
    });
  });

  describe('search_knowledge', () => {
    it('未初始化知识库时应返回错误', async () => {
      setRAGPipeline(undefined as any);
      const result = JSON.parse(await searchKnowledgeTool.execute({ query: 'price' }));
      expect(result.error).toBeDefined();
    });
  });

  describe('check_service_status', () => {
    it('应返回服务状态列表', async () => {
      const result = JSON.parse(await checkServiceStatusTool.execute({}));
      expect(result.services.length).toBeGreaterThan(0);
      expect(result.services[0].name).toBe('TinyBot API');
      expect(result.services[0].status).toBe('operational');
    });
  });

  describe('getAllTools', () => {
    it('应返回所有 6 个工具', () => {
      const tools = getAllTools();
      expect(tools.length).toBe(6);
      const names = tools.map((t) => t.name);
      expect(names).toContain('lookup_user');
      expect(names).toContain('query_orders');
      expect(names).toContain('create_ticket');
      expect(names).toContain('transfer_to_human');
      expect(names).toContain('search_knowledge');
      expect(names).toContain('check_service_status');
    });
  });

  describe('resetTickets', () => {
    it('应清空工单列表', async () => {
      await createTicketTool.execute({
        userId: 'U001', subject: 'Test', description: 'Test', priority: 'low',
      });
      expect(getTickets().length).toBe(1);

      resetTickets();
      expect(getTickets().length).toBe(0);
    });
  });
});
