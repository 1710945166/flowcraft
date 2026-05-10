# flowcraft

Multi-agent orchestration plugin for [OpenCode](https://opencode.ai). Dispatch tasks to specialist sub-agents in OpenCode — single-shot or parallel batch — with built-in conflict detection, worktree isolation, and skill management.

## Features (v0.2.0)

- **Parallel delegation** — `delegate_batch` tool dispatches multiple sub-agents concurrently via `Promise.allSettled`. Up to 5 tasks run in parallel, dramatically reducing turnaround time for multi-step workflows.
- **Three-stage conflict detection** — Before parallel dispatch, a prevention pass analyzes file-level overlap. If tasks touch different files, a git `merge-tree` pre-check verifies compatibility. When git reports a conflict, an LLM-powered semantic merge module determines whether it's a true conflict or an auto-mergeable false positive.
- **Worktree isolation (optional)** — Each sub-agent gets its own `git worktree`, avoiding file conflicts at the source. When tasks complete, worktrees are committed and merged back to the main branch automatically.
- **Safety guardrails** — Sub-agents **cannot** recursively invoke `delegate` or `delegate_batch`. The orchestrator's delegation system prompt is **not injected** into sub-agent sessions. Idle sessions are terminated after a configurable timeout (120s default).
- **Sub-window support** — On Linux, the OpenCode native `task` tool is preferred for in-IDE sub-windows showing real-time agent progress. Falls back to `delegate` when `task` is unavailable.
- **Agent management** — 6 built-in specialist agents (`planner`, `coder`, `reviewer`, `writer`, `analyst`, `vision`), each with tailored model, permissions, and system prompt. Fully configurable in `opencode.jsonc`.
- **Skill system** — Reusable prompt packs via `SKILL.md` files. Two modes: **inline** (injects instructions into the current session) and **subagent** (spawns an isolated agent to execute the skill).
- **Hash-anchored editing** — `read_with_hash` + `hashline_edit` tools provide content-hash verification for every line edit, ensuring safe concurrent file modifications.

## Installation

```bash
# Clone the repo
git clone https://github.com/J1I1E/flowcraft.git
cd flowcraft

# Install dependencies
npm install

# Build the bundle
npm run build

# Deploy to OpenCode plugins directory
# Windows: copy dist\bundle.js %USERPROFILE%\.config\opencode\plugins\flowcraft.js
# Linux/macOS:
cp dist/bundle.js ~/.config/opencode/plugins/flowcraft.js
```

Or reference as a GitHub plugin in your OpenCode config:

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": ["github:J1I1E/flowcraft"]
}
```

## Configuration

Flowcraft uses a two-layer config system:

| Layer | Path | Purpose |
|-------|------|---------|
| **Global** | `~/.config/opencode/opencode.jsonc` | Plugins, providers, agent definitions |
| **Project** | `.opencode/opencode.jsonc` | Project-specific agent overrides |

### Orchestrator Setup

The orchestrator is the coordination hub. It reads agent definitions from `opencode.jsonc` and injects a delegation system prompt automatically. Configure it in `flowcraft.config.json` at your project root:

```json
// flowcraft.config.json
{
  "orchestrator": {
    "allowedTools": ["task", "delegate", "delegate_batch", "read", "glob", "grep", "flowcraft_status", "todowrite"],
    "extraPrompt": "You are the orchestrator. You NEVER write code or edit files — you decompose tasks and delegate to specialists."
  }
}
```

### Full Agent Configuration

Define all 6 specialist agents in your `opencode.jsonc`. Each agent restricts `delegate` and `task` to prevent recursive delegation:

```jsonc
{
  "plugin": ["github:J1I1E/flowcraft"],

  "agent": {
    "planner": {
      "model": "dmx/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Strategic planner - analyzes and plans complex tasks",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "coder": {
      "model": "dmx/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Implementation specialist - writes clean code",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "allow", "bash": "allow", "webfetch": "allow", "doom_loop": "ask", "external_directory": "allow" }
    },
    "reviewer": {
      "model": "dmx/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Code reviewer - catches bugs and quality issues",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "writer": {
      "model": "dmx/deepseek-v4-pro-guan",
      "mode": "subagent",
      "description": "Writing specialist - generates high-quality prose, documentation, and reports",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "allow", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "analyst": {
      "model": "dmx/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Data and experiment analysis specialist - analyzes experiment results, metrics, logs, and research data",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "vision": {
      "model": "dmx/doubao-seed-2-0-lite-260215",
      "mode": "subagent",
      "description": "Visual analysis specialist - analyzes images and screenshots",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "deny", "doom_loop": "deny", "external_directory": "deny" }
    }
  }
}
```

> **Note**: Replace model IDs and provider names with your own setup. The `delegate: false` restriction on every sub-agent is **required** — it prevents recursive delegation and infinite loops.

## Tools

| Tool | Description |
|------|-------------|
| `delegate` | Dispatch a single task to a specialist sub-agent |
| `delegate_batch` | Dispatch 2–5 tasks in **parallel** (only when tasks touch different files) |
| `flowcraft_status` | Check plugin status, loaded agents, and skill count |
| `run_skill` | Invoke a skill by name (inline or subagent mode) |
| `skill_index` | List all available skills with descriptions |
| `read_with_hash` | Read a file with content-hash annotated lines for safe editing |
| `hashline_edit` | Edit files using hash-verified line references (atomic batch apply) |
| `analyze_image` | Analyze images, screenshots, or diagrams via a vision model |

## Architecture

```
User → orchestrator
  ├── delegate (single task)
  ├── delegate_batch (parallel tasks)
  │     ├── conflict detection: prevention → git merge-tree → semantic merge
  │     └── worktree isolation (optional)
  └── skill system: inline + subagent modes
```

### Conflict Detection Pipeline

```
Task dispatch
    │
    ▼
Stage 1: Prevention (file-level overlap analysis)
    │  no overlap → proceed
    │  overlap detected → reject batch, suggest sequential dispatch
    ▼
Stage 2: Git merge-tree (pre-merge compatibility check)
    │  clean merge → proceed
    │  conflict found → escalate to Stage 3
    ▼
Stage 3: Semantic merge (LLM-powered classification)
    │  SEMANTIC-MERGE → auto-rearrange
    │  AUTO-MERGE → trivial, apply directly
    │  ESCALATE → requires human review
```

## Skills

Write reusable prompt packs as `SKILL.md` files with YAML frontmatter:

```
~/.agents/skills/<name>/SKILL.md    # User-level (all projects)
./.deepcode/skills/<name>/SKILL.md   # Project-level
```

Example:

```markdown
---
name: brainstorm
description: Use before any creative work — explores intent, requirements, and design
runAs: subagent
model: dmx/deepseek-v4-flash
---

## Brainstorming Protocol

1. Restate the goal in your own words
2. Identify constraints and edge cases
3. Propose 3 alternative approaches with trade-offs
4. Recommend one approach with justification
```

## Parallel Dispatch Best Practices

- **Reader + writer tasks** can overlap safely (e.g., analyst reading logs + coder editing a different file)
- **Two tasks editing the same file** must be sequential — use `delegate`, not `delegate_batch`
- **Max 5 tasks per batch** to keep overhead manageable
- Enable **worktree isolation** (`useWorktree: true`) for larger, riskier parallel runs

## Building from Source

```bash
npm install          # Install dependencies
npm run build        # tsc + esbuild → dist/bundle.js
npm run typecheck    # TypeScript type checking only
npm run dev          # Watch mode with auto-deploy
```

## License

MIT
