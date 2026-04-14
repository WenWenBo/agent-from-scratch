/**
 * PIIDetector -- 敏感信息（个人可识别信息）检测护栏
 *
 * 检测并拦截包含敏感信息的内容：
 * - 邮箱地址
 * - 手机号（中国、国际格式）
 * - 身份证号（中国 18 位）
 * - 银行卡号（Luhn 校验）
 * - IP 地址
 * - API Key / Secret 模式
 *
 * 纯正则实现，覆盖常见模式。
 * 生产环境建议配合 NER（命名实体识别）模型使用。
 */

import type {
  Guardrail,
  GuardrailResult,
  GuardrailContext,
  GuardrailStage,
  Violation,
} from './guardrail.js';

// ============================================================
// 配置
// ============================================================

export interface PIIDetectorOptions {
  /** 适用阶段 */
  stage?: GuardrailStage | 'both';

  /** 启用的检测类别（默认全部启用） */
  enabledCategories?: PIICategory[];

  /** 自定义检测规则 */
  customRules?: Array<{
    name: string;
    pattern: RegExp;
    severity?: Violation['severity'];
  }>;

  /** 是否进行遮蔽而非拦截（返回 passed=true + 遮蔽后的文本） */
  maskMode?: boolean;
}

export type PIICategory =
  | 'email'
  | 'phone'
  | 'id_card'
  | 'bank_card'
  | 'ip_address'
  | 'api_key';

// ============================================================
// 内置检测规则
// ============================================================

interface PIIRule {
  category: PIICategory;
  pattern: RegExp;
  description: string;
  severity: Violation['severity'];
  mask: (match: string) => string;
}

const PII_RULES: PIIRule[] = [
  {
    category: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    description: 'Email address detected',
    severity: 'medium',
    mask: (m) => m.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
  },
  {
    category: 'phone',
    pattern: /(?:(?:\+?86[-\s]?)?1[3-9]\d{9})/g,
    description: 'Phone number detected (China)',
    severity: 'high',
    mask: (m) => m.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'),
  },
  {
    category: 'phone',
    pattern: /(?:\+?1[-.\s]?)?(?:\(?[2-9]\d{2}\)?[-.\s]?)[2-9]\d{2}[-.\s]?\d{4}/g,
    description: 'Phone number detected (US)',
    severity: 'high',
    mask: (m) => m.replace(/(\d{3})\d{3}(\d{4})/, '$1***$2'),
  },
  {
    category: 'id_card',
    pattern: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    description: 'ID card number detected (China 18-digit)',
    severity: 'critical',
    mask: (m) => m.replace(/^(.{6}).*(.{4})$/, '$1********$2'),
  },
  {
    category: 'bank_card',
    pattern: /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g,
    description: 'Bank card number detected',
    severity: 'critical',
    mask: (m) => m.replace(/\d(?=\d{4})/g, '*'),
  },
  {
    category: 'ip_address',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    description: 'IP address detected',
    severity: 'low',
    mask: (m) => m.replace(/\.\d+\.\d+$/, '.***. ***'),
  },
  {
    category: 'api_key',
    pattern: /(?:sk|pk|api[_-]?key|secret|token|bearer)[-_]?(?:[:\s=]+)?['"]?[A-Za-z0-9_\-./+=]{20,}['"]?/gi,
    description: 'API key or secret detected',
    severity: 'critical',
    mask: (m) => m.replace(/([-_:=\s]['"]?)?[A-Za-z0-9_\-./+=]{20,}(['"]?)$/, '$1[REDACTED]$2'),
  },
];

// ============================================================
// PIIDetector 实现
// ============================================================

export class PIIDetector implements Guardrail {
  readonly name = 'pii-detector';
  readonly stage: GuardrailStage | 'both';
  private rules: PIIRule[];
  private customRules: Array<{
    name: string;
    pattern: RegExp;
    severity: Violation['severity'];
  }>;
  private maskMode: boolean;

  constructor(options?: PIIDetectorOptions) {
    this.stage = options?.stage ?? 'both';
    this.maskMode = options?.maskMode ?? false;

    const enabledCategories = options?.enabledCategories
      ? new Set(options.enabledCategories)
      : null;

    this.rules = PII_RULES.filter(
      (r) => !enabledCategories || enabledCategories.has(r.category)
    );

    this.customRules = (options?.customRules ?? []).map((r) => ({
      ...r,
      severity: r.severity ?? 'high',
    }));
  }

  async check(content: string, _context?: GuardrailContext): Promise<GuardrailResult> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const rule of this.rules) {
      // 每次使用前重置 lastIndex（因为用了 /g 标志）
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = rule.pattern.exec(content)) !== null) {
        // 银行卡号额外用 Luhn 校验减少误报
        if (rule.category === 'bank_card') {
          const digits = match[0].replace(/[-\s]/g, '');
          if (digits.length < 13 || digits.length > 19 || !this.luhnCheck(digits)) {
            continue;
          }
        }

        violations.push({
          type: `pii_${rule.category}`,
          detail: rule.description,
          severity: rule.severity,
          position: { start: match.index, end: match.index + match[0].length },
        });
      }
    }

    for (const rule of this.customRules) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      const globalPattern = rule.pattern.global
        ? rule.pattern
        : new RegExp(rule.pattern.source, rule.pattern.flags + 'g');

      while ((match = globalPattern.exec(content)) !== null) {
        violations.push({
          type: `pii_custom_${rule.name}`,
          detail: `Custom PII rule "${rule.name}" matched`,
          severity: rule.severity,
          position: { start: match.index, end: match.index + match[0].length },
        });
      }
    }

    return {
      passed: violations.length === 0,
      guardrailName: this.name,
      reason: violations.length > 0
        ? `Detected ${violations.length} PII instance(s): ${[...new Set(violations.map((v) => v.type))].join(', ')}`
        : undefined,
      violations: violations.length > 0 ? violations : undefined,
      durationMs: Date.now() - start,
    };
  }

  /**
   * 遮蔽内容中的 PII（不拦截，只替换）
   */
  mask(content: string): string {
    let result = content;

    for (const rule of this.rules) {
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, (match) => {
        if (rule.category === 'bank_card') {
          const digits = match.replace(/[-\s]/g, '');
          if (digits.length < 13 || digits.length > 19 || !this.luhnCheck(digits)) {
            return match;
          }
        }
        return rule.mask(match);
      });
    }

    return result;
  }

  /**
   * Luhn 校验算法 -- 验证银行卡号合法性
   */
  private luhnCheck(digits: string): boolean {
    let sum = 0;
    let alternate = false;

    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i]!, 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }

    return sum % 10 === 0;
  }
}
