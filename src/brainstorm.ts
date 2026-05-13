import type { OpencodeClient } from "@opencode-ai/sdk"
import { dispatchToAgent } from "./orchestrator.js"
import { loadDMXKey } from "./config.js"

const DEFAULT_PERSPECTIVES = ["planner", "analyst", "coder", "reviewer"]

const PERSPECTIVE_PROMPTS: Record<string, string> = {
  planner: `你是一位战略规划师。请从顶层设计角度分析以下主题：

<主题>
{topic}
</主题>

请从以下方面思考：
1. 目标与范围——我们要解决什么问题？成功标准是什么？
2. 可选路径——有哪些不同的方法？各自的取舍是什么？
3. 风险与依赖——有什么前置条件或潜在风险？
4. 建议路线——你推荐哪条路？为什么？

输出格式：简洁的分点报告，每点 2-3 句话。`,

  analyst: `你是一位数据与实验分析师。请从数据指标和实验评估角度分析以下主题：

<主题>
{topic}
</主题>

请从以下方面思考：
1. 评估指标——应该用什么指标衡量效果？为什么？
2. 基线对比——现有 baseline 是什么？预期提升多少？
3. 数据需求——需要什么数据？规模、质量要求？
4. 实验设计——如何设计对比实验来验证方案？

输出格式：简洁的分点报告，每点 2-3 句话。`,

  coder: `你是一位实现专家。请从技术可行性和实现角度分析以下主题：

<主题>
{topic}
</主题>

请从以下方面思考：
1. 技术方案——用什么技术栈或框架实现最合适？
2. 实现难度——哪些部分容易，哪些部分有挑战？
3. 改动范围——大概需要修改/新增多少代码？哪些文件？
4. 潜在陷阱——有什么常见的坑需要注意？

输出格式：简洁的分点报告，每点 2-3 句话。`,

  reviewer: `你是一位严谨的代码审查专家。请从质量保障和风险控制角度分析以下主题：

<主题>
{topic}
</主题>

请从以下方面思考：
1. 质量风险——这个方案可能引入什么质量问题？边界情况？
2. 安全隐患——是否有数据泄露、权限、注入等安全问题？
3. 可维护性——方案是否易于后续维护和扩展？
4. 审查清单——如果需要上线，必须检查哪些关键点？

输出格式：简洁的分点报告，每点 2-3 句话。`,
}

const PERSPECTIVE_LABELS: Record<string, string> = {
  planner: "战略分析",
  analyst: "数据分析",
  coder: "实现分析",
  reviewer: "审查分析",
}

export class BrainstormEngine {
  private readonly client: OpencodeClient
  private readonly defaultPerspectives: string[]

  constructor(client: OpencodeClient, defaultPerspectives?: string[]) {
    this.client = client
    this.defaultPerspectives = defaultPerspectives ?? DEFAULT_PERSPECTIVES
  }

  async brainstorm(topic: string, perspectives?: string[], sessionID?: string): Promise<string> {
    // Validate
    if (!topic || topic.trim().length === 0) {
      return "Error: Brainstorm topic cannot be empty."
    }
    if (!sessionID || sessionID.trim().length === 0) {
      return "Error: No active session. Brainstorm requires an active session."
    }

    const selected = perspectives && perspectives.length > 0 ? perspectives : this.defaultPerspectives

    // Phase 1: Parallel dispatch
    const results = await this.dispatchPerspectives(topic, selected, sessionID ?? "")

    const allFailed = [...results.values()].every(r => !r.success)
    if (allFailed) {
      return "Error: 所有视角分析均失败。请检查 agent 配置和网络连接。"
    }

    // Phase 2: Synthesize
    const synthesized = await this.synthesizeResults(topic, results)

    // Phase 3: Format
    return this.formatOutput(topic, results, synthesized)
  }

  private async dispatchPerspectives(
    topic: string,
    perspectives: string[],
    sessionID: string
  ): Promise<Map<string, { success: boolean; output: string }>> {
    const settled = await Promise.allSettled(
      perspectives.map(async (name) => {
        const prompt = PERSPECTIVE_PROMPTS[name]
          ? PERSPECTIVE_PROMPTS[name].replace(/\{topic\}/g, topic)
          : `请从你的专业角度分析以下主题：\n\n${topic}`
        const output = await dispatchToAgent(this.client, sessionID, name, prompt)
        return { name, output }
      })
    )

    const results = new Map<string, { success: boolean; output: string }>()
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i]
      const name = perspectives[i]
      if (r.status === "fulfilled") {
        results.set(name, { success: true, output: r.value.output })
      } else {
        results.set(name, { success: false, output: "" })
      }
    }
    return results
  }

  private async synthesizeResults(
    topic: string,
    results: Map<string, { success: boolean; output: string }>
  ): Promise<string | null> {
    const apiKey = loadDMXKey()
    if (!apiKey) return null

    const successfulEntries = [...results.entries()].filter(([_, r]) => r.success)
    if (successfulEntries.length === 0) return null

    const MAX_PERSPECTIVE_LENGTH = 4000
    const sections = successfulEntries
      .map(([name, r]) => {
        const truncated = r.output.length > MAX_PERSPECTIVE_LENGTH
          ? r.output.slice(0, MAX_PERSPECTIVE_LENGTH) + "\n[...以下内容已截断]"
          : r.output
        return `=== ${name} 视角 ===\n${truncated}`
      })
      .join("\n\n")

    const synthesisPrompt = `你是一位资深的综合分析专家。下面是一个主题的多视角分析结果。

<主题>
${topic}
</主题>

${sections}

请综合以上${successfulEntries.length}个视角的分析，输出一份结构化的综合报告：
1. 核心结论（用 2-3 句话概括）
2. 关键分歧（各视角之间不一致的地方）
3. 共识点（各视角一致认同的地方）
4. 建议行动方案（按优先级排序，每个行动 1-2 句话）

使用 markdown 格式，简洁务实。`

    try {
      const res = await fetch("https://www.dmxapi.cn/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: synthesisPrompt }],
          max_tokens: 8192,
          reasoning_effort: "max",
          thinking: { type: "enabled" },
        }),
        signal: AbortSignal.timeout(60_000),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error(`Synthesis API error ${res.status}: ${errText.slice(0, 200)}`)
        return null
      }

      const data = await res.json() as any
      return data?.choices?.[0]?.message?.content || null
    } catch {
      return null
    }
  }

  private formatOutput(
    topic: string,
    results: Map<string, { success: boolean; output: string }>,
    synthesized: string | null
  ): string {
    const lines: string[] = [
      `━━━ Brainstorm: ${topic} ━━━`,
      "",
    ]

    for (const [name, result] of results) {
      const label = PERSPECTIVE_LABELS[name] || name
      if (result.success) {
        lines.push(`[${name} — ${label}]`)
        lines.push(result.output)
      } else {
        lines.push(`[${name} — ${label}]`)
        lines.push("[✗] 该视角分析失败或超时，已跳过。")
      }
      lines.push("")
    }

    if (synthesized) {
      lines.push(`━━━ 综合报告 ━━━`)
      lines.push("")
      lines.push(synthesized)
      lines.push("")
    } else {
      lines.push(`━━━ 综合报告（跳过 — 合成 API 不可用）━━━`)
      lines.push("")
    }

    lines.push(`━━━ End of brainstorm ━━━`)
    return lines.join("\n")
  }
}
