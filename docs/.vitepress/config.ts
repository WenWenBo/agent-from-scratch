import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(defineConfig({
  title: 'TinyAgent',
  description: '从零手写生产级 Agent 框架 -- TypeScript 全栈教程',
  lang: 'zh-CN',
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    outline: { level: [2, 3], label: '目录' },
    lastUpdated: { text: '最后更新' },
    docFooter: { prev: '上一章', next: '下一章' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',

    nav: [
      { text: '教程', link: '/' },
      { text: 'GitHub', link: 'https://github.com' },
    ],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除查询',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    sidebar: [
      {
        text: 'Stage 1: 基础 -- 让 Agent 跑起来',
        collapsed: false,
        items: [
          { text: 'Chapter 01: 与 LLM 对话', link: '/chapter-01-llm-provider' },
          { text: 'Chapter 02: 工具系统', link: '/chapter-02-tool-system' },
          { text: 'Chapter 03: ReAct 循环', link: '/chapter-03-react-loop' },
        ],
      },
      {
        text: 'Stage 2: 核心能力 -- 让 Agent 更聪明',
        collapsed: false,
        items: [
          { text: 'Chapter 04: Memory 记忆系统', link: '/chapter-04-memory-system' },
          { text: 'Chapter 05: RAG 知识增强', link: '/chapter-05-rag' },
          { text: 'Chapter 06: 流式输出', link: '/chapter-06-streaming' },
          { text: '项目 A: 智能文档助手', link: '/project-a-doc-assistant' },
        ],
      },
      {
        text: 'Stage 3: 高级架构 -- 让 Agent 更强大',
        collapsed: false,
        items: [
          { text: 'Chapter 07: Multi-Agent 系统', link: '/chapter-07-multi-agent' },
          { text: 'Chapter 08: MCP 协议', link: '/chapter-08-mcp' },
          { text: 'Chapter 09: 护栏与安全', link: '/chapter-09-guardrails' },
          { text: '项目 B: 代码审查 Agent', link: '/project-b-code-reviewer' },
        ],
      },
      {
        text: 'Stage 4: 生产化 -- 让 Agent 可靠运行',
        collapsed: false,
        items: [
          { text: 'Chapter 10: 可观测性', link: '/chapter-10-observability' },
          { text: 'Chapter 11: 评估体系', link: '/chapter-11-evaluation' },
          { text: 'Chapter 12: 性能与成本优化', link: '/chapter-12-optimization' },
          { text: 'Chapter 13: 技能系统', link: '/chapter-13-skills' },
          { text: '项目 C: 客服智能体', link: '/project-c-customer-service' },
        ],
      },
    ],
  },

  mermaid: {},
}));
