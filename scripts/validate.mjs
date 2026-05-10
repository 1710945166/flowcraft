import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"

const home = process.env.USERPROFILE
const configPath = join(home, ".config/opencode/opencode.jsonc")
const raw = readFileSync(configPath, "utf-8")
const clean = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")

try {
  JSON.parse(clean)
  console.log("✅ opencode.jsonc is valid JSON")
} catch (e) {
  console.log("❌ JSON error:", e.message.slice(0, 200))
  process.exit(1)
}

try {
  const req = createRequire(import.meta.url)
  const m = req(join(home, ".config/opencode/node_modules/flowcraft"))
  console.log("✅ flowcraft module:", Object.keys(m))
} catch (e) {
  console.log("❌ Module error:", e.message)
  process.exit(1)
}
