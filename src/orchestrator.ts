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

  // Step 1: Send a SubtaskPart to the PARENT session via promptAsync.
  // This triggers OpenCode's native sub-window mechanism while avoiding
  // the deadlock that sync prompt() causes.
  await client.session.promptAsync({
    path: { id: parentSessionID },
    body: {
      parts: [{
        type: "subtask",
        prompt: task,
        description: `flowcraft: ${agentName}`,
        agent: agentName,
      }],
    },
    query: { directory: parentDir },
  })

  // Step 2: Poll for the new child session created by the SubtaskPart
  const childID = await waitForChildSession(client, parentSessionID, parentDir, 10000)

  // Step 3: Wait for the child session to complete and collect output
  return await waitForSessionOutput(client, childID, parentDir)
}

async function waitForChildSession(
  client: OpencodeClient,
  parentID: string,
  directory: string,
  timeout = 10000
): Promise<string> {
  const start = Date.now()
  const knownChildren = new Set<string>()

  // Collect already-known children
  const existing = await client.session.children({
    path: { id: parentID },
    query: { directory },
  }).catch(() => null)
  for (const s of existing?.data ?? []) {
    knownChildren.add(s.id)
  }

  // Poll for NEW children
  while (Date.now() - start < timeout) {
    const children = await client.session.children({
      path: { id: parentID },
      query: { directory },
    }).catch(() => null)

    for (const s of children?.data ?? []) {
      if (!knownChildren.has(s.id)) {
        return s.id // Found the newly created child session
      }
    }
    await sleep(500)
  }

  throw new Error("Timeout waiting for child session to appear")
}

async function waitForSessionOutput(
  client: OpencodeClient,
  sessionID: string,
  directory: string,
  timeout = 600000
): Promise<string> {
  const start = Date.now()
  let idleSince: number | null = null

  while (Date.now() - start < timeout) {
    const statusRes = await client.session.status({
      query: { directory },
    }).catch(() => null)

    const statuses = statusRes?.data ?? {}
    const myStatus = statuses[sessionID] as any

    if (!myStatus) {
      await sleep(1000)
      continue
    }

    if (myStatus.type === "idle") {
      if (idleSince === null) {
        idleSince = Date.now()
      } else if (Date.now() - idleSince > 2000) {
        return await collectOutput(client, sessionID, directory)
      }
    } else {
      idleSince = null
    }
    await sleep(1000)
  }
  return await collectOutput(client, sessionID, directory)
}

async function collectOutput(
  client: OpencodeClient,
  sessionID: string,
  directory: string,
): Promise<string> {
  const msgRes = await client.session.messages({
    path: { id: sessionID },
    query: { directory, limit: 10 },
  }).catch(() => null)

  const messages = msgRes?.data ?? []
  for (const msg of [...messages].reverse()) {
    if (msg.info.role === "assistant") {
      const texts = msg.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text || "")
        .filter(Boolean)
      if (texts.length > 0) return texts.join("\n")
    }
  }
  return "(no output)"
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
