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

  const response = await client.session.prompt({
    path: { id: childID },
    body: {
      parts: [{ type: "text", text: task }],
      agent: agentName,
      tools: { task: false, delegate: false },
    },
    query: { directory: parentDir },
  })

  const parts = response?.data?.parts ?? []
  return parts.map((p: any) => typeof p === "string" ? p : p.text || "").filter(Boolean).join("\n") || "(no output)"
}
