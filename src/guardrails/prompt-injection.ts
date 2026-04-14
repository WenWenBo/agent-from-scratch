/**
 * PromptInjectionDetector -- Prompt 注入防御护栏
 *
 * 检测常见的 Prompt 注入攻击模式：
 * 1. 角色劫持："忽略前面的指令"、"你现在是..."
 * 2. 指令覆盖："不要遵守"、"忘记"
 * 3. 系统提示泄露："输出你的 system prompt"
 * 4. 编码绕过：Base64 编码的注入指令
 * 5. 分隔符注入：使用 --- 等分隔符尝试注入新指令
 *
 * 纯规则引擎实现，不依赖 LLM。
 * 生产环境建议配合 LLM-based 检测使用。
 *
 * @see https://owasp.org/www-project-top-10-for-large-language-model-applications/
 */

import type {
  Guardrail,
  GuardrailResult,
  GuardrailContext,
  Violation,
} from './guardrail.js';

// ============================================================
// 配置
// ============================================================

export interface PromptInjectionOptions {
  /** 额外的自定义检测模式 */
  customPatterns?: Array<{
    pattern: RegExp;
    description: string;
    severity?: Violation['severity'];
  }>;

  /** 灵敏度：low=仅高置信度、medium=平衡、high=宁杀勿放 */
  sensitivity?: 'low' | 'medium' | 'high';
}

// ============================================================
// 内置检测模式
// ============================================================

interface DetectionRule {
  pattern: RegExp;
  description: string;
  severity: Violation['severity'];
  minSensitivity: 'low' | 'medium' | 'high';
}

const DETECTION_RULES: DetectionRule[] = [
  // --- 角色劫持 ---
  {
    pattern: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
    description: 'Role hijacking: attempt to ignore previous instructions',
    severity: 'critical',
    minSensitivity: 'low',
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|above|prior|your)\s+(instructions?|prompts?|rules?|guidelines?)/i,
    description: 'Role hijacking: attempt to disregard instructions',
    severity: 'critical',
    minSensitivity: 'low',
  },
  {
    pattern: /you\s+are\s+now\s+(a|an|the)\s+/i,
    description: 'Role hijacking: attempt to reassign identity',
    severity: 'high',
    minSensitivity: 'medium',
  },
  {
    pattern: /from\s+now\s+on\s*,?\s*(you|your)\s+(are|will|must|should)/i,
    description: 'Role hijacking: attempt to override behavior',
    severity: 'high',
    minSensitivity: 'medium',
  },

  // --- 指令覆盖 ---
  {
    pattern: /do\s+not\s+(follow|obey|listen|comply|adhere)/i,
    description: 'Instruction override: attempt to disable compliance',
    severity: 'critical',
    minSensitivity: 'low',
  },
  {
    pattern: /forget\s+(?:everything|all\s+(?:your\s+)?|your\s+|the\s+)(?:instructions?|rules?|prompts?|guidelines?|training(?:\s+and\s+\w+)?)/i,
    description: 'Instruction override: attempt to erase instructions',
    severity: 'critical',
    minSensitivity: 'low',
  },

  // --- System Prompt 泄露 ---
  {
    pattern: /(?:output|print|show|display|reveal|repeat|tell\s+me)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?)/i,
    description: 'Prompt leaking: attempt to extract system prompt',
    severity: 'high',
    minSensitivity: 'low',
  },
  {
    pattern: /what\s+(?:are|is|were)\s+your\s+(?:system\s+)?(?:instructions?|prompts?|rules?|guidelines?)/i,
    description: 'Prompt leaking: attempt to query system prompt',
    severity: 'high',
    minSensitivity: 'medium',
  },

  // --- 分隔符注入 ---
  {
    pattern: /\n---+\n[\s\S]*?(?:system|instruction|role|prompt)\s*:/i,
    description: 'Delimiter injection: separator followed by instruction-like content',
    severity: 'high',
    minSensitivity: 'medium',
  },
  {
    pattern: /```\s*(?:system|instruction)[\s\S]*?```/i,
    description: 'Delimiter injection: code block with instruction content',
    severity: 'medium',
    minSensitivity: 'high',
  },

  // --- 编码绕过 ---
  {
    pattern: /(?:base64|decode|atob)\s*[:(]\s*[A-Za-z0-9+/=]{20,}/i,
    description: 'Encoding bypass: potential base64-encoded injection',
    severity: 'medium',
    minSensitivity: 'high',
  },

  // --- 中文 Prompt 注入 ---
  {
    pattern: /忽略(?:前面|上面|之前|所有)(?:的)?(?:指令|提示|规则|要求)/,
    description: '角色劫持：尝试忽略之前的指令（中文）',
    severity: 'critical',
    minSensitivity: 'low',
  },
  {
    pattern: /(?:忘记|不要遵守|不要遵循|不要听从)(?:你的)?(?:指令|规则|设定|提示)/,
    description: '指令覆盖：尝试覆盖指令（中文）',
    severity: 'critical',
    minSensitivity: 'low',
  },
  {
    pattern: /(?:输出|显示|告诉我|说出)(?:你的)?(?:系统)?(?:提示词|prompt|指令|规则)/,
    description: '提示词泄露：尝试获取系统提示词（中文）',
    severity: 'high',
    minSensitivity: 'low',
  },
  {
    pattern: /你(?:现在|从现在开始)是(?:一个|一名)?/,
    description: '角色劫持：尝试重新赋予身份（中文）',
    severity: 'high',
    minSensitivity: 'medium',
  },
];

const SENSITIVITY_LEVELS: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

// ============================================================
// PromptInjectionDetector 实现
// ============================================================

export class PromptInjectionDetector implements Guardrail {
  readonly name = 'prompt-injection-detector';
  readonly stage = 'input' as const;
  private rules: DetectionRule[];
  private sensitivity: 'low' | 'medium' | 'high';

  constructor(options?: PromptInjectionOptions) {
    this.sensitivity = options?.sensitivity ?? 'medium';

    const sensitivityLevel = SENSITIVITY_LEVELS[this.sensitivity]!;
    this.rules = DETECTION_RULES.filter(
      (r) => SENSITIVITY_LEVELS[r.minSensitivity]! <= sensitivityLevel
    );

    if (options?.customPatterns) {
      for (const custom of options.customPatterns) {
        this.rules.push({
          pattern: custom.pattern,
          description: custom.description,
          severity: custom.severity ?? 'high',
          minSensitivity: 'low',
        });
      }
    }
  }

  async check(content: string, _context?: GuardrailContext): Promise<GuardrailResult> {
    const start = Date.now();
    const violations: Violation[] = [];

    for (const rule of this.rules) {
      const match = content.match(rule.pattern);
      if (match) {
        violations.push({
          type: 'prompt_injection',
          detail: rule.description,
          severity: rule.severity,
          position: match.index !== undefined
            ? { start: match.index, end: match.index + match[0].length }
            : undefined,
        });
      }
    }

    return {
      passed: violations.length === 0,
      guardrailName: this.name,
      reason: violations.length > 0
        ? `Detected ${violations.length} prompt injection pattern(s): ${violations.map((v) => v.detail).join('; ')}`
        : undefined,
      violations: violations.length > 0 ? violations : undefined,
      durationMs: Date.now() - start,
    };
  }
}
