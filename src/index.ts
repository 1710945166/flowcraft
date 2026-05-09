import type { Plugin, ToolResult } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { loadConfig, readOpencodeAgents } from "./config.js"
import { applyHashlineEdits, readWithHash, createHashlineSystemPrompt, type HashlineEditInput } from "./hashline.js"
import { createTodoEnforcer } from "./todo-enforcer.js"
import { dispatchToAgent } from "./orchestrator.js"
import { SkillStore } from "./skills.js"
import type { UserMessage } from "@opencode-ai/sdk"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

let currentSessionID = ""
const skillStore = new SkillStore({ projectRoot: process.cwd() })

function loadDMXKey(): string | null {
  const candidates = [
    join(process.cwd(), ".opencode", "opencode.jsonc"),
    join(homedir(), ".config", "opencode", "opencode.jsonc"),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const raw = readFileSync(p, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      const config = JSON.parse(raw)
      const key = config?.provider?.dmx?.options?.apiKey
      if (key) return key
    } catch { /* next */ }
  }
  return null
}

export const flowcraft: Plugin = async ({ client, directory }, options) => {
  const config = loadConfig(directory, options)
  if (config.disabled) return {}

  const agents = readOpencodeAgents()
  const agentList = agents.map(a => `  - ${a.name}: ${a.description}`).join("\n")
  const agentUsageTips = agents.map(a => `  - Delegate to "${a.name}" for ${a.description}`).join("\n")
  const agentNames = agents.map(a => a.name).join(", ") || "none configured"

  return {
    tool: {
      read_with_hash: tool({
        description: "Read a file with hash-annotated lines. Use this instead of read when you need to edit the file afterward. Each line is prefixed with LINENUM#HASH for use with hashline_edit.",
        args: {
          filePath: tool.schema.string().describe("Absolute path to the file to read"),
        },
        async execute(args: { filePath: string }): Promise<ToolResult> {
          return readWithHash(args.filePath)
        },
      }),

      hashline_edit: tool({
        description: "Edit file lines using hash-anchored references. Lines must have been read via read_with_hash first to get their hashes. Specify edits as array of {line, hash, newContent}. All edits are verified and applied atomically.",
        args: {
          filePath: tool.schema.string().describe("Absolute path to the file to edit"),
          edits: tool.schema.array(tool.schema.object({
            line: tool.schema.number().describe("Line number (1-based)"),
            hash: tool.schema.string().describe("Content hash from read_with_hash output"),
            newContent: tool.schema.string().describe("New content for this line"),
          })).describe("Array of edits - all verified before any are written"),
        },
        async execute(args: HashlineEditInput): Promise<ToolResult> {
          return applyHashlineEdits(args)
        },
      }),

      analyze_image: tool({
        description: "Analyze an image using doubao-lite (vision model). Use this when you need to understand the content of an image, screenshot, or diagram.",
        args: {
          filePath: tool.schema.string().describe("Absolute path to the image file to analyze"),
        },
        async execute(args: { filePath: string }): Promise<ToolResult> {
          try {
            const apiKey = loadDMXKey()
            if (!apiKey) return "Error: DMX API key not found in opencode.jsonc"

            const ext = args.filePath.toLowerCase().slice(args.filePath.lastIndexOf("."))
            const mimeMap: Record<string, string> = {
              ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".png": "image/png", ".gif": "image/gif",
              ".webp": "image/webp", ".bmp": "image/bmp",
            }
            const mime = mimeMap[ext] || "image/jpeg"
            const b64 = readFileSync(args.filePath).toString("base64")
            const dataUrl = `data:${mime};base64,${b64}`

            const res = await fetch("https://www.dmxapi.cn/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: "doubao-seed-2-0-lite-260215",
                messages: [{
                  role: "user",
                  content: [
                    { type: "image_url", image_url: { url: dataUrl } },
                    { type: "text", text: "Analyze this image in detail. Describe what you see, identify key elements, and provide relevant insights." },
                  ],
                }],
                max_tokens: 4096,
              }),
            })

            const data = await res.json() as any
            return data?.choices?.[0]?.message?.content || "No analysis returned."
          } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      flowcraft_status: tool({
        description: "Check flowcraft plugin status and available agents",
        args: {},
        async execute(): Promise<ToolResult> {
          return `flowcraft loaded. ${agents.length} agents available: ${agentNames}`
        },
      }),

      delegate: tool({
        description: `Delegate a task to a specialist agent. Available: ${agentNames}`,
        args: {
          agent: tool.schema.string().describe(`Agent name (${agentNames})`),
          task: tool.schema.string().describe("Detailed task description"),
        },
        async execute(args: { agent: string; task: string }): Promise<ToolResult> {
          const agent = agents.find(a => a.name === args.agent)
          if (!agent) {
            return `Unknown agent "${args.agent}". Available: ${agentNames}`
          }
          if (!currentSessionID) {
            return "Error: no active session ID"
          }
          try {
            const result = await dispatchToAgent(client, currentSessionID, args.agent, args.task)
            return `[flowcraft] Dispatched to "${args.agent}".\n\nResult:\n${result}`
          } catch (err) {
            return `Error dispatching to "${args.agent}": ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      run_skill: tool({
        description: "Invoke a skill by name. Skills are reusable prompt packs. Use [subagent] skills for isolated exploration; inline skills inject instructions directly.",
        args: {
          name: tool.schema.string().describe("Skill name (use skill_index to list available skills)"),
          arguments: tool.schema.string().optional().describe("Task description for subagent-mode skills"),
        },
        async execute(args: { name: string; arguments?: string }): Promise<ToolResult> {
          const skill = skillStore.read(args.name)
          if (!skill) {
            const available = skillStore.list().map(s => `  - ${s.name} [${s.runAs}]${s.model ? ` (${s.model})` : ""}`).join("\n")
            return `Unknown skill "${args.name}". Available skills:\n${available}`
          }
          if (skill.runAs === "subagent") {
            const task = args.arguments || skill.description
            const agentName = "planner" // default subagent
            return `[flowcraft] Running skill "${skill.name}" as subagent...\n\n${await dispatchToAgent(client, currentSessionID, agentName, `${skill.body}\n\nTask: ${task}`)}`
          }
          // Inline: return the skill body as a prompt injection
          return `[flowcraft] Skill "${skill.name}" loaded.\n\n${skill.body}`
        },
      }),

      skill_index: tool({
        description: "List all available skills with descriptions",
        args: {},
        async execute(): Promise<ToolResult> {
          const skills = skillStore.list()
          if (skills.length === 0) return "No skills found. Create SKILL.md files in ~/.agents/skills/<name>/ or ./.deepcode/skills/<name>/"
          return skills.map(s =>
            `  ${s.runAs === "subagent" ? "🧬" : "📄"} ${s.name}${s.model ? ` (${s.model})` : ""}\n     ${s.description}`
          ).join("\n")
        },
      }),
    },

    "tool.execute.before": async (input) => {
      currentSessionID = input.sessionID
    },

    "chat.message": async (_input, output) => {
      const hasImage = output.parts.some(p => p.type === "file" && (p as any).mime?.startsWith("image/"))
      if (hasImage) {
        const msg = output.message as UserMessage
        msg.agent = "vision"
        msg.model = { providerID: "dmx", modelID: "doubao-seed-2-0-lite-260215" }
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(createHashlineSystemPrompt())
      if (agents.length > 0) {
        output.system.push(`## Flowcraft Specialist Agents

You have specialist sub-agents. DELEGATE aggressively — break tasks down and dispatch.

${agentList}

Use the delegate tool. It returns the full response.
${agentUsageTips}

CRITICAL: You are a COORDINATOR, not a worker. For coding → 'coder'. Review → 'reviewer'. Planning → 'planner'.
Analysis → 'analyst'. Writing → 'writer'. Images → 'vision'. Dispatch immediately, don't do it yourself.`)}
      // Inject skills index
      const skillIndex = skillStore.buildIndex()
      if (skillIndex) {
        output.system.push(`## Skills${skillIndex}`)
      }
    },

    event: createTodoEnforcer(client),
  }
}

export default flowcraft
