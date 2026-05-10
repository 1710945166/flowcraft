import type { OpencodeClient } from "@opencode-ai/sdk"

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
