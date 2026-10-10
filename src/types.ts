export const MEMORY_TYPES = ["decision", "constraint", "gotcha", "attempt", "thread", "session"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Durable knowledge: what review mode gates and what precheck checks against. */
export const DURABLE_TYPES: readonly MemoryType[] = ["decision", "constraint", "gotcha", "attempt"];

export const STATUSES = ["active", "proposed", "superseded", "archived", "resolved"] as const;
export type Status = (typeof STATUSES)[number];

export interface Memory {
  id: string;
  type: MemoryType;
  title: string;
  status: Status;
  created: string;
  updated: string;
  tags: string[];
  /** Repo-relative paths this memory is about. Used for staleness checks. */
  links: string[];
  /** Pinned memories are always returned first by recall. */
  pinned: boolean;
  supersedes?: string;
  supersededBy?: string;
  body: string;
}

export interface NewMemory {
  type: MemoryType;
  title: string;
  body?: string;
  tags?: string[];
  links?: string[];
  pinned?: boolean;
  supersedes?: string;
  /** `proposed` waits for human approval and is invisible to recall and sync. Default `active`. */
  status?: "active" | "proposed";
  /** Skip the secret scan. For deliberate human use only; never exposed over MCP. */
  allowSecrets?: boolean;
}

export function isMemoryType(v: unknown): v is MemoryType {
  return typeof v === "string" && (MEMORY_TYPES as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** Semantic similarity of each memory to a query, supplied by the optional embeddings layer. */
export interface Semantic {
  /** Cosine similarity per memory id. */
  scores: Map<string, number>;
  minSimilarity: number;
  margin: number;
  /** The best match must beat the typical (median) memory by this much, or nothing matches. */
  contrast: number;
}
