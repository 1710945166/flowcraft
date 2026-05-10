import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { computeChanges, hasConflict, type FileChange } from "./diff-utils.js"

export interface ConflictReport {
  hasConflict: boolean
  stage: "prevention" | "auto-merge" | "git-merge"
  details: string
  files?: string[]
}

/**
 * 阶段 1: 预防性分析（分派前）
 * 检查两组文件变更是否有重叠
 */
export function preventConflict(
  tasks: Array<{ agent: string; files?: string[] }>
): ConflictReport {
  // 收集每个文件被哪些任务涉及
  const fileMap = new Map<string, string[]>()
  for (const t of tasks) {
    if (!t.files) continue
    for (const f of t.files) {
      const list = fileMap.get(f) || []
      list.push(t.agent)
      fileMap.set(f, list)
    }
  }

  // 检查是否有文件被多个任务涉及
  const conflicts = Array.from(fileMap.entries())
    .filter(([_, agents]) => agents.length > 1)
    .map(([file, agents]) => `${file} (${agents.join(", ")})`)

  if (conflicts.length > 0) {
    return {
      hasConflict: true,
      stage: "prevention",
      details: `File overlap detected: ${conflicts.join("; ")}`,
      files: Array.from(fileMap.entries())
        .filter(([_, agents]) => agents.length > 1)
        .map(([file]) => file),
    }
  }

  return { hasConflict: false, stage: "prevention", details: "No file overlap" }
}

/**
 * 阶段 2: Git merge-tree 预合并检测
 * 用 git merge-tree 无副作用地检查两个分支是否有文本冲突
 */
export function gitMergeConflict(
  repoPath: string,
  branchA: string,
  branchB: string
): ConflictReport {
  try {
    // merge-tree 无副作用，只输出合并结果
    const output = execSync(
      `git merge-tree $(git merge-base HEAD "${branchA}") HEAD "${branchB}"`,
      { cwd: repoPath, encoding: "utf-8", timeout: 30000, stdio: "pipe" }
    )

    // 检查输出中是否有冲突标记
    if (output.includes("<<<<<<<") || output.includes("=======") || output.includes(">>>>>>>")) {
      // 提取冲突文件列表
      const conflictFiles = output
        .split("\n")
        .filter(l => l.includes("changed in both"))
        .map(l => {
          const match = l.match(/^(.+?)\s+\(/)
          return match ? match[1].trim() : ""
        })
        .filter(Boolean)

      return {
        hasConflict: true,
        stage: "git-merge",
        details: `Git merge conflict in: ${conflictFiles.join(", ") || "unknown files"}`,
        files: conflictFiles,
      }
    }

    return { hasConflict: false, stage: "git-merge", details: "Clean merge" }
  } catch (err) {
    return {
      hasConflict: true,
      stage: "git-merge",
      details: `Merge check error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * 阶段 3: 完整的三阶段冲突检测
 * 从预防 → git 合并 → 语义分析
 */
export async function detectConflicts(
  repoPath: string,
  tasks: Array<{ agent: string; files?: string[] }>,
  branches: Array<{ agent: string; branch: string }>
): Promise<ConflictReport> {
  // 阶段 1: 预防性分析
  const stage1 = preventConflict(tasks)
  if (stage1.hasConflict) return stage1

  // 阶段 2: Git merge-tree 检查
  for (const b of branches) {
    try {
      const stage2 = gitMergeConflict(repoPath, "HEAD", b.branch)
      if (stage2.hasConflict) return stage2
    } catch { /* next */ }
  }

  return { hasConflict: false, stage: "auto-merge", details: "No conflicts detected" }
}
