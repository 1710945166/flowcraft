/**
 * MCP type definitions — adapted from Reasonix (esengine/reasonix).
 * Lightweight subset: tools list/call + init handshake.
 */

// ---------- JSON-RPC 2.0 ----------
export type JsonRpcId = string | number;

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: P;
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: R;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcError;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcError;

// ---------- MCP initialize ----------
export interface McpClientInfo { name: string; version: string }
export interface McpClientCapabilities { tools?: Record<string, never>; resources?: Record<string, never>; prompts?: Record<string, never> }

export interface InitializeParams {
  protocolVersion: string;
  capabilities: McpClientCapabilities;
  clientInfo: McpClientInfo;
}

export interface InitializeResult {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: { tools?: { listChanged?: boolean }; resources?: unknown; prompts?: unknown };
  instructions?: string;
}

// ---------- MCP tools ----------
export interface McpToolSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [extra: string]: unknown;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: McpToolSchema;
}

export interface ListToolsResult {
  tools: McpTool[];
  nextCursor?: string;
}

export interface McpContentBlockText { type: "text"; text: string }
export interface McpContentBlockImage { type: "image"; data: string; mimeType: string }
export type McpContentBlock = McpContentBlockText | McpContentBlockImage;

export interface CallToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface ProgressNotificationParams {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

export interface McpProgressInfo {
  progress: number;
  total?: number;
  message?: string;
}

export type McpProgressHandler = (info: McpProgressInfo) => void;

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export function isJsonRpcError(msg: JsonRpcResponse): msg is JsonRpcError {
  return "error" in msg;
}
