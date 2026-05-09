import type { OpencodeClient, EventSessionIdle } from "@opencode-ai/sdk"
import type { Hooks } from "@opencode-ai/plugin"

export function createTodoEnforcer(
  client: OpencodeClient
): NonNullable<Hooks["event"]> {
  const nagCounters = new Map<string, number>()

  return async ({ event }) => {
    if (event.type !== "session.idle") return
    const idle = event as EventSessionIdle
    const sessionID = idle.properties.sessionID

    try {
      const res = await client.session.todo({ path: { id: sessionID } })
      const todos = res.data
      if (!todos || todos.length === 0) return

      const pending = todos.filter(
        (t) => t.status === "pending" || t.status === "in_progress"
      )
      if (pending.length === 0) return

      const count = nagCounters.get(sessionID) ?? 0
      nagCounters.set(sessionID, count + 1)

      const nagMessages = [
        `⏰ ${pending.length} task(s) still pending. Resume work on: ${pending[0].content}`,
        `Still ${pending.length} todo(s) open. Keep going: "${pending[0].content}"`,
        `Don't stop now — ${pending.length} task(s) waiting. Next: ${pending[0].content}`,
      ]

      // Only nag on 1st, 2nd, then every 5th idle after that
      if (count === 0 || count === 1 || count % 5 === 0) {
        const msg = nagMessages[Math.min(count, nagMessages.length - 1)]
        await client.tui.appendPrompt({ body: { text: msg } })
      }
    } catch {
      // session might not exist or have todos disabled
    }
  }
}
