/**
 * JSON-RPC 2.0 工具函数测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRequest,
  createNotification,
  createResponse,
  createErrorResponse,
  isRequest,
  isNotification,
  isResponse,
  parseMessage,
  serializeMessage,
  resetIdCounter,
  JSON_RPC_ERRORS,
} from '../json-rpc.js';

describe('JSON-RPC', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('createRequest', () => {
    it('应创建带自增 ID 的请求', () => {
      const req1 = createRequest('tools/list');
      const req2 = createRequest('tools/call', { name: 'test' });

      expect(req1.jsonrpc).toBe('2.0');
      expect(req1.id).toBe(1);
      expect(req1.method).toBe('tools/list');
      expect(req1.params).toBeUndefined();

      expect(req2.id).toBe(2);
      expect(req2.params).toEqual({ name: 'test' });
    });
  });

  describe('createNotification', () => {
    it('应创建不带 ID 的通知', () => {
      const notif = createNotification('notifications/initialized');
      expect(notif.jsonrpc).toBe('2.0');
      expect(notif.method).toBe('notifications/initialized');
      expect('id' in notif).toBe(false);
    });
  });

  describe('createResponse / createErrorResponse', () => {
    it('应创建成功响应', () => {
      const resp = createResponse(1, { tools: [] });
      expect(resp.id).toBe(1);
      expect(resp.result).toEqual({ tools: [] });
      expect(resp.error).toBeUndefined();
    });

    it('应创建错误响应', () => {
      const resp = createErrorResponse(1, -32601, 'Method not found');
      expect(resp.id).toBe(1);
      expect(resp.error?.code).toBe(-32601);
      expect(resp.error?.message).toBe('Method not found');
      expect(resp.result).toBeUndefined();
    });
  });

  describe('类型守卫', () => {
    it('isRequest 应正确识别请求', () => {
      const req = createRequest('test');
      const notif = createNotification('test');
      const resp = createResponse(1, {});

      expect(isRequest(req)).toBe(true);
      expect(isRequest(notif)).toBe(false);
      expect(isRequest(resp)).toBe(false);
    });

    it('isNotification 应正确识别通知', () => {
      const notif = createNotification('test');
      const req = createRequest('test');

      expect(isNotification(notif)).toBe(true);
      expect(isNotification(req)).toBe(false);
    });

    it('isResponse 应正确识别响应', () => {
      const resp = createResponse(1, {});
      const req = createRequest('test');

      expect(isResponse(resp)).toBe(true);
      expect(isResponse(req)).toBe(false);
    });
  });

  describe('parseMessage / serializeMessage', () => {
    it('应正确序列化/反序列化', () => {
      const req = createRequest('tools/list', { cursor: 'abc' });
      const serialized = serializeMessage(req);

      expect(serialized).not.toContain('\n');

      const parsed = parseMessage(serialized);
      expect(parsed).toEqual(req);
    });

    it('非 JSON-RPC 2.0 消息应抛异常', () => {
      expect(() => parseMessage('{"jsonrpc":"1.0"}')).toThrow('Not a JSON-RPC 2.0');
    });

    it('无效 JSON 应抛异常', () => {
      expect(() => parseMessage('not json')).toThrow();
    });
  });

  describe('JSON_RPC_ERRORS', () => {
    it('应有标准错误码', () => {
      expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700);
      expect(JSON_RPC_ERRORS.INVALID_REQUEST).toBe(-32600);
      expect(JSON_RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
      expect(JSON_RPC_ERRORS.INVALID_PARAMS).toBe(-32602);
      expect(JSON_RPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
    });
  });
});
