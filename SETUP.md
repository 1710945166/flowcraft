# flowcraft 插件部署指南

本文档说明在 Windows 和 Linux 环境下部署 flowcraft 多智能体编排插件的完整流程。

---

## 1. 文件清单

| 文件 | 位置 | 作用 | 是否进 git |
|------|------|------|-----------|
| `~/.config/opencode/opencode.jsonc` | 用户全局目录 | 定义 provider / plugin / MCP / agent；含 API key | ❌ 本机独有 |
| `.opencode/opencode.jsonc` | 项目根目录 | orchestrator agent 定义（mode: primary，工具限制） | ✅ |
| `flowcraft.config.json` | 项目根目录 | orchestrator 的 allowedTools / extraPrompt 配置 | ✅ |
| `oc_subagents/flowcraft/dist/bundle.js` | 项目内插件编译产物 | flowcraft 插件可执行入口 | ✅ |
| `~/.config/opencode/plugins/flowcraft.js` | 用户插件目录 | 运行时加载的插件文件 | ❌ 需手动复制 |
| `oc_subagents/flowcraft/src/` | 项目内插件源码 | TypeScript 源码（需时重新编译） | ✅ |

### 路径说明

| 平台 | `~/.config/opencode/` |
|------|----------------------|
| Windows | `%USERPROFILE%\.config\opencode\`（如 `C:\Users\用户名\.config\opencode\`） |
| Linux / macOS | `~/.config/opencode/` |

---

## 2. 首次部署（新机器）

### 2.1 Windows

1. **克隆仓库**

   ```powershell
   git clone <repo-url> D:\Documents\Study\Pre_Graduate\1\RE
   cd D:\Documents\Study\Pre_Graduate\1\RE
   ```

2. **安装 flowcraft 插件**

   ```powershell
   # 确保目标目录存在
   mkdir -p $env:USERPROFILE\.config\opencode\plugins

   # 复制编译产物到插件目录
   copy oc_subagents\flowcraft\dist\bundle.js $env:USERPROFILE\.config\opencode\plugins\flowcraft.js
   ```

3. **配置全局 opencode.jsonc**

   创建/编辑 `%USERPROFILE%\.config\opencode\opencode.jsonc`，参考 [第 5 节](#5-全局-opencodejsonc-模板) 的模板。

   需要填入的内容：
   - 各 provider 的真实 API key（替换 `your_api_key_here`）
   - 确认 plugin 路径指向 `flowcraft.js`

4. **验证部署**

   在项目目录下启动 OpenCode，观察日志无报错，`flowcraft_status` 命令可正常响应。

### 2.2 Linux (SSH)

1. **拉取最新代码**

   ```bash
   cd /path/to/RE
   git pull
   ```

2. **安装 flowcraft 插件**

   ```bash
   mkdir -p ~/.config/opencode/plugins
   cp oc_subagents/flowcraft/dist/bundle.js ~/.config/opencode/plugins/flowcraft.js
   ```

3. **配置全局 opencode.jsonc**

   ```bash
   vim ~/.config/opencode/opencode.jsonc
   ```

   内容参考 [第 5 节](#5-全局-opencodejsonc-模板) 的模板。Linux 路径与模板一致（`~` 自动展开）。

4. **验证部署**

   启动 OpenCode，确认 `flowcraft_status` 正常。

---

## 3. 更新流程（日常）

flowcraft 插件或配置更新后，执行以下步骤：

```bash
# 1. 拉取最新仓库变更
git pull

# 2. 如果 oc_subagents/flowcraft/dist/bundle.js 有更新，重新复制
cp oc_subagents/flowcraft/dist/bundle.js ~/.config/opencode/plugins/flowcraft.js

# 3. 重启 OpenCode 使插件生效
```

> **注意**：`opencode.jsonc` 或 `flowcraft.config.json` 的变更无需手动复制，OpenCode 启动时会自动加载项目目录下的配置文件。

---

## 4. 架构说明

flowcraft 采用 **双层配置架构**，全局配置与项目配置叠加生效：

```
┌─────────────────────────────────────────────────┐
│  ~/.config/opencode/opencode.jsonc (全局)        │
│  · provider（API endpoint + key）                │
│  · plugin 声明（flowcraft.js 路径）               │
│  · agent 定义（6 个 subagent 基础配置）            │
│  · MCP 工具配置                                  │
├─────────────────────────────────────────────────┤
│  .opencode/opencode.jsonc (项目)                 │
│  · orchestrator agent 覆盖（primary + 工具限制）   │
├─────────────────────────────────────────────────┤
│  flowcraft.config.json (项目)                    │
│  · orchestrator 的 allowedTools                  │
│  · orchestrator 的 extraPrompt                   │
└─────────────────────────────────────────────────┘
         ↓ 合并 ↓
