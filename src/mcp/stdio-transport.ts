/**
 * Stdio Transport -- MCP 的标准进程间传输层
 *
 * MCP Client 通过 stdio 与 Server 通信：
 * - Client 向 Server 的 stdin 写入 JSON-RPC 消息
 * - Server 从 stdout 返回响应
 * - 每条消息占一行（newline-delimited JSON）
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import type {
  JsonRpcMessage,
  JsonRpcResponse,
  JsonRpcId,
} from './json-rpc.js';
import { parseMessage, serializeMessage } from './json-rpc.js';

// ============================================================
// 传输层接口
// ============================================================

export interface Transport extends EventEmitter {
  send(message: JsonRpcMessage): void;
  close(): void;
  on(event: 'message', listener: (msg: JsonRpcMessage) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

// ============================================================
// Stdio Transport 实现
// ============================================================

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export class StdioTransport extends EventEmitter implements Transport {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private options: StdioTransportOptions;

  constructor(options: StdioTransportOptions) {
    super();
    this.options = options;
  }

  /**
   * 启动子进程并建立 stdio 通信通道
   */
  start(): void {
    this.process = spawn(this.options.command, this.options.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.options.env },
      cwd: this.options.cwd,
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to create stdio pipes');
    }

    this.readline = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const message = parseMessage(line);
        this.emit('message', message);
      } catch (err) {
        this.emit('error', new Error(`Failed to parse message: ${line}`));
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      // stderr 是日志通道，不影响协议通信
      this.emit('stderr', data.toString());
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
    });

    this.process.on('close', (code) => {
      this.emit('close', code);
      this.cleanup();
    });
  }

  send(message: JsonRpcMessage): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Transport is not connected');
    }
    const line = serializeMessage(message) + '\n';
    this.process.stdin.write(line);
  }

  close(): void {
    if (this.process) {
      this.process.stdin?.end();
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGTERM');
          setTimeout(() => {
            if (this.process && !this.process.killed) {
              this.process.kill('SIGKILL');
            }
          }, 5000);
        }
      }, 3000);
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.readline?.close();
    this.readline = null;
  }
}

// ============================================================
// InMemory Transport -- 用于测试的内存传输
// ============================================================

/**
 * 成对使用的内存传输，用于测试时模拟 Client ↔ Server 通信
 * 一端的 send() 会直接触发另一端的 'message' 事件
 */
export class InMemoryTransport extends EventEmitter implements Transport {
  private peer: InMemoryTransport | null = null;

  static createPair(): [InMemoryTransport, InMemoryTransport] {
    const a = new InMemoryTransport();
    const b = new InMemoryTransport();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  send(message: JsonRpcMessage): void {
    if (!this.peer) {
      throw new Error('Transport is not connected');
    }
    // 使用 queueMicrotask 模拟异步传输
    queueMicrotask(() => {
      this.peer?.emit('message', message);
    });
  }

  close(): void {
    this.peer = null;
    this.emit('close');
  }
}
