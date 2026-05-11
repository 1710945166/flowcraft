// flowcraft dev script: one-command rebuild + deploy
// Usage: node scripts/dev.mjs

import { execSync } from "node:child_process"
import { copyFileSync, existsSync, watch as fsWatch } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const home = process.env.USERPROFILE || homedir()
const deployPath = join(home, ".config/opencode/plugins/flowcraft.js")

function build() {
  console.log("🔨 Building...")
  try {
    execSync("node scripts/build.js", { cwd: root, stdio: "pipe" })
    return true
  } catch (e) {
    console.error("❌ Build failed")
    return false
  }
}

function deploy() {
  const src = join(root, "dist/bundle.js")
  if (!existsSync(src)) {
    console.error("❌ bundle.js not found, run build first")
    return false
  }
  copyFileSync(src, deployPath)
  console.log("✅ Deployed to", deployPath)
  return true
}

function fullCycle() {
  console.log("\n" + "=".repeat(50))
  if (build()) deploy()
  console.log("=".repeat(50) + "\n")
}

// Watch mode
const args = process.argv.slice(2)
if (args.includes("--watch") || args.includes("-w")) {
  console.log("👀 Watching src/ for changes...")
  fullCycle()
  fsWatch(join(root, "src"), { recursive: true }, (event, file) => {
    if (file.endsWith(".ts")) {
      console.log(`\n📄 ${file} changed`)
      fullCycle()
    }
  })
} else {
  fullCycle()
}
