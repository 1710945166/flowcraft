# v0.2.1 — 2026-05-10

## English

### Added
- `flowcraft.config.json` — orchestrator tool permission white-list configuration
- `AGENTS.md` key decisions documentation

### Fixed
- Orchestrator can no longer call `hashline_edit` directly — physically blocked by OpenCode permission system (`deny`)
- `read_with_hash` preserved as read-only tool for orchestrator

### Changed
- All file edits must now go through: `coder → reviewer → commit` workflow

## 中文

### 新增
- `flowcraft.config.json` — orchestrator 工具权限白名单配置
- `AGENTS.md` 关键决策文档记录

### 修复
- Orchestrator 无法再直接调用 `hashline_edit` — 通过 OpenCode permission 系统物理拦截
- `read_with_hash` 保留为 orchestrator 只读工具

### 变更
- 所有文件修改必须走 `coder → reviewer → commit` 流程

---

## v0.2.0

### 🆕 新增
- 并行委派：新增 delegate_batch 工具，Promise.allSettled 并行调度多个子 agent
- 三阶段冲突检测：diff-utils 行范围计算 + conflict-detector 预防/git-merge + semantic-merge LLM 兜底
- Worktree 隔离：WorktreeManager 模块（默认关闭）

### 🔧 修复
- 子 agent 递归阻断：system prompt 不注入子 session、delegate/delegate_batch 身份检查、超时终止
- Linux 子窗口回归：prompt 优先 task（有子窗口），后备 delegate
- 禁用 OpenCode 内置 agent（general/explore）
- readOpencodeAgents 合并多配置，不再找到第一个就停

### 📖 文档
- README 中英双版（README.md + README.zh.md）
- SETUP.md 部署指南
- 配置文件示例（flowcraft.config.json.example, opencode.example.jsonc）
