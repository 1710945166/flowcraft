import * as Diff from "diff"

export interface LineRange {
  start: number
  end: number
}

export interface FileChange {
  file: string
  ranges: LineRange[]
  type: "add" | "modify" | "delete"
}

/** 用 diff 计算两个版本之间的行级变更范围 */
export function computeChanges(original: string, modified: string): LineRange[] {
  const changes = Diff.diffLines(original, modified)
  const ranges: LineRange[] = []
  let lineOffset = 1

  for (const part of changes) {
    const lineCount = (part.value.match(/\n/g) || []).length
    if (part.added || part.removed) {
      ranges.push({ start: lineOffset, end: lineOffset + lineCount - 1 })
    }
    if (!part.removed) {
      lineOffset += lineCount
    }
  }

  return ranges
}

/** 判断两个行范围是否有交集 */
export function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end
}

/** 判断两组变更是否有冲突 */
export function hasConflict(changesA: FileChange[], changesB: FileChange[]): boolean {
  for (const a of changesA) {
    for (const b of changesB) {
      if (a.file !== b.file) continue
      // 都是读操作不冲突
      if (a.type === "delete" && b.type === "delete") continue
      // 写-写或写-读有重叠范围才冲突
      for (const ra of a.ranges) {
        for (const rb of b.ranges) {
          if (rangesOverlap(ra, rb)) return true
        }
      }
    }
  }
  return false
}
