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

  // Send a new message to the parent session with a SubtaskPart.
  // This triggers OpenCode's native subtask mechanism: the server creates
  // a child session, routes it to the sub-agent, and the TUI shows a
  // sub-window — same as the built-in `task` tool.
  const response = await client.session.prompt({
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

  const parts = response?.data?.parts ?? []
  const textParts = parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text || "")
    .filter(Boolean)
  return textParts.join("\n") || "(no output)"
}
