import { execSync } from "node:child_process"
import { existsSync, mkdirSync, symlinkSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

export interface WorktreeOptions {
  baseDir?: string
  timeout?: number
}

export interface WorktreeInfo {
  path: string
  branch: string
  agent: string
}

export class WorktreeManager {
  private repoPath: string
  private baseDir: string
  private sharedDirs: string[]

  constructor(repoPath: string, options?: WorktreeOptions) {
    this.repoPath = resolve(repoPath)
    this.baseDir = options?.baseDir ?? resolve(repoPath, "..", "flowcraft-wt")
    this.sharedDirs = []
  }

  setSharedDirs(dirs: string[]): void {
    this.sharedDirs = dirs
  }

  async create(agentName: string, taskLabel: string): Promise<WorktreeInfo> {
    const branchName = `flowcraft/${agentName}/${taskLabel.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`
    const worktreePath = join(this.baseDir, `${branchName.replace(/\//g, "-")}`)

    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true })
    }

    if (existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force 2>nul`, {
          cwd: this.repoPath, stdio: "pipe", timeout: 10000,
        })
      } catch { /* ignore */ }
      rmSync(worktreePath, { recursive: true, force: true })
    }

    execSync(
      `git worktree add -b "${branchName}" "${worktreePath}" HEAD`,
      { cwd: this.repoPath, stdio: "pipe", timeout: 30000 }
    )

    for (const dir of this.sharedDirs) {
      const srcDir = join(this.repoPath, dir)
      const dstDir = join(worktreePath, dir)
      if (existsSync(srcDir) && !existsSync(dstDir)) {
        try {
          symlinkSync(srcDir, dstDir, "junction")
        } catch {
          if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true })
        }
      }
    }

    return { path: worktreePath, branch: branchName, agent: agentName }
  }

  isClean(worktree: WorktreeInfo): boolean {
    try {
      const status = execSync("git status --porcelain", {
        cwd: worktree.path, stdio: "pipe", timeout: 10000, encoding: "utf-8",
      })
      return status.trim().length === 0
    } catch { return false }
  }

  commit(worktree: WorktreeInfo, message: string): void {
    execSync("git add -A", { cwd: worktree.path, stdio: "pipe", timeout: 30000 })
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: worktree.path, stdio: "pipe", timeout: 30000,
    })
  }

  merge(worktree: WorktreeInfo): { success: boolean; message: string } {
    try {
      this.commit(worktree, `feat(flowcraft): ${worktree.agent} task`)

      execSync(`git fetch . "${worktree.branch}"`, {
        cwd: this.repoPath, stdio: "pipe", timeout: 30000,
      })
      execSync(`git merge "${worktree.branch}" --no-edit`, {
        cwd: this.repoPath, stdio: "pipe", timeout: 60000,
      })

      return { success: true, message: `Merged ${worktree.branch}` }
    } catch (err) {
      try {
        execSync("git merge --abort", { cwd: this.repoPath, stdio: "pipe", timeout: 10000 })
      } catch { /* ignore */ }
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, message: `Merge conflict: ${msg.slice(0, 200)}` }
    }
  }

  async cleanup(worktree: WorktreeInfo): Promise<void> {
    try {
      execSync(`git worktree remove "${worktree.path}" --force 2>nul`, {
        cwd: this.repoPath, stdio: "pipe", timeout: 15000,
      })
    } catch { /* ignore */ }
    if (existsSync(worktree.path)) {
      rmSync(worktree.path, { recursive: true, force: true })
    }
  }

  async cleanupAll(): Promise<void> {
    try {
      const output = execSync("git worktree list", {
        cwd: this.repoPath, stdio: "pipe", timeout: 10000, encoding: "utf-8",
      })
      for (const line of output.split("\n")) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 1 && parts[0].includes("flowcraft-wt")) {
          try {
            execSync(`git worktree remove "${parts[0]}" --force 2>nul`, {
              cwd: this.repoPath, stdio: "pipe", timeout: 15000,
            })
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
}
