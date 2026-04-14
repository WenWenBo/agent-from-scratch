/**
 * 智能文档助手 -- 交互式运行入口
 *
 * 使用方法：
 *   npx tsx projects/doc-assistant/main.ts
 *
 * 支持的命令：
 *   直接输入问题即可对话
 *   /index   - 重新索引文档
 *   /reset   - 重置对话
 *   /quit    - 退出
 */

import 'dotenv/config';
import * as path from 'path';
import * as readline from 'readline';
import { DocAssistant } from './doc-assistant.js';

const DOCS_DIR = path.join(import.meta.dirname, 'sample-docs');

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     📚 智能文档助手 - TinyAgent Demo     ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  /index  重新索引   /reset 重置对话      ║');
  console.log('║  /quit   退出                            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log();

  const assistant = new DocAssistant({
    apiKey: process.env.OPENAI_API_KEY!,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    docsDir: DOCS_DIR,
    embeddingDimension: 256,
  });

  // 自动索引
  console.log('正在索引文档...');
  const stats = await assistant.indexDocuments();
  console.log(`已索引 ${stats.indexed} 个文件，共 ${stats.chunks} 个分块\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question('你: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      // 命令处理
      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log('再见！');
        rl.close();
        return;
      }

      if (trimmed === '/index') {
        console.log('重新索引...');
        const s = await assistant.indexDocuments();
        console.log(`已索引 ${s.indexed} 个文件，共 ${s.chunks} 个分块\n`);
        prompt();
        return;
      }

      if (trimmed === '/reset') {
        assistant.resetConversation();
        console.log('对话已重置\n');
        prompt();
        return;
      }

      // 流式对话
      process.stdout.write('\n助手: ');

      try {
        for await (const event of assistant.chat(trimmed)) {
          switch (event.type) {
            case 'text_delta':
              process.stdout.write(event.content);
              break;
            case 'tool_call':
              process.stdout.write(`\n  [调用工具: ${event.toolName}]\n`);
              break;
            case 'tool_result':
              process.stdout.write('  [工具执行完成]\n');
              break;
          }
        }
      } catch (err) {
        console.error('\n出错了:', err instanceof Error ? err.message : err);
      }

      console.log('\n');
      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
