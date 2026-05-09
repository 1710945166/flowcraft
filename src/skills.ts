/**
 * Skills — load SKILL.md files from user/project directories.
 * Adapted from Reasonix (esengine/reasonix) Skills convention.
 *
 * Scans:
 *   ~/.agents/skills/<name>/SKILL.md   (user-level, shared with Deep Code)
 *   ./.deepcode/skills/<name>/SKILL.md  (project-level, shared with Deep Code)
 *   ./.reasonix/skills/<name>/SKILL.md  (project-level, Reasonix compat)
 *
 * Also accepts flat <name>.md format.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SKILL_FILE = "SKILL.md";

export interface Skill {
  name: string;
  description: string;
  body: string;
  /** Which scope this skill was loaded from */
  scope: "project" | "global";
  /** Absolute path to the SKILL.md file */
  path: string;
  /** Execution mode: "inline" = inject as system prompt, "subagent" = dispatch via delegate */
  runAs: "inline" | "subagent";
  /** Optional model override for subagent mode */
  model?: string;
}

export interface SkillStoreOptions {
  homeDir?: string;
  projectRoot?: string;
}

/**
 * Parse frontmatter from a markdown file.
 * Supports: name, description, runAs, model
 */
function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") return { data: {}, body: raw };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (m?.[1]) data[m[1]] = (m[2] ?? "").trim();
  }
  return {
    data,
    body: lines.slice(end + 1).join("\n").replace(/^\n+/, ""),
  };
}

export class SkillStore {
  private readonly homeDir: string;
  private readonly projectRoot: string | undefined;

  constructor(opts: SkillStoreOptions = {}) {
    this.homeDir = opts.homeDir ?? homedir();
    this.projectRoot = opts.projectRoot ? resolve(opts.projectRoot) : undefined;
  }

  /** Scan paths in priority order */
  roots(): Array<{ dir: string; scope: "project" | "global" }> {
    const out: Array<{ dir: string; scope: "project" | "global" }> = [];
    if (this.projectRoot) {
      // Check both .deepcode and .reasonix conventions
      for (const sub of [".deepcode", ".reasonix"]) {
        out.push({ dir: join(this.projectRoot, sub, "skills"), scope: "project" });
      }
    }
    out.push({ dir: join(this.homeDir, ".agents", "skills"), scope: "global" });
    return out;
  }

  /** List all available skills */
  list(): Skill[] {
    const byName = new Map<string, Skill>();
    for (const { dir, scope } of this.roots()) {
      if (!existsSync(dir)) continue;
      let entries: import("node:fs").Dirent[];
      try { entries = readdirSync(dir, { withFileTypes: true }); }
      catch { continue; }

      for (const entry of entries) {
        const skill = this.readEntry(dir, scope, entry);
        if (!skill) continue;
        if (!byName.has(skill.name)) byName.set(skill.name, skill);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Read one skill by name */
  read(name: string): Skill | null {
    for (const { dir, scope } of this.roots()) {
      if (!existsSync(dir)) continue;

      const dirCandidate = join(dir, name, SKILL_FILE);
      if (existsSync(dirCandidate) && statSync(dirCandidate).isFile()) {
        return this.parse(dirCandidate, name, scope);
      }

      const flatCandidate = join(dir, `${name}.md`);
      if (existsSync(flatCandidate) && statSync(flatCandidate).isFile()) {
        return this.parse(flatCandidate, name, scope);
      }
    }
    return null;
  }

  private readEntry(
    dir: string, scope: "project" | "global", entry: import("node:fs").Dirent
  ): Skill | null {
    if (entry.isDirectory()) {
      const file = join(dir, entry.name, SKILL_FILE);
      if (!existsSync(file)) return null;
      return this.parse(file, entry.name, scope);
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const stem = entry.name.slice(0, -3);
      return this.parse(join(dir, entry.name), stem, scope);
    }
    return null;
  }

  private parse(path: string, stem: string, scope: "project" | "global"): Skill | null {
    let raw: string;
    try { raw = readFileSync(path, "utf8"); }
    catch { return null; }

    const { data, body } = parseFrontmatter(raw);
    const name = data.name ?? stem;
    const runAsRaw = data.runAs?.trim();
    return {
      name,
      description: (data.description ?? "").trim(),
      body: body.trim(),
      scope,
      path,
      runAs: runAsRaw === "subagent" ? "subagent" : "inline",
      model: data.model?.startsWith("deepseek-") ? data.model : undefined,
    };
  }

  /** Build an index string for the system prompt */
  buildIndex(): string {
    const skills = this.list().filter((s) => s.description);
    if (skills.length === 0) return "";

    const lines = skills.map((s) => {
      const tag = s.runAs === "subagent" ? " [subagent]" : "";
      return `- ${s.name}${tag} — ${s.description}`;
    });

    return [
      "",
      "# Available Skills",
      "",
      'Call `run_skill({ name: "<name>", arguments: "<task>" })` to invoke a skill.',
      "Skills tagged [subagent] run in an isolated sub-agent.",
      "",
      "```",
      lines.join("\n"),
      "```",
    ].join("\n");
  }
}
