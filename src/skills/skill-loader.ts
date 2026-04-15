/**
 * SkillLoader -- 从文件系统加载技能
 *
 * 支持两种格式：
 *
 * 1. SKILL.md（Anthropic 风格）：
 *    ---
 *    name: code-review
 *    description: 代码审查技能
 *    version: 1.0.0
 *    tags: [code, review]
 *    triggers: [review, 审查, code review]
 *    allowed-tools: [read_file, search]
 *    caps:
 *      maxTokens: 4096
 *      temperature: 0.2
 *    ---
 *    下面是技能指令正文...
 *
 * 2. manifest.json + SKILL.md（目录格式）：
 *    skills/
 *    └─ code-review/
 *       ├─ manifest.json   (元数据 + caps + 配置)
 *       ├─ SKILL.md        (纯指令正文，无 frontmatter)
 *       └─ resources/      (可选的扩展资源)
 *          └─ template.md
 *
 * 渐进式披露（Progressive Disclosure）：
 * - 扫描阶段只解析 frontmatter / manifest.json（元数据层）
 * - 激活时才加载 SKILL.md 正文（内容层）
 * - resources/ 下的文件只在显式需要时加载（扩展层）
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { Skill, SkillMetadata, SkillCaps, SkillResource } from './skill.js';

// ============================================================
// Frontmatter 解析（纯 TypeScript 实现）
// ============================================================

export interface ParsedFrontmatter {
  metadata: SkillMetadata;
  allowedTools?: string[];
  caps?: SkillCaps;
  promptVariables?: Record<string, string>;
  body: string;
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 * 支持简单的 key: value 和 key: [array] 格式
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    return {
      metadata: { name: '', description: '' },
      body: content.trim(),
    };
  }

  const yamlBlock = match[1]!;
  const body = match[2]!.trim();
  const data = parseSimpleYaml(yamlBlock);

  const metadata: SkillMetadata = {
    name: String(data['name'] ?? ''),
    description: String(data['description'] ?? ''),
    version: data['version'] ? String(data['version']) : undefined,
    tags: parseStringArray(data['tags']),
    triggers: parseStringArray(data['triggers']),
    author: data['author'] ? String(data['author']) : undefined,
  };

  const allowedTools = parseStringArray(data['allowed-tools']);

  let caps: SkillCaps | undefined;
  if (data['caps'] && typeof data['caps'] === 'object') {
    const c = data['caps'] as Record<string, unknown>;
    caps = {
      maxTokens: c['maxTokens'] ? Number(c['maxTokens']) : undefined,
      temperature: c['temperature'] ? Number(c['temperature']) : undefined,
      providerOverride: c['providerOverride'] ? String(c['providerOverride']) : undefined,
      preferredModel: c['preferredModel'] ? String(c['preferredModel']) : undefined,
    };
  }

  let promptVariables: Record<string, string> | undefined;
  if (data['variables'] && typeof data['variables'] === 'object') {
    promptVariables = {};
    for (const [k, v] of Object.entries(data['variables'] as Record<string, unknown>)) {
      promptVariables[k] = String(v);
    }
  }

  return { metadata, allowedTools, caps, promptVariables, body };
}

// ============================================================
// 简易 YAML 解析（不依赖第三方库）
// ============================================================

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentObj: Record<string, unknown> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 嵌套对象的属性（两空格缩进）
    if (line.startsWith('  ') && currentKey && currentObj) {
      const kvMatch = trimmed.match(/^(\w+)\s*:\s*(.*)$/);
      if (kvMatch) {
        currentObj[kvMatch[1]!] = parseYamlValue(kvMatch[2]!);
      }
      continue;
    }

    // 顶层 key: value
    const topMatch = trimmed.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (topMatch) {
      const key = topMatch[1]!;
      const value = topMatch[2]!.trim();

      if (value === '') {
        currentKey = key;
        currentObj = {};
        result[key] = currentObj;
      } else {
        result[key] = parseYamlValue(value);
        currentKey = null;
        currentObj = null;
      }
    }
  }

  return result;
}

function parseYamlValue(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1);
    if (!inner.trim()) return [];
    return inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }

  if (value === 'true') return true;
  if (value === 'false') return false;

  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  return value.replace(/^["']|["']$/g, '');
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map(String);
  return undefined;
}

// ============================================================
// SkillLoader
// ============================================================

export class SkillLoader {
  /**
   * 从单个 SKILL.md 文件加载
   */
  async loadFromFile(filePath: string): Promise<Skill> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = parseFrontmatter(content);

    if (!parsed.metadata.name) {
      parsed.metadata.name = path.basename(filePath, '.md').toLowerCase();
    }

    return {
      metadata: parsed.metadata,
      instructions: parsed.body,
      allowedTools: parsed.allowedTools,
      caps: parsed.caps,
      promptVariables: parsed.promptVariables,
    };
  }

  /**
   * 从目录加载（manifest.json + SKILL.md）
   */
  async loadFromDirectory(dirPath: string): Promise<Skill> {
    const manifestPath = path.join(dirPath, 'manifest.json');
    const skillMdPath = path.join(dirPath, 'SKILL.md');

    // 读取 manifest.json
    let manifest: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(raw);
    } catch {
      // manifest 不存在则从 SKILL.md frontmatter 获取
    }

    // 读取 SKILL.md
    let instructions = '';
    let fromFrontmatter: ParsedFrontmatter | null = null;
    try {
      const mdContent = await fs.readFile(skillMdPath, 'utf-8');
      fromFrontmatter = parseFrontmatter(mdContent);
      instructions = fromFrontmatter.body;
    } catch {
      throw new Error(`SKILL.md not found in ${dirPath}`);
    }

    // manifest.json 优先，SKILL.md frontmatter 次之
    const metadata: SkillMetadata = {
      name: String(manifest['name'] ?? fromFrontmatter?.metadata.name ?? path.basename(dirPath)),
      description: String(manifest['description'] ?? fromFrontmatter?.metadata.description ?? ''),
      version: manifest['version'] ? String(manifest['version']) : fromFrontmatter?.metadata.version,
      tags: (manifest['tags'] as string[]) ?? fromFrontmatter?.metadata.tags,
      triggers: (manifest['triggers'] as string[]) ?? fromFrontmatter?.metadata.triggers,
      author: manifest['author'] ? String(manifest['author']) : fromFrontmatter?.metadata.author,
    };

    const allowedTools = (manifest['allowedTools'] as string[])
      ?? fromFrontmatter?.allowedTools;

    const caps = (manifest['caps'] as SkillCaps) ?? fromFrontmatter?.caps;
    const promptVariables = (manifest['promptVariables'] as Record<string, string>)
      ?? fromFrontmatter?.promptVariables;

    // 扫描 resources/ 目录
    const resources = await this.scanResources(dirPath);

    return {
      metadata,
      instructions,
      allowedTools,
      caps,
      promptVariables,
      resources,
    };
  }

  /**
   * 扫描目录，批量加载所有技能子目录
   */
  async loadAllFromDirectory(skillsRootDir: string): Promise<Skill[]> {
    const skills: Skill[] = [];

    let entries: string[];
    try {
      entries = await fs.readdir(skillsRootDir);
    } catch {
      return skills;
    }

    for (const entry of entries) {
      const fullPath = path.join(skillsRootDir, entry);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        try {
          const skill = await this.loadFromDirectory(fullPath);
          skills.push(skill);
        } catch {
          // 跳过无效目录
        }
      } else if (entry.endsWith('.md') && entry !== 'README.md') {
        try {
          const skill = await this.loadFromFile(fullPath);
          skills.push(skill);
        } catch {
          // 跳过无效文件
        }
      }
    }

    return skills;
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async scanResources(dirPath: string): Promise<SkillResource[]> {
    const resourceDir = path.join(dirPath, 'resources');
    const resources: SkillResource[] = [];

    try {
      const entries = await fs.readdir(resourceDir);

      for (const entry of entries) {
        const filePath = path.join(resourceDir, entry);
        const ext = path.extname(entry).toLowerCase();

        let type: SkillResource['type'] = 'reference';
        if (ext === '.md' || ext === '.txt') type = 'template';
        else if (ext === '.ts' || ext === '.js') type = 'script';
        else if (ext === '.json') type = 'example';

        resources.push({
          name: entry,
          type,
          filePath,
        });
      }
    } catch {
      // resources/ 目录不存在则忽略
    }

    return resources;
  }
}
