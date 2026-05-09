/**
 * MCP client — request/response correlation, initialize handshake,
 * tools/list, tools/call. Adapted from Reasonix (esengine/reasonix).
 */

import type { McpTransport } from "./stdio.js";
import {
  type CallToolResult,
  type InitializeParams,
  type InitializeResult,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ListToolsResult,
  type McpClientInfo,
  type McpProgressHandler,
  type ProgressNotificationParams,
  MCP_PROTOCOL_VERSION,
  isJsonRpcError,
} from "./types.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

export class McpClient {
  private readonly transport: McpTransport;
  private readonly clientInfo: McpClientInfo;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private readerStarted = false;
  private initialized = false;
  private _serverCapabilities: InitializeResult["capabilities"] = {};
  private _serverInfo: InitializeResult["serverInfo"] = { name: "", version: "" };

  constructor(opts: {
    transport: McpTransport;
    clientInfo?: McpClientInfo;
    requestTimeoutMs?: number;
  }) {
    this.transport = opts.transport;
    this.clientInfo = opts.clientInfo ?? { name: "flowcraft", version: "0.1.0" };
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;
  }

  get serverCapabilities() { return this._serverCapabilities; }
  get serverInfo() { return this._serverInfo; }

  async initialize(): Promise<InitializeResult> {
    if (this.initialized) throw new Error("MCP client already initialized");
    this.startReaderIfNeeded();
    const result = await this.request<InitializeResult>("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      clientInfo: this.clientInfo,
    } satisfies InitializeParams);
    this._serverCapabilities = result.capabilities ?? {};
    this._serverInfo = result.serverInfo ?? { name: "", version: "" };
    await this.transport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    this.initialized = true;
    return result;
  }

  async listTools(): Promise<ListToolsResult> {
    this.assertInitialized();
    return this.request<ListToolsResult>("tools/list", {});
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>,
    opts?: { onProgress?: McpProgressHandler; signal?: AbortSignal },
  ): Promise<CallToolResult> {
    this.assertInitialized();
    return this.request<CallToolResult>("tools/call", {
      name,
      arguments: args ?? {},
    }, opts?.signal);
  }

  async close(): Promise<void> {
    for (const [, p] of this.pending) {
      clearTimeout(p.timeout);
      p.reject(new Error("MCP client closed"));
    }
    this.pending.clear();
    await this.transport.close();
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("MCP not initialized — call initialize() first");
  }

  private async request<R>(method: string, params: unknown, signal?: AbortSignal): Promise<R> {
    const id = this.nextId++;
    const frame: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    let abortHandler: (() => void) | null = null;

    const promise = new Promise<R>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
        reject(new Error(`MCP ${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeout,
      });

      if (signal) {
        if (signal.aborted) {
          this.pending.delete(id);
          clearTimeout(timeout);
          reject(new Error(`MCP ${method} aborted`));
          return;
        }
        abortHandler = () => {
          this.pending.delete(id);
          clearTimeout(timeout);
          reject(new Error(`MCP ${method} aborted by user`));
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    });

    try {
      await this.transport.send(frame);
    } catch (err) {
      this.pending.delete(id);
      if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
      throw err;
    }

    try {
      return await promise;
    } finally {
      if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
    }
  }

  private startReaderIfNeeded(): void {
    if (this.readerStarted) return;
    this.readerStarted = true;
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    try {
      for await (const msg of this.transport.messages()) {
        this.dispatch(msg);
      }
    } catch (err) {
      for (const [, p] of this.pending) {
        clearTimeout(p.timeout);
        p.reject(err as Error);
      }
      this.pending.clear();
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if (!("id" in msg) || msg.id === null || msg.id === undefined) {
      // Notification — ignore (flowcraft doesn't handle server notifications yet)
      return;
    }
    if (!("result" in msg) && !("error" in msg)) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timeout);
    const resp = msg as JsonRpcResponse;
    if (isJsonRpcError(resp)) {
      pending.reject(new Error(`MCP ${resp.error.code}: ${resp.error.message}`));
    } else {
      pending.resolve(resp.result);
    }
  }
}
