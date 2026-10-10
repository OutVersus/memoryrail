import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONTRAST, DEFAULT_MARGIN, DEFAULT_MIN_SIMILARITY, Embedder, cosine, fingerprint, isLocalUrl, type EmbeddingsConfig } from "./embeddings.js";
import { DIR_NAME, ensureIndexIgnored, type Store } from "./store.js";
import type { Memory, Semantic } from "./types.js";

const INDEX_DIR = "index";
const INDEX_FILE = "embeddings.json";
const MAX_TEXT_CHARS = 2000;

interface IndexFile {
  version: 1;
  fingerprint: string;
  entries: Record<string, { hash: string; vec: number[] }>;
}

export function indexPath(root: string): string {
  return path.join(root, DIR_NAME, INDEX_DIR, INDEX_FILE);
}

/** What gets embedded: the parts that carry meaning, capped so one huge memory can't blow a request. */
export function embeddingText(m: Memory): string {
  const parts = [`${m.type}: ${m.title}`, m.body, m.tags.length ? `tags: ${m.tags.join(", ")}` : "", m.links.length ? `files: ${m.links.join(", ")}` : ""];
  return parts.filter(Boolean).join("\n").slice(0, MAX_TEXT_CHARS);
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function loadIndex(root: string): IndexFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(root), "utf8")) as IndexFile;
    if (raw.version !== 1 || typeof raw.fingerprint !== "string" || typeof raw.entries !== "object" || raw.entries === null) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveIndex(root: string, index: IndexFile): void {
  const file = indexPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, file);
}

export interface IndexStatus {
  exists: boolean;
  /** Vectors came from the currently configured endpoint and model. */
  matchesConfig: boolean;
  total: number;
  indexed: number;
  /** Memories that are new or changed since they were embedded. */
  stale: number;
}

/** Offline: reads the cache and the memories, never the network. */
export function indexStatus(store: Store, cfg: EmbeddingsConfig): IndexStatus {
  const memories = store.list();
  const index = loadIndex(store.root);
  const matchesConfig = index?.fingerprint === fingerprint(cfg);
  let indexed = 0;
  let stale = 0;
  for (const m of memories) {
    const e = matchesConfig ? index?.entries[m.id] : undefined;
    if (e && e.hash === hashText(embeddingText(m))) indexed++;
    else stale++;
  }
  return { exists: index !== null, matchesConfig, total: memories.length, indexed, stale };
}

/** Embed only what is new or changed; drop vectors for deleted memories. */
export async function refreshIndex(
  store: Store,
  embedder: Embedder,
  opts: { rebuild?: boolean } = {},
): Promise<{ embedded: number; total: number }> {
  const memories = store.list();
  const fp = fingerprint(embedder.config);
  let index = opts.rebuild ? null : loadIndex(store.root);
  if (!index || index.fingerprint !== fp) index = { version: 1, fingerprint: fp, entries: {} };

  const live = new Set(memories.map((m) => m.id));
  let changed = false;
  for (const id of Object.keys(index.entries)) {
    if (!live.has(id)) {
      delete index.entries[id];
      changed = true;
    }
  }

  const todo = memories
    .map((m) => ({ id: m.id, text: embeddingText(m) }))
    .map((x) => ({ ...x, hash: hashText(x.text) }))
    .filter((x) => index!.entries[x.id]?.hash !== x.hash);

  if (todo.length) {
    const vectors = await embedder.embed(todo.map((x) => x.text));
    todo.forEach((x, i) => {
      index!.entries[x.id] = { hash: x.hash, vec: vectors[i]!.map((v) => Math.round(v * 1e5) / 1e5) };
    });
    changed = true;
  }
  if (changed || !fs.existsSync(indexPath(store.root))) {
    ensureIndexIgnored(store.root);
    saveIndex(store.root, index);
  }
  return { embedded: todo.length, total: memories.length };
}

export interface SemanticOptions {
  embedder?: Embedder;
  /** Called with a short reason when semantic search can't be used and we fall back to keywords. */
  warn?: (message: string) => void;
}

/**
 * Similarity of every memory to `query`, or null when semantic search is not
 * configured or not reachable. It never throws: search must keep working.
 */
export async function semanticScores(store: Store, query: string, opts: SemanticOptions = {}): Promise<Semantic | null> {
  const cfg = store.config().embeddings;
  if (!cfg || !query.trim()) return null;
  try {
    const embedder = opts.embedder ?? new Embedder(cfg);
    await refreshIndex(store, embedder);
    const [q] = await embedder.embed([query]);
    const index = loadIndex(store.root);
    if (!q || !index) return null;
    const scores = new Map<string, number>();
    for (const [id, e] of Object.entries(index.entries)) scores.set(id, cosine(q, e.vec));
    return { scores, minSimilarity: cfg.minSimilarity ?? DEFAULT_MIN_SIMILARITY, margin: DEFAULT_MARGIN, contrast: DEFAULT_CONTRAST };
  } catch (e) {
    opts.warn?.(`semantic search unavailable (${e instanceof Error ? e.message : String(e)}); using keyword search`);
    return null;
  }
}

export function describeEndpoint(cfg: EmbeddingsConfig): string {
  const host = new URL(cfg.baseUrl).host;
  return isLocalUrl(cfg.baseUrl) ? `${host} (local; memory text stays on this machine)` : `${host} (REMOTE; memory text is sent there)`;
}
