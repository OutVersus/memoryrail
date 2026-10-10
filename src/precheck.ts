import { refOf } from "./refs.js";
import { rank, semanticCandidates } from "./search.js";
import { DURABLE_TYPES, type Memory, type MemoryType, type Semantic } from "./types.js";

export interface Warning {
  memory: Memory;
  reasons: string[];
}

export interface PrecheckInput {
  /** What you are about to do, in plain words. */
  plan?: string;
  /** Repo-relative paths you are about to change. */
  files?: string[];
  limit?: number;
  now?: Date;
  /** Optional semantic scores for `plan`. Catches memories that mean the same thing in other words. */
  semantic?: Semantic;
}

export interface PrecheckResult {
  warnings: Warning[];
  rendered: string;
}

/** Most binding first: rules, then things that already failed, then traps, then choices. */
const ORDER: MemoryType[] = ["constraint", "attempt", "gotcha", "decision"];

function normalize(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function touching(m: Memory, files: string[]): string[] {
  const hits: string[] = [];
  for (const link of m.links.map(normalize)) {
    for (const f of files) if (f === link || f.startsWith(link + "/")) hits.push(f);
  }
  return [...new Set(hits)];
}

function condense(body: string, max = 240): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

/**
 * Before acting: which rules, failed attempts, gotchas and decisions bear on
 * this plan or these files? Surfaces what the project already learned so the
 * agent does not repeat a dead end or break a constraint.
 */
export function precheck(all: Memory[], input: PrecheckInput): PrecheckResult {
  const files = (input.files ?? []).map(normalize).filter(Boolean);
  const pool = all.filter((m) => m.status === "active" && DURABLE_TYPES.includes(m.type));
  const plan = input.plan?.trim() ?? "";
  const scores = new Map<string, number>();
  if (plan) for (const h of rank(pool, plan, input.now)) if (h.score > 0.01) scores.set(h.memory.id, h.score);
  const similar = new Set<string>();
  if (plan && input.semantic) for (const m of semanticCandidates(pool, input.semantic)) similar.add(m.id);

  const warnings: Warning[] = [];
  for (const m of pool) {
    const reasons: string[] = [];
    if (m.pinned && m.type === "constraint") reasons.push("pinned rule");
    const hits = touching(m, files);
    if (hits.length) reasons.push(`about ${hits.join(", ")}`);
    if (scores.has(m.id)) reasons.push("matches your plan");
    else if (similar.has(m.id)) reasons.push("similar in meaning to your plan");
    if (reasons.length) warnings.push({ memory: m, reasons });
  }

  const weight = (w: Warning) =>
    ORDER.indexOf(w.memory.type) * 10 -
    (touching(w.memory, files).length ? 5 : 0) -
    (scores.get(w.memory.id) ?? 0) / 100 -
    (input.semantic?.scores.get(w.memory.id) ?? 0) / 1000;
  warnings.sort((a, b) => weight(a) - weight(b) || a.memory.id.localeCompare(b.memory.id));
  const shown = warnings.slice(0, input.limit ?? 12);

  if (!shown.length) {
    return { warnings: [], rendered: "No relevant constraints, failed attempts, gotchas or decisions found for this plan." };
  }
  const lines = [
    "Check these before you proceed. Cite what you rely on as [per REF]. If your plan conflicts with a constraint or decision, stop and ask.",
    "",
    ...shown.map((w) => {
      const body = condense(w.memory.body);
      return `- [${refOf(w.memory)}] (${w.memory.type}) ${w.memory.title} — ${w.reasons.join("; ")}${body ? `\n    ${body}` : ""}`;
    }),
  ];
  if (warnings.length > shown.length) lines.push("", `(${warnings.length - shown.length} more; narrow the plan or files)`);
  return { warnings: shown, rendered: lines.join("\n") };
}
