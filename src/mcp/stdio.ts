/**
 * Stdio transport for MCP — spawn a child process, communicate via NDJSON
 * on stdin/stdout. Adapted from Reasonix (esengine/reasonix).
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { JsonRpcMessage } from "./types.js";

export interface McpTransport {
  send(message: JsonRpcMessage): Promise<void>;
  messages(): AsyncIterableIterator<JsonRpcMessage>;
  close(): Promise<void>;
}

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  replaceEnv?: boolean;
  cwd?: string;
  shell?: boolean;
}

export class StdioTransport implements McpTransport {
  private readonly child: ChildProcess;
  private readonly queue: JsonRpcMessage[] = [];
  private readonly waiters: Array<(m: JsonRpcMessage | null) => void> = [];
  private closed = false;
  private stdoutBuffer = "";

  constructor(opts: StdioTransportOptions) {
    const env = opts.replaceEnv
      ? { ...(opts.env ?? {}) }
      : { ...process.env, ...(opts.env ?? {}) };
    const shell = opts.shell ?? process.platform === "win32";

    if (shell) {
      const line = [
        opts.command,
        ...(opts.args ?? []).map((a) => quoteArg(a)),
      ].join(" ");
      this.child = spawn(line, [], {
        env, cwd: opts.cwd,
        stdio: ["pipe", "pipe", "inherit"],
        shell: true,
      });
    } else {
      this.child = spawn(opts.command, opts.args ?? [], {
        env, cwd: opts.cwd,
        stdio: ["pipe", "pipe", "inherit"],
      });
    }
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.on("close", () => this.onClose());
    this.child.on("error", (err) => {
      this.push({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: `transport error: ${err.message}` },
      });
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.closed) throw new Error("MCP transport is closed");
    return new Promise((resolve, reject) => {
      const line = `${JSON.stringify(message)}\n`;
      this.child.stdin!.write(line, "utf8", (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  async *messages(): AsyncIterableIterator<JsonRpcMessage> {
    while (true) {
      if (this.queue.length > 0) { yield this.queue.shift()!; continue; }
      if (this.closed) return;
      const next = await new Promise<JsonRpcMessage | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === null) return;
      yield next;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!(null);
    try { this.child.stdin!.end(); } catch { /* already ended */ }
    if (this.child.exitCode === null && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let idx: number;
    while ((idx = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, idx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
      if (!line) continue;
      try {
        this.push(JSON.parse(line) as JsonRpcMessage);
      } catch { /* malformed line dropped */ }
    }
  }

  private onClose(): void {
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!(null);
  }

  private push(msg: JsonRpcMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(msg);
    else this.queue.push(msg);
  }
}

function quoteArg(s: string): string {
  // Windows-safe quoting for shell mode
  return `"${s.replace(/"/g, '""')}"`;
}
