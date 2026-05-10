# flowcraft

Multi-agent orchestration plugin for [OpenCode](https://opencode.ai). Delegate tasks to specialist sub-agents, load Skills (`SKILL.md`), and manage MCP servers — all from within OpenCode's plugin system.

## Features

- **Sub-agent orchestration** — Dispatch tasks to 5 specialist agents (planner, coder, reviewer, writer, vision) via the `delegate` tool
- **Skills system** — Load `SKILL.md` files from `~/.agents/skills/` or `./.deepcode/skills/`, invoke via `run_skill`
- **MCP library** — Lightweight MCP client (stdio transport) extracted from Reasonix, ready for OpenCode tool registration
- **Permission handling** — Sub-agent sessions use async polling for proper interactive permission approval
- **Todo enforcer** — Nags you about pending tasks when the session goes idle
- **Hash-anchored editing** — Read/edit files with content-hash verification for safe multi-agent code modifications

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
cp dist/bundle.js ~/.config/opencode/plugins/flowcraft.js
```

Or add it as a git dependency in your OpenCode config:

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": [
    "github:J1I1E/flowcraft"
  ]
}
```

## Configuration

### OpenCode Agent Setup

Define specialist agents in `opencode.jsonc`:

```jsonc
{
  "agent": {
    "planner": {
      "model": "opencode-go/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Strategic planner - analyzes and plans complex tasks",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "coder": {
      "model": "opencode-go/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Implementation specialist - writes clean code",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "allow", "bash": "allow", "webfetch": "allow", "doom_loop": "ask", "external_directory": "allow" }
    },
    "reviewer": {
      "model": "opencode-go/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Code reviewer - catches bugs and quality issues",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "writer": {
      "model": "opencode-go/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Writing specialist - generates high-quality prose, documentation, and reports",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "allow", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "vision": {
      "model": "opencode-go/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Visual analysis specialist - analyzes images and screenshots",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "deny", "doom_loop": "deny", "external_directory": "deny" }
    }
  }
}
```

### Flowcraft Config

Create `~/.config/opencode/flowcraft.jsonc` or `.opencode/flowcraft.jsonc`:

```jsonc
{
  "disabled": false
}
```

## Tools

| Tool | Description |
|------|-------------|
| `delegate` | Dispatch a task to a specialist sub-agent |
| `run_skill` | Invoke a SKILL.md by name (inline or subagent mode) |
| `skill_index` | List all available skills |
| `read_with_hash` | Read a file with content-hash annotated lines |
| `hashline_edit` | Edit files using hash-verified line references |
| `analyze_image` | Analyze images via vision model |
| `flowcraft_status` | Check plugin status |

## Skills

Write reusable prompt packs as `SKILL.md` files:

```
~/.agents/skills/<name>/SKILL.md       # User-level (all projects)
./.deepcode/skills/<name>/SKILL.md      # Project-level
```

Example skill:

```markdown
---
name: my-skill
description: One-line description
runAs: subagent      # or "inline"
model: deepseek-v4-flash  # optional model override
---

Your skill instructions here...
```

## MCP Library

`src/mcp/` contains a lightweight MCP client adapted from [Reasonix](https://github.com/esengine/reasonix) (MIT). Ready for connecting MCP servers and registering their tools with OpenCode.

## Building from Source

```bash
npm install
npm run build       # tsc + esbuild → dist/bundle.js
npm run typecheck   # TypeScript type checking only
npm run dev         # Watch mode + auto-deploy
```

## License

MIT
