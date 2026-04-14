/**
 * PIIDetector 单元测试
 */

import { describe, it, expect } from 'vitest';
import { PIIDetector } from '../pii-detector.js';

describe('PIIDetector', () => {
  const detector = new PIIDetector();

  describe('邮箱检测', () => {
    it('应检测邮箱地址', async () => {
      const result = await detector.check('Send to alice@example.com please');
      expect(result.passed).toBe(false);
      expect(result.violations!.some((v) => v.type === 'pii_email')).toBe(true);
    });

    it('不含邮箱的文本应通过', async () => {
      const result = await detector.check('Contact us at our website');
      expect(result.passed).toBe(true);
    });
  });

  describe('手机号检测', () => {
    it('应检测中国手机号', async () => {
      const result = await detector.check('我的电话是 13812345678');
      expect(result.passed).toBe(false);
      expect(result.violations!.some((v) => v.type === 'pii_phone')).toBe(true);
    });

    it('应检测带区号的中国手机号', async () => {
      const result = await detector.check('Call +86 13912345678');
      expect(result.passed).toBe(false);
    });
  });

  describe('身份证号检测', () => {
    it('应检测 18 位身份证号', async () => {
      const result = await detector.check('身份证号：110101199001011234');
      expect(result.passed).toBe(false);
      expect(result.violations!.some((v) => v.type === 'pii_id_card')).toBe(true);
    });

    it('应检测末尾 X 的身份证号', async () => {
      const result = await detector.check('ID: 11010119900101123X');
      expect(result.passed).toBe(false);
    });
  });

  describe('银行卡号检测', () => {
    it('应检测合法银行卡号（Luhn 校验）', async () => {
      // 4532015112830366 通过 Luhn 校验
      const result = await detector.check('Card: 4532015112830366');
      expect(result.passed).toBe(false);
      expect(result.violations!.some((v) => v.type === 'pii_bank_card')).toBe(true);
    });

    it('不通过 Luhn 校验的数字序列应放行', async () => {
      // 仅银行卡检测器，隔离测试
      const bankOnly = new PIIDetector({ enabledCategories: ['bank_card'] });
      const result = await bankOnly.check('Number: 1234567890123456');
      // 1234567890123456 不通过 Luhn 校验 → 不视为银行卡
      expect(result.passed).toBe(true);
    });
  });

  describe('API Key 检测', () => {
    it('应检测 sk- 前缀的密钥', async () => {
      const result = await detector.check('secret: sk-abcdefghijklmnopqrstuvwxyz1234');
      expect(result.passed).toBe(false);
      expect(result.violations!.some((v) => v.type === 'pii_api_key')).toBe(true);
    });

    it('应检测 api_key= 格式', async () => {
      const result = await detector.check('api_key=abc123def456ghi789jkl012mno345');
      expect(result.passed).toBe(false);
    });
  });

  describe('IP 地址检测', () => {
    it('应检测 IPv4 地址', async () => {
      const result = await detector.check('Server at 192.168.1.100');
      expect(result.passed).toBe(false);
      expect(result.violations!.some((v) => v.type === 'pii_ip_address')).toBe(true);
    });
  });

  describe('分类过滤', () => {
    it('应只检测启用的类别', async () => {
      const emailOnly = new PIIDetector({
        enabledCategories: ['email'],
      });

      // 邮箱应被检测
      const r1 = await emailOnly.check('alice@example.com');
      expect(r1.passed).toBe(false);

      // 手机号应被放行
      const r2 = await emailOnly.check('13812345678');
      expect(r2.passed).toBe(true);
    });
  });

  describe('PII 遮蔽', () => {
    it('应遮蔽邮箱地址', () => {
      const masked = detector.mask('Contact alice@example.com');
      expect(masked).toContain('al***@example.com');
      expect(masked).not.toContain('alice@example.com');
    });

    it('应遮蔽手机号', () => {
      const masked = detector.mask('Call 13812345678');
      expect(masked).toContain('138****5678');
    });

    it('应遮蔽身份证号', () => {
      const masked = detector.mask('ID: 110101199001011234');
      expect(masked).toContain('110101');
      expect(masked).toContain('1234');
      expect(masked).not.toContain('110101199001011234');
    });
  });

  describe('自定义规则', () => {
    it('应支持自定义 PII 检测规则', async () => {
      const custom = new PIIDetector({
        customRules: [
          { name: 'employee_id', pattern: /EMP-\d{6}/g },
        ],
      });

      const result = await custom.check('Employee EMP-123456 report');
      expect(result.passed).toBe(false);
      expect(result.violations!.some((v) => v.type === 'pii_custom_employee_id')).toBe(true);
    });
  });

  describe('无 PII 内容', () => {
    it('正常文本应通过', async () => {
      const result = await detector.check('TypeScript is a typed superset of JavaScript');
      expect(result.passed).toBe(true);
      expect(result.violations).toBeUndefined();
    });
  });
});
