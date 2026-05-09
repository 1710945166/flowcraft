import type { OpencodeClient, SessionStatus } from "@opencode-ai/sdk"

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

  await client.session.promptAsync({
    path: { id: childID },
    body: {
      parts: [{ type: "text", text: task }],
      agent: agentName,
      tools: { task: false, delegate: false },
    },
    query: { directory: parentDir },
  })

  return await waitForSessionResult(client, childID, parentDir)
}

async function waitForSessionResult(
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
    const myStatus = statuses[sessionID] as SessionStatus | undefined

    if (!myStatus) {
      await sleep(1000)
      continue
    }

    if (myStatus.type === "idle") {
      if (idleSince === null) {
        idleSince = Date.now()
      } else if (Date.now() - idleSince > 2000) {
        return await collectSessionOutput(client, sessionID, directory)
      }
    } else {
      idleSince = null
    }

    await sleep(1000)
  }

  return await collectSessionOutput(client, sessionID, directory)
}

async function collectSessionOutput(
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
        .filter(p => p.type === "text")
        .map(p => (p as any).text || "")
        .filter(Boolean)
      if (texts.length > 0) return texts.join("\n")
    }
  }
  return "(no output)"
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
