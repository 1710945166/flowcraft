# flowcraft

OpenCode 多 agent 编排插件。在 OpenCode 中把任务分派给 specialist 子 agent，支持单任务委派和并行批量调度，内置冲突检测、worktree 隔离和技能管理。

## 特性 (v0.2.0)

- **并行委派** — `delegate_batch` 工具通过 `Promise.allSettled` 并行调度多个子 agent。最多 5 个任务同时运行，大幅缩短多步骤工作流的执行时间。
- **三阶段冲突检测** — 并行调度前先进行预防性文件级重叠分析。如果任务涉及不同文件，再通过 git `merge-tree` 做预合并兼容性检查。当 git 报告冲突时，由 LLM 驱动的语义合并模块判断是真冲突还是可自动合并的伪冲突。
- **Worktree 隔离（可选）** — 每个子 agent 获得独立的 `git worktree`，从源头避免文件冲突。任务完成后，worktree 自动提交并合并回主分支。
- **安全防护** — 子 agent **无法**递归调用 `delegate` 或 `delegate_batch`。编组器的调度指令**不会注入**到子 agent session 中。空闲 session 在可配置的超时时间（默认 120 秒）后自动终止。
- **子窗口支持** — Linux 上优先使用 OpenCode 原生 `task` 工具获得 IDE 内子窗口，实时展示 agent 进度。`task` 不可用时回退到 `delegate`。
- **代理管理** — 6 个内置 specialist agent（`planner`、`coder`、`reviewer`、`writer`、`analyst`、`vision`），每个 agent 可独立配置模型、权限和 system prompt。全部在 `opencode.jsonc` 中配置。
- **技能系统** — 通过 `SKILL.md` 文件定义可复用的 prompt 包。支持两种模式：**inline**（注入指令到当前 session）和 **subagent**（启动隔离 agent 执行技能）。
- **Hash 锚定编辑** — `read_with_hash` + `hashline_edit` 工具为每一行编辑提供内容 hash 校验，确保并发文件修改的安全。

## 安装

```bash
# 克隆仓库
git clone https://github.com/J1I1E/flowcraft.git
cd flowcraft

# 安装依赖
npm install

# 构建打包
npm run build

# 部署到 OpenCode 插件目录
# Windows: copy dist\bundle.js %USERPROFILE%\.config\opencode\plugins\flowcraft.js
# Linux/macOS:
cp dist/bundle.js ~/.config/opencode/plugins/flowcraft.js
```

