import { refOf } from "./refs.js";
import type { Memory, MemoryType, Semantic } from "./types.js";

const STOPWORDS = new Set(
  "a an and are as at be by for from has have how in is it its of on or that the this to was we what when where which with you your do does did not no can i".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface RecallOptions {
  query?: string;
  types?: MemoryType[];
  limit?: number;
  /** Approximate token budget for the rendered output. */
  budget?: number;
  includeInactive?: boolean;
  now?: Date;
  /** Optional semantic scores (see semantic.ts). Absent means keyword search only. */
  semantic?: Semantic;
}

export interface Hit {
  memory: Memory;
  score: number;
}

export interface RecallResult {
  hits: Hit[];
  rendered: string;
  truncated: boolean;
}

const K1 = 1.2;
const B = 0.75;

function termFreq(m: Memory): Map<string, number> {
  const tf = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + weight);
  };
  add(m.title, 3);
  add(m.tags.join(" "), 3);
  add(m.links.join(" "), 1);
  add(m.body, 1);
  return tf;
}

/** BM25 over title/tags/links/body, with a mild recency boost. */
export function rank(memories: Memory[], query: string, now: Date = new Date()): Hit[] {
  const qTerms = [...new Set(tokenize(query))];
  const docs = memories.map((m) => ({ m, tf: termFreq(m) }));
  const lens = docs.map((d) => [...d.tf.values()].reduce((a, b) => a + b, 0));
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length) || 1;
  const n = docs.length;

  return docs
    .map((d, i) => {
      let score = 0;
      for (const term of qTerms) {
        const f = d.tf.get(term) ?? 0;
        if (!f) continue;
        const df = docs.reduce((c, x) => c + (x.tf.has(term) ? 1 : 0), 0);
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * ((lens[i] ?? 0) / avg))));
      }
      const ageDays = Math.max(0, (now.getTime() - Date.parse(d.m.updated)) / 86_400_000);
      const recency = Math.exp(-ageDays / 90);
      return { memory: d.m, score: score * (1 + 0.25 * recency) + 0.001 * recency };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.memory.updated) - Date.parse(a.memory.updated));
}

/**
 * Memories that are semantically close to the query, best first.
 * A memory counts if it clears the absolute floor AND is within `margin` of
 * the best match, AND (with 3+ memories) the best match stands out from the
 * median by `contrast`. Together these stop a query with no real answer from
 * matching everything.
 * Similarity scales differ by model, so the floor is configurable.
 */
export function semanticCandidates(pool: Memory[], sem: Semantic): Memory[] {
  const scored = pool
    .map((m) => ({ m, s: sem.scores.get(m.id) }))
    .filter((x): x is { m: Memory; s: number } => x.s !== undefined)
    .sort((a, b) => b.s - a.s);
  const top = scored[0]?.s;
  if (top === undefined) return [];
  if (scored.length >= 3) {
    const median = scored[Math.floor(scored.length / 2)]!.s;
    if (top - median < sem.contrast) return [];
  }
  const cutoff = Math.max(sem.minSimilarity, top - sem.margin);
  return scored.filter((x) => x.s >= cutoff).map((x) => x.m);
}

const RRF_K = 60;

/** Reciprocal rank fusion: a memory ranked well by either list rises, and by both rises most. */
function fuse(lexical: Hit[], semantic: Memory[]): Hit[] {
  const byId = new Map<string, Hit>();
  const add = (m: Memory, rank: number) => {
    const prev = byId.get(m.id);
    byId.set(m.id, { memory: m, score: (prev?.score ?? 0) + 1 / (RRF_K + rank + 1) });
  };
  lexical.forEach((h, i) => add(h.memory, i));
  semantic.forEach((m, i) => add(m, i));
  return [...byId.values()].sort((a, b) => b.score - a.score || Date.parse(b.memory.updated) - Date.parse(a.memory.updated));
}

export function renderMemory(m: Memory): string {
  const head = `### [${refOf(m)}] ${m.title}`;
  const meta: string[] = [`${m.type}`, `id: ${m.id}`];
  if (m.tags.length) meta.push(`tags: ${m.tags.join(", ")}`);
  if (m.links.length) meta.push(`files: ${m.links.join(", ")}`);
  if (m.status !== "active") meta.push(`status: ${m.status}`);
  return [head, m.body, meta.length ? `_${meta.join(" · ")}_` : ""].filter(Boolean).join("\n");
}

export function recall(all: Memory[], opts: RecallOptions = {}): RecallResult {
  const limit = opts.limit ?? 8;
  const budget = opts.budget ?? 1500;
  const pool = all.filter(
    (m) =>
      (opts.includeInactive || m.status === "active") && (!opts.types?.length || opts.types.includes(m.type)),
  );

  const pinned = pool
    .filter((m) => m.pinned)
    .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
    .map((memory) => ({ memory, score: Number.POSITIVE_INFINITY }));
  const rest = pool.filter((m) => !m.pinned);
  const query = opts.query?.trim() ?? "";
  const lexical = query ? rank(rest, query, opts.now).filter((h) => h.score > 0.01) : rank(rest, "", opts.now);
  const ranked = query && opts.semantic ? fuse(lexical, semanticCandidates(rest, opts.semantic)) : lexical;

  const ordered = [...pinned, ...ranked];
  const hits: Hit[] = [];
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  for (const hit of ordered) {
    if (hits.length >= limit) {
      truncated = true;
      break;
    }
    const text = renderMemory(hit.memory);
    const cost = estimateTokens(text);
    // Always return at least one result, then respect the budget.
    if (hits.length > 0 && used + cost > budget) {
      truncated = true;
      break;
    }
    hits.push(hit);
    parts.push(text);
    used += cost;
  }
  return { hits, rendered: parts.join("\n\n"), truncated };
}
