import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import type { ToolResult } from "@opencode-ai/plugin"

function lineHash(content: string): string {
  return createHash("sha256").update(content).digest("base64url").slice(0, 6)
}

export function annotateWithHash(text: string): string {
  const lines = text.split("\n")
  return lines
    .map((line, idx) => {
      const num = idx + 1
      const hash = lineHash(line)
      return `${num}#${hash}|${line}`
    })
    .join("\n")
}

export interface HashlineEdit {
  line: number
  hash: string
  newContent: string
}

export interface HashlineEditInput {
  filePath: string
  edits: HashlineEdit[]
}

export function applyHashlineEdits(input: HashlineEditInput): ToolResult {
  try {
    const content = readFileSync(input.filePath, "utf-8").replace(/\r\n/g, "\n")
    const lines = content.split("\n")
    const failed: Array<{ line: number; expected: string; actual: string }> = []

    for (const edit of input.edits) {
      if (edit.line < 1 || edit.line > lines.length) {
        failed.push({ line: edit.line, expected: edit.hash, actual: "(out of range)" })
        continue
      }
      const actualLine = lines[edit.line - 1]
      const actualHash = lineHash(actualLine)
      if (actualHash !== edit.hash) {
        failed.push({ line: edit.line, expected: edit.hash, actual: actualHash })
      }
    }

    if (failed.length > 0) {
      const details = failed
        .map((f) => `  Line ${f.line}: expected hash ${f.expected}, got ${f.actual}`)
        .join("\n")
      return `Hash verification failed for ${failed.length} line(s). File has changed since read.\n${details}\nRe-read the file and retry.`
    }

    for (const edit of input.edits) {
      lines[edit.line - 1] = edit.newContent
    }

    writeFileSync(input.filePath, lines.join("\n"), "utf-8")
    return `Applied ${input.edits.length} hash-verified edit(s) to ${input.filePath}.`
  } catch (err) {
    return `Error editing file: ${err instanceof Error ? err.message : String(err)}`
  }
}

export function readWithHash(filePath: string): ToolResult {
  try {
    const content = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n")
    return annotateWithHash(content)
  } catch (err) {
    return `Error reading file: ${err instanceof Error ? err.message : String(err)}`
  }
}

export function createHashlineSystemPrompt(): string {
  return `## Hash-Anchored Edit System

Use \`read_with_hash\` instead of \`read\` for files you plan to edit.
Each line is annotated with a content hash: LINE#HASH|content

Use \`hashline_edit\` to make changes:
  filePath: absolute path
  edits: [{ line: 1, hash: "XXXX", newContent: "..." }]

The hash must match the current file content. If verification fails,
re-read the file with \`read_with_hash\` to get fresh hashes.
Always use absolute paths.`
}
