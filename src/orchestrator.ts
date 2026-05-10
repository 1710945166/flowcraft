import type { OpencodeClient } from "@opencode-ai/sdk"
import { WorktreeManager } from "./worktree-manager.js"
import type { WorktreeInfo } from "./worktree-manager.js"

export async function dispatchToAgent(
  client: OpencodeClient,
  parentSessionID: string,
  agentName: string,
  task: string
): Promise<string> {
  const parent = await client.session
    .get({ path: { id: parentSessionID } })
    .catch(() => null)
  const parentDir = parent?.data?.directory ?? process.cwd()

  const child = await client.session.create({
    body: {
      parentID: parentSessionID,
      title: `flowcraft: ${agentName} - ${task.slice(0, 60)}`,
    } as Record<string, unknown>,
    query: { directory: parentDir },
  })
  if (!child.data?.id) throw new Error("Failed to create agent session")

  const childID = child.data.id
  const startTime = Date.now()

  await client.session.prompt({
    path: { id: childID },
    body: {
      parts: [{ type: "text", text: task }],
      agent: agentName,
      tools: { task: false, delegate: false },
    },
    query: { directory: parentDir },
  })

  const waitForIdle = async (): Promise<void> => {
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const statusRes = await client.session.status({
        query: { directory: parentDir },
      }).catch(() => null)
      const statuses = statusRes?.data ?? {}
      const myStatus = (statuses as Record<string, { type: string }>)[childID]
      if (!myStatus || myStatus.type === "idle") return
    }
  }
  await waitForIdle()

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  const msgRes = await client.session.messages({
    path: { id: childID },
    query: { directory: parentDir, limit: 20 },
  }).catch(() => null)

  const messages = msgRes?.data ?? []
  const workLogs = messages
    .filter((m: any) => m.info?.role === "assistant")
    .flatMap((m: any) =>
      m.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text || "")
        .filter(Boolean)
    )

  const header = `━━━ Delegated to: ${agentName} ━━━`
  const timeInfo = `⏱ Elapsed: ${elapsed}s`
  const logSection = workLogs.length > 0
    ? `\n📋 Work log:\n${workLogs.slice(-3).join("\n---\n")}`
    : ""
  const footer = `━━━ End of ${agentName} output ━━━`

  return [header, timeInfo, logSection, footer].join("\n")
}

export interface BatchTask {
  agent: string
  task: string
}

export interface BatchResult {
  agent: string
  success: boolean
  output: string
  error?: string
  elapsed: number
}

export async function dispatchBatch(
  client: OpencodeClient,
  parentSessionID: string,
  tasks: BatchTask[],
  options?: { maxWait?: number; useWorktree?: boolean }
): Promise<string> {
  const useWorktree = options?.useWorktree ?? false
  let wtManager: WorktreeManager | null = null

  if (useWorktree) {
    wtManager = new WorktreeManager(process.cwd())
    wtManager.setSharedDirs(["DiC-SR", "DiC-main", "DiC_SR_DATA"])
  }
  const parent = await client.session
    .get({ path: { id: parentSessionID } })
    .catch(() => null)
  const parentDir = parent?.data?.directory ?? process.cwd()
  const maxWait = (options?.maxWait ?? 120) * 1000
  const startTime = Date.now()

  // Phase 1: create all child sessions in parallel (optionally with worktrees)
  const sessionPromises = tasks.map(async (t, i) => {
    let sessionDir = parentDir
    let wt: WorktreeInfo | null = null
    if (wtManager) {
      wt = await wtManager.create(t.agent, t.task)
      sessionDir = wt.path
    }
    const child = await client.session.create({
      body: {
        parentID: parentSessionID,
        title: `flowcraft-batch: ${t.agent} - ${t.task.slice(0, 60)}`,
      } as Record<string, unknown>,
      query: { directory: sessionDir },
    })
    if (!child.data?.id) throw new Error(`Failed to create session for ${t.agent}`)
    return { id: child.data.id, agent: t.agent, task: t.task, index: i, directory: sessionDir, wt: wt ?? null }
  })
  const children = await Promise.all(sessionPromises)

  // Phase 2: 并行发送 promptAsync（立即返回 204）
  await Promise.all(children.map(c =>
    client.session.promptAsync({
      path: { id: c.id },
      body: {
        parts: [{ type: "text", text: c.task }],
        agent: c.agent,
        tools: { task: false, delegate: false },
      },
      query: { directory: c.directory },
    })
  ))

  // Phase 3: poll until all sessions are idle (query each child's directory)
  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 2000))
    const dirSet = new Set(children.map(c => c.directory))
    const merged: Record<string, { type: string }> = {}
    for (const dir of dirSet) {
      const res = await client.session.status({ query: { directory: dir } }).catch(() => null)
      if (res?.data) Object.assign(merged, res.data)
    }
    const allIdle = children.every(c => {
      const s = merged[c.id]
      return !s || s.type === "idle"
    })
    if (allIdle) break
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  // Phase 5: format output
  const lines: string[] = [
    `━━━ Batch: ${tasks.length} tasks in parallel ━━━`,
    `⏱ Total elapsed: ${totalElapsed}s`,
    ``,
  ]

  // Phase 4: collect results in parallel (allSettled prevents single failure from blocking)
  const results = await Promise.allSettled(children.map(async (c) => {
    const cStart = Date.now()
    const msgRes = await client.session.messages({
      path: { id: c.id },
      query: { directory: c.directory, limit: 20 },
    }).catch(() => null)
    const msgs = msgRes?.data ?? []
    const logs = msgs
      .filter((m: any) => m.info?.role === "assistant")
      .flatMap((m: any) =>
        m.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text || "")
          .filter(Boolean)
      )
    return {
      agent: c.agent,
      success: true,
      output: logs.slice(-3).join("\n---\n"),
      elapsed: Number(((Date.now() - cStart) / 1000).toFixed(1)),
    } as BatchResult
  }))

  // Phase 4.5: merge worktrees back if enabled
  if (wtManager) {
    for (const c of children) {
      const wt = c.wt
      if (!wt) continue
      if (!wtManager.isClean(wt)) {
        const mergeResult = wtManager.merge(wt)
        if (!mergeResult.success) {
          lines.push(`[⚠] Worktree merge failed for ${c.agent}: ${mergeResult.message}`)
        }
      }
      await wtManager.cleanup(wt)
    }
  }

  results.forEach((r, i) => {
    const c = children[i]
    if (r.status === "fulfilled") {
      lines.push(`[✓] ${c.agent} (${r.value.elapsed}s)`)
      if (r.value.output) lines.push(`    ${r.value.output.slice(0, 200)}`)
    } else {
      lines.push(`[✗] ${c.agent} — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    }
    lines.push(``)
  })

  lines.push(`━━━ Batch complete ━━━`)
  return lines.join("\n")
}
