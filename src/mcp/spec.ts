/**
 * Parse MCP connection specs. Adapted from Reasonix (esengine/reasonix).
 *
 * Accepted forms:
 *   "name=command args..."          → stdio, namespaced
 *   "command args..."               → stdio, anonymous
 *   "name=https://host/sse"         → HTTP+SSE
 *   "https://host/sse"              → HTTP+SSE
 */

export interface StdioMcpSpec {
  transport: "stdio";
  name: string | null;
  command: string;
  args: string[];
}

export interface SseMcpSpec {
  transport: "sse";
  name: string | null;
  url: string;
}

export type McpSpec = StdioMcpSpec | SseMcpSpec;

const NAME_PREFIX = /^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/;
const HTTP_URL = /^https?:\/\//i;

export function parseMcpSpec(input: string): McpSpec {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("empty MCP spec");

  const nameMatch = NAME_PREFIX.exec(trimmed);
  const name = nameMatch ? nameMatch[1]! : null;
  const body = (nameMatch ? nameMatch[2]! : trimmed).trim();
  if (!body) throw new Error(`MCP spec has name but no command: ${input}`);

  if (HTTP_URL.test(body)) {
    return { transport: "sse", name, url: body };
  }

  // Simple shell-split: split on spaces, handle quoted strings
  const argv = simpleShellSplit(body);
  if (argv.length === 0) throw new Error(`MCP spec has name but no command: ${input}`);
  const [command, ...args] = argv;
  return { transport: "stdio", name, command: command!, args };
}

function simpleShellSplit(s: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of s) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === " " && !inQuote) {
      if (current) { result.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) result.push(current);
  return result;
}