┌─────────────────────────────────────────────────┐
│  完整运行环境                                     │
│  · 7 个 agent 全部就绪                            │
│  · orchestrator 被严格限制                        │
│  · subagent 各司其职                              │
└─────────────────────────────────────────────────┘
```

### 设计意图

- **全局配置不进入仓库**：API key、个人偏好（如模型选择）属于敏感/个性信息，留在本机。
- **项目配置进入仓库**：orchestrator 的工具限制和编排策略是项目公共约定，所有成员共享。
- **flowcraft.config.json 进入仓库**：定义各 agent 的模型分配和提示词，确保团队成员使用统一的 agent 配置。

---

## 5. 全局 opencode.jsonc 模板

以下是最小可用模板，复制到 `~/.config/opencode/opencode.jsonc` 后，将 `your_api_key_here` 替换为真实 API key 即可使用。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // ========== Plugin ==========
  "plugin": [
    // Windows 路径示例：C:\\Users\\用户名\\.config\\opencode\\plugins\\flowcraft.js
    // Linux 路径示例：/home/用户名/.config/opencode/plugins/flowcraft.js
    "~/.config/opencode/plugins/flowcraft.js"
  ],

  // ========== Provider ==========
  "provider": {
    // DeepSeek (via OpenCode proxy)
    "opencode-go": {
      "baseURL": "https://api.opencode.ai/v1",
      "apiKey": "your_api_key_here"
    },
    // 智谱 GLM (coding tasks)
    "zhipuai-coding-plan": {
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "your_api_key_here"
    },
    // DeepSeek (通用任务，通过 DMX API)
    "dmx": {
      "baseURL": "https://www.dmxapi.cn/v1",
      "apiKey": "your_api_key_here"
    }
  },

  // ========== MCP Servers（可选）==========
  "mcp": {
    // "context7": {
    //   "type": "stdio",
    //   "command": "npx",
    //   "args": ["-y", "@upstash/context7-mcp@latest"]
    // }
  },

  // ========== Agent 定义 ==========
  "agent": {
    // --- Sub-agents（flowcraft 用 delegate 调度）---
    "planner": {
      "model": "opencode-go/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Strategic planner - analyzes and plans complex tasks",
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "webfetch": "allow",
        "doom_loop": "deny",
        "external_directory": "deny"
      }
    },
    "coder": {
      "model": "zhipuai-coding-plan/glm-5.1",
      "mode": "subagent",
      "description": "Implementation specialist - writes clean code",
      "permission": {
        "edit": "allow",
        "bash": "allow",
        "webfetch": "allow",
        "doom_loop": "ask",
        "external_directory": "allow"
      }
    },
    "reviewer": {
      "model": "zhipuai-coding-plan/glm-5.1",
      "mode": "subagent",
      "description": "Code reviewer - catches bugs and quality issues",
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "webfetch": "allow",
        "doom_loop": "deny",
        "external_directory": "deny"
      }
    },
    "writer": {
      "model": "dmx/deepseek-v4-pro-guan",
      "mode": "subagent",
      "description": "Writing specialist - generates high-quality prose, documentation, and reports",
      "permission": {
        "edit": "allow",
        "bash": "deny",
        "webfetch": "allow",
        "doom_loop": "deny",
        "external_directory": "deny"
      }
    },
    "analyst": {
      "model": "opencode-go/deepseek-v4-flash",
      "mode": "subagent",
      "description": "Data and experiment analysis specialist - analyzes experiment results, metrics, logs, and research data",
      "permission": {
        "edit": "deny",
        "bash": "allow",
        "webfetch": "allow",
        "doom_loop": "deny",
        "external_directory": "allow"
      }
    },
    "vision": {
      "model": "dmx/doubao-seed-2-0-lite-260215",
      "mode": "subagent",
      "description": "Visual analysis specialist - analyzes images and screenshots",
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "webfetch": "deny",
        "doom_loop": "deny",
        "external_directory": "deny"
      }
    }
  }
}
```

> **注意**：orchestrator agent 由项目内的 `.opencode/opencode.jsonc` 定义（`mode: "primary"`），不要在全剧中重复定义。

---

## 6. 常见问题

### Q: 启动后看不到 subagent

检查 `~/.config/opencode/plugins/flowcraft.js` 是否存在。如果缺失，重新执行 `cp oc_subagents/flowcraft/dist/bundle.js ~/.config/opencode/plugins/flowcraft.js`。

### Q: delegate 报错 "agent not found"

确认全局 `opencode.jsonc` 中已定义对应 agent，且 `mode` 为 `"subagent"`。可用 `flowcraft_status` 查看当前识别到的 agent 列表。

### Q: API 调用返回 401 / 403

检查各 provider 的 `apiKey` 是否正确填写，注意不要有多余空格或换行。

### Q: 从源码重新编译

```bash
cd oc_subagents/flowcraft
npm install
npm run build
# 产物输出到 dist/bundle.js
```

### Q: Windows 路径中的 `~` 不被识别

Windows 的 `~` 通常指向 `%USERPROFILE%`。如果 OpenCode 无法解析，请使用绝对路径：

```jsonc
"plugin": [
  "C:\\Users\\你的用户名\\.config\\opencode\\plugins\\flowcraft.js"
]
```
