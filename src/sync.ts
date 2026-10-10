import fs from "node:fs";
import path from "node:path";
import { refOf } from "./refs.js";
import type { Store } from "./store.js";
import type { Memory, MemoryType } from "./types.js";

export const START = "<!-- memoryrail:start -->";
export const END = "<!-- memoryrail:end -->";

export interface Target {
  path: string;
  /** Text to place before the managed block when the file is created from scratch. */
  preamble?: string;
}

export const DEFAULT_TARGETS: Target[] = [
  { path: "AGENTS.md" },
  { path: "CLAUDE.md" },
  {
    path: ".cursor/rules/memoryrail.mdc",
    preamble: "---\ndescription: Project memory managed by MemoryRail\nalwaysApply: true\n---\n\n",
  },
];

const SECTIONS: Array<{ type: MemoryType; heading: string }> = [
  { type: "constraint", heading: "Constraints" },
  { type: "decision", heading: "Decisions" },
  { type: "gotcha", heading: "Gotchas" },
  { type: "attempt", heading: "Failed approaches (do not retry without a new reason)" },
  { type: "thread", heading: "Open threads" },
];

const PER_SECTION = 25;

function condense(body: string, max = 280): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

function byPriority(a: Memory, b: Memory): number {
  return Number(b.pinned) - Number(a.pinned) || Date.parse(b.updated) - Date.parse(a.updated) || a.id.localeCompare(b.id);
}

/** Deterministic: the same memories always render the same block, so `sync --check` is stable. */
export function renderBlock(memories: Memory[]): string {
  const lines = [
    START,
    "## Project memory (managed by MemoryRail)",
    "",
    "_Generated from `.memoryrail/`. Do not edit between these markers: change the memories, then run `memoryrail sync`._",
  ];
  for (const { type, heading } of SECTIONS) {
    const items = memories
      .filter((m) => m.type === type && m.status === "active")
      .sort(byPriority)
      .slice(0, PER_SECTION);
    if (!items.length) continue;
    lines.push("", `### ${heading}`);
    for (const m of items) {
      const detail = condense(m.body);
      const files = m.links.length ? ` (files: ${m.links.join(", ")})` : "";
      lines.push(`- [${refOf(m)}] **${m.title}**${detail ? ` — ${detail}` : ""}${files}`);
    }
  }
  lines.push(
    "",
    "How to use this memory:",
    "- Before changing code, run `memoryrail precheck \"<what you plan to do>\" --file <path>` (or the MCP `precheck` tool). Use `memoryrail recall \"<topic>\"` for detail.",
    "- Cite the memory you rely on as `[per DEC-xxxx]`. If your plan conflicts with a constraint or decision, stop and ask instead of proceeding.",
    "- Record new decisions, approaches that failed, and gotchas with `memoryrail remember`. Finish a session with `memoryrail handoff`.",
    END,
  );
  return lines.join("\n");
}

function applyBlock(existing: string | null, block: string, preamble = ""): string {
  if (existing === null) return `${preamble}${block}\n`;
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s !== -1 && e > s) return existing.slice(0, s) + block + existing.slice(e + END.length);
  return existing.replace(/\s+$/, "") + `\n\n${block}\n`;
}

export interface SyncChange {
  path: string;
  action: "created" | "updated" | "unchanged";
}

/** Codex stops reading AGENTS.md after this many bytes by default (project_doc_max_bytes). */
export const CODEX_DOC_LIMIT_BYTES = 32 * 1024;

export function sync(store: Store, opts: { check?: boolean; targets?: Target[] } = {}): SyncChange[] {
  const block = renderBlock(store.list());
  const changes: SyncChange[] = [];
  for (const t of opts.targets ?? DEFAULT_TARGETS) {
    const abs = path.resolve(store.root, t.path);
    if (!abs.startsWith(store.root + path.sep)) {
      throw new Error(`refusing to write outside the repository: ${t.path}`);
    }
    const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
    const next = applyBlock(existing, block, t.preamble);
    if (existing === next) {
      changes.push({ path: t.path, action: "unchanged" });
      continue;
    }
    changes.push({ path: t.path, action: existing === null ? "created" : "updated" });
    if (!opts.check) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, next);
    }
  }
  return changes;
}