也可以通过 GitHub 插件引用的方式：

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": ["github:J1I1E/flowcraft"]
}
```

## 配置

Flowcraft 采用双层配置系统：

| 层级 | 路径 | 用途 |
|------|------|------|
| **全局** | `~/.config/opencode/opencode.jsonc` | 插件、provider、agent 定义 |
| **项目级** | `.opencode/opencode.jsonc` | 项目特定的 agent 覆盖 |

### 编组器（Orchestrator）设置

编组器是协调中枢。它从 `opencode.jsonc` 读取 agent 定义并自动注入调度系统提示。在项目根目录创建 `flowcraft.config.json` 进行配置：

```json
// flowcraft.config.json
{
  "orchestrator": {
    "allowedTools": ["task", "delegate", "delegate_batch", "read", "glob", "grep", "flowcraft_status", "todowrite"],
    "extraPrompt": "你是编组器。你不编写代码也不编辑文件——你分解任务并委派给 specialist。"
  }
}
```

### 完整 Agent 配置

在 `opencode.jsonc` 中定义全部 6 个 specialist agent。每个 agent 必须限制 `delegate` 和 `task` 以防止递归委派：

```jsonc
{
  "plugin": ["github:J1I1E/flowcraft"],

  "agent": {
    "planner": {
      "model": "dmx/deepseek-v4-flash",
      "mode": "subagent",
      "description": "战略规划者 - 分析和规划复杂任务",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "coder": {
      "model": "dmx/deepseek-v4-flash",
      "mode": "subagent",
      "description": "代码实现者 - 编写整洁代码",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "allow", "bash": "allow", "webfetch": "allow", "doom_loop": "ask", "external_directory": "allow" }
    },
    "reviewer": {
      "model": "dmx/deepseek-v4-flash",
      "mode": "subagent",
      "description": "代码审查者 - 发现 bug 和质量问题",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "writer": {
      "model": "dmx/deepseek-v4-pro-guan",
      "mode": "subagent",
      "description": "写作专家 - 生成高质量文档和报告",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "allow", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "analyst": {
      "model": "dmx/deepseek-v4-flash",
      "mode": "subagent",
      "description": "数据分析专家 - 分析实验结果、指标、日志和研究数据",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "allow", "doom_loop": "deny", "external_directory": "deny" }
    },
    "vision": {
      "model": "dmx/doubao-seed-2-0-lite-260215",
      "mode": "subagent",
      "description": "图像分析专家 - 分析图像和截图",
      "tools": { "task": false, "delegate": false },
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "deny", "doom_loop": "deny", "external_directory": "deny" }
    }
  }
}
```

> **注意**：请将模型 ID 和 provider 名称替换为你自己的配置。每个子 agent 上的 `delegate: false` 限制是**必需的**——它阻止递归委派和无限循环。

## 工具列表

| 工具 | 说明 |
|------|------|
| `delegate` | 将单个任务委派给 specialist 子 agent |
| `delegate_batch` | **并行批量委派** 2–5 个任务（仅当任务涉及不同文件时才并行） |
| `flowcraft_status` | 检查插件状态、已加载的 agent 和技能数量 |
| `run_skill` | 按名称调用技能（inline 或 subagent 模式） |
| `skill_index` | 列出所有可用技能及描述 |
| `read_with_hash` | 读取文件并附加内容 hash 的行注释，用于安全编辑 |
| `hashline_edit` | 使用 hash 校验的行引用编辑文件（批量原子应用） |
| `analyze_image` | 通过视觉模型分析图像、截图或图表 |

## 架构

```
User → orchestrator
  ├── delegate（单任务委派）
  ├── delegate_batch（并行批量）
  │     ├── 冲突检测：预防 → git merge-tree → 语义合并
  │     └── worktree 隔离（可选）
  └── 技能系统：inline + subagent 模式
```

### 冲突检测流程

```
任务分派
    │
    ▼
阶段 1：预防性分析（文件级重叠检测）
    │  无重叠 → 继续
    │  检测到重叠 → 拒绝批量，建议顺序委派
    ▼
阶段 2：Git merge-tree（预合并兼容性检查）
    │  干净合并 → 继续
    │  发现冲突 → 升级到阶段 3
    ▼
阶段 3：语义合并（LLM 分类判断）
    │  SEMANTIC-MERGE → 自动重排
    │  AUTO-MERGE → 简单合并，直接应用
    │  ESCALATE → 需要人工审核
```

## 技能系统

通过 `SKILL.md` 文件定义可复用的 prompt 包，使用 YAML 前置元数据：

```
~/.agents/skills/<name>/SKILL.md    # 用户级（所有项目可用）
./.deepcode/skills/<name>/SKILL.md   # 项目级
```

示例：

```markdown
---
name: brainstorm
description: 任何创造性工作前必须使用 — 探索意图、需求与设计方案
runAs: subagent
model: dmx/deepseek-v4-flash
---

## 头脑风暴协议

1. 用自己的话重述目标
2. 识别约束条件和边界情况
3. 提出 3 种替代方案及其权衡
4. 推荐一种方案并说明理由
```

## 并行调度最佳实践

- **读取 + 写入任务**可以安全重叠（如 analyst 读日志 + coder 编辑不同文件）
- **两个任务编辑同一文件**必须顺序执行——使用 `delegate`，不要用 `delegate_batch`
- **每批最多 5 个任务**以控制开销
- 对于大型或高风险的并行运行，建议启用 **worktree 隔离**（`useWorktree: true`）

## 从源码构建

```bash
npm install          # 安装依赖
npm run build        # tsc + esbuild → dist/bundle.js
npm run typecheck    # 仅 TypeScript 类型检查
npm run dev          # 监听模式 + 自动部署
```

## 许可证

MIT
