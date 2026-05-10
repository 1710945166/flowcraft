/**
 * 语义合并模块
 *
 * 当 git 报告文本冲突时，用 LLM 判断是真正的语义冲突还是可自动合并的伪冲突。
 *
 * 使用方法：
 * 1. 收集冲突区域的两段代码（ours vs theirs）
 * 2. 构造 LLM prompt，让 LLM 判断冲突性质
 * 3. LLM 返回：SM（语义合并）/ AM（自动合并）/ ES（升级给人）
 *
 * 注意：本模块只做"判断"，不做"解决"。解决由 orchestrator 或用户负责。
 */

export type MergeVerdict = "semantic-merge" | "auto-merge" | "escalate"

export interface ConflictRegion {
  file: string
  ours: string      // 当前分支的代码
  theirs: string    // 要合并的分支的代码
  context: string   // 冲突区域的上下文
}

export interface MergeJudgment {
  verdict: MergeVerdict
  reason: string
}

/**
 * 构造 LLM prompt 用于判断冲突性质
 */
export function buildMergePrompt(region: ConflictRegion): string {
  return `You are a code merge expert. Two developers modified the same file and git reports a conflict.

File: ${region.file}

=== Current version (ours) ===
${region.ours}

=== Incoming version (theirs) ===
${region.theirs}

=== Surrounding context ===
${region.context}

Analyze whether these changes are:
1. SEMANTIC-MERGE: Changes are to different logical concerns (e.g., different variables, different functions) even though they overlap in lines. They can be automatically re-arranged.
2. AUTO-MERGE: Changes are identical or one is a subset of the other. Trivial to merge.
3. ESCALATE: Changes genuinely conflict (same variable changed to different values, same function body rewritten differently). Needs human review.

Respond with one word: SEMANTIC-MERGE, AUTO-MERGE, or ESCALATE.
Then on a new line, one sentence explaining why.`
}

/**
 * 解析 LLM 的返回
 */
export function parseMergeResponse(response: string): MergeJudgment {
  const firstLine = response.trim().split("\n")[0].toUpperCase().trim()

  if (firstLine.includes("SEMANTIC")) {
    return { verdict: "semantic-merge", reason: response.split("\n").slice(1).join(" ").trim() }
  }
  if (firstLine.includes("AUTO")) {
    return { verdict: "auto-merge", reason: response.split("\n").slice(1).join(" ").trim() }
  }
  return { verdict: "escalate", reason: response.split("\n").slice(1).join(" ").trim() || "Unresolvable conflict" }
}

/**
 * 提取 git 冲突区域
 */
export function extractConflictRegions(filePath: string, content: string): ConflictRegion[] {
  const regions: ConflictRegion[] = []
  const lines = content.split("\n")
  let i = 0

  while (i < lines.length) {
    if (lines[i].startsWith("<<<<<<<")) {
      const conflictStart = i
      const ours: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("=======")) {
        ours.push(lines[i])
        i++
      }
      i++ // skip =======
      const theirs: string[] = []
      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        theirs.push(lines[i])
        i++
      }
      const conflictEnd = i

      // 提取上下文（冲突前后各 3 行）
      const contextStart = Math.max(0, conflictStart - 3)
      const contextEnd = Math.min(lines.length, conflictEnd + 4)
      const context = lines.slice(contextStart, contextEnd).join("\n")

      regions.push({
        file: filePath,
        ours: ours.join("\n"),
        theirs: theirs.join("\n"),
        context,
      })
    }
    i++
  }

  return regions
}
