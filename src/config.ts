import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface FlowcraftConfig {
  disabled?: boolean
}

function resolveConfigPath(directory: string): string {
  const candidates = [
    join(directory, ".opencode", "flowcraft.jsonc"),
    join(directory, ".opencode", "flowcraft.json"),
    join(homedir(), ".config", "opencode", "flowcraft.jsonc"),
    join(homedir(), ".config", "opencode", "flowcraft.json"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return ""
}

export function loadConfig(directory: string, options?: Record<string, unknown>): FlowcraftConfig {
  const fromOptions = parseOptions(options)
  if (fromOptions) return fromOptions

  const configPath = resolveConfigPath(directory)
  if (configPath) {
    try {
      const raw = readFileSync(configPath, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      return JSON.parse(raw) as FlowcraftConfig
    } catch { /* fall through */ }
  }

  return {}
}

function parseOptions(options?: Record<string, unknown>): FlowcraftConfig | null {
  if (!options) return null
  const src = (options as Record<string, unknown>).flowcraft as Record<string, unknown> ?? options
  if (!src || typeof src !== "object") return null
  if (!("disabled" in src)) return null
  return { disabled: (src as any).disabled as boolean | undefined }
}

export interface AgentInfo {
  name: string
  description: string
  model: string
  mode?: string
}

const DEFAULT_AGENTS: AgentInfo[] = [
  { name: "planner",  description: "Strategic planner - analyzes and plans complex tasks",               model: "opencode-go/deepseek-v4-flash",             mode: "subagent" },
  { name: "coder",    description: "Implementation specialist - writes clean code",                       model: "zhipuai-coding-plan/glm-5.1",                mode: "subagent" },
  { name: "reviewer", description: "Code reviewer - catches bugs and quality issues",                   model: "zhipuai-coding-plan/glm-5.1",                mode: "subagent" },
  { name: "writer",   description: "Writing specialist - generates high-quality prose, documentation, and reports", model: "dmx/deepseek-v4-pro-guan",           mode: "subagent" },
  { name: "analyst",  description: "Data and experiment analysis specialist - analyzes experiment results, metrics, logs, and research data", model: "opencode-go/deepseek-v4-flash", mode: "subagent" },
  { name: "vision",   description: "Visual analysis specialist - analyzes images and screenshots",      model: "dmx/doubao-seed-2-0-lite-260215",            mode: "subagent" },
]

export function readOpencodeAgents(): AgentInfo[] {
  const candidates = [
    join(process.cwd(), ".opencode", "opencode.jsonc"),
    join(process.cwd(), ".opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.jsonc"),
    join(homedir(), ".config", "opencode", "opencode.json"),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const raw = readFileSync(p, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      const config = JSON.parse(raw)
      const agents = config?.agent
      if (!agents || typeof agents !== "object") continue
      return Object.entries(agents)
        .filter(([_, v]) => (v as any)?.mode !== "primary")
        .map(([name, v]) => ({
          name,
          description: (v as any).description || name,
          model: (v as any).model || "",
          mode: (v as any).mode,
        }))
    } catch { /* next */ }
  }
  return DEFAULT_AGENTS
}
