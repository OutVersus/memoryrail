import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "./frontmatter.js";
import { REF_PATTERN, refOf } from "./refs.js";
import { SecretError, scanSecrets } from "./secrets.js";
import {
  isMemoryType,
  isStatus,
  type Memory,
  type NewMemory,
  type Status,
} from "./types.js";

export const DIR_NAME = ".memoryrail";
export const MEMORIES_DIR = "memories";
export const FORMAT_VERSION = 1;

export interface LoadError {
  file: string;
  message: string;
}

export interface Config {
  version: number;
  /**
   * `agents`: durable memories written over MCP start as `proposed` and need
   * `memoryrail approve`. `off`: they are active immediately (git review only).
   */
  review: "off" | "agents";
}

export function readConfig(root: string): Config {
  const file = path.join(root, DIR_NAME, "config.json");
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* fall through to defaults */
  }
  return {
    version: typeof raw["version"] === "number" ? raw["version"] : FORMAT_VERSION,
    review: raw["review"] === "agents" ? "agents" : "off",
  };
}

export function writeConfig(root: string, config: Config): void {
  fs.writeFileSync(path.join(root, DIR_NAME, "config.json"), JSON.stringify(config, null, 2) + "\n");
}

/** Walk up from `start` looking for a directory that contains `.memoryrail/`. */
export function findRoot(start: string = process.cwd()): string | null {
  const env = process.env["MEMORYRAIL_ROOT"];
  if (env) return fs.existsSync(path.join(env, DIR_NAME)) ? path.resolve(env) : null;
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, DIR_NAME, "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function initRoot(root: string): { created: boolean } {
  const base = path.join(root, DIR_NAME);
  const config = path.join(base, "config.json");
  fs.mkdirSync(path.join(base, MEMORIES_DIR), { recursive: true });
  if (fs.existsSync(config)) return { created: false };
  writeConfig(root, { version: FORMAT_VERSION, review: "off" });
  fs.writeFileSync(path.join(base, MEMORIES_DIR, ".gitkeep"), "");
  return { created: true };
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "memory"
  );
}

function stringList(v: unknown): string[] {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
}

function toMemory(data: Record<string, unknown>, body: string, fileId: string): Memory {
  const id = data["id"] === undefined ? fileId : String(data["id"]);
  if (id !== fileId) throw new Error(`id "${id}" does not match file name "${fileId}"`);
  if (!isMemoryType(data["type"])) throw new Error(`invalid or missing type: ${String(data["type"])}`);
  const status = data["status"] ?? "active";
  if (!isStatus(status)) throw new Error(`invalid status: ${String(status)}`);
  if (typeof data["title"] !== "string" || !data["title"].trim()) throw new Error("missing title");
  const created = String(data["created"] ?? "");
  const updated = String(data["updated"] ?? created);
  if (Number.isNaN(Date.parse(created))) throw new Error(`invalid created date: ${created}`);
  if (Number.isNaN(Date.parse(updated))) throw new Error(`invalid updated date: ${updated}`);
  const m: Memory = {
    id,
    type: data["type"],
    title: data["title"].trim(),
    status,
    created,
    updated,
    tags: stringList(data["tags"]),
    links: stringList(data["links"]),
    pinned: data["pinned"] === true,
    body,
  };
  if (data["supersedes"]) m.supersedes = String(data["supersedes"]);
  if (data["superseded_by"]) m.supersededBy = String(data["superseded_by"]);
  return m;
}

function serialize(m: Memory): string {
  return stringify(
    {
      id: m.id,
      type: m.type,
      title: m.title,
      status: m.status,
      created: m.created,
      updated: m.updated,
      tags: m.tags,
      links: m.links,
      pinned: m.pinned ? true : undefined,
      supersedes: m.supersedes,
      superseded_by: m.supersededBy,
    },
    m.body,
  );
}

export class Store {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  get dir(): string {
    return path.join(this.root, DIR_NAME, MEMORIES_DIR);
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.md`);
  }

  /** Load every memory, reporting files that fail validation instead of throwing. */
  loadAll(): { memories: Memory[]; errors: LoadError[] } {
    const memories: Memory[] = [];
    const errors: LoadError[] = [];
    if (!fs.existsSync(this.dir)) return { memories, errors };
    for (const name of fs.readdirSync(this.dir).sort()) {
      if (!name.endsWith(".md")) continue;
      const file = path.join(DIR_NAME, MEMORIES_DIR, name);
      try {
        const { data, body } = parse(fs.readFileSync(path.join(this.dir, name), "utf8"));
        memories.push(toMemory(data, body, name.slice(0, -3)));
      } catch (e) {
        errors.push({ file, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { memories, errors };
  }

  list(): Memory[] {
    return this.loadAll().memories;
  }

  get(id: string): Memory | undefined {
    if (!/^[\w.-]+$/.test(id)) return undefined;
    return this.list().find((m) => m.id === id);
  }

  config(): Config {
    return readConfig(this.root);
  }

  /** Resolve an exact id, a short ref like `DEC-a3f9`, or an unambiguous id prefix. */
  resolveId(idOrPrefix: string): Memory {
    const all = this.list();
    const exact = all.find((m) => m.id === idOrPrefix);
    if (exact) return exact;
    if (REF_PATTERN.test(idOrPrefix)) {
      const wanted = idOrPrefix.toUpperCase().slice(0, 3) + idOrPrefix.slice(3).toLowerCase();
      const byRef = all.filter((m) => refOf(m) === wanted);
      if (byRef.length === 1) return byRef[0]!;
      if (byRef.length > 1) throw new Error(`ref "${idOrPrefix}" is ambiguous: ${byRef.map((m) => m.id).join(", ")}`);
    }
    const matches = all.filter((m) => m.id.startsWith(idOrPrefix));
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) throw new Error(`no memory with id "${idOrPrefix}"`);
    throw new Error(`id prefix "${idOrPrefix}" is ambiguous: ${matches.map((m) => m.id).join(", ")}`);
  }

  add(input: NewMemory): Memory {
    const title = input.title.trim();
    if (!title) throw new Error("title is required");
    if (!input.allowSecrets) {
      const findings = scanSecrets(title, input.body, ...(input.tags ?? []), ...(input.links ?? []));
      if (findings.length) throw new SecretError(findings);
    }
    const prior = input.supersedes ? this.resolveId(input.supersedes) : undefined;
    const status = input.status ?? "active";

    const now = new Date().toISOString();
    const stamp = now.slice(0, 10).replace(/-/g, "");
    const base = `${stamp}-${slugify(title)}`;
    let id = base;
    for (let n = 2; fs.existsSync(this.file(id)); n++) id = `${base}-${n}`;

    const m: Memory = {
      id,
      type: input.type,
      title,
      status,
      created: now,
      updated: now,
      tags: dedupe(input.tags ?? []),
      links: dedupe((input.links ?? []).map(normalizeLink)),
      pinned: input.pinned ?? false,
      body: (input.body ?? "").trim(),
    };
    if (prior) m.supersedes = prior.id;
    this.write(m);
    // A proposal must not retire the old memory until a human approves it.
    if (prior && status === "active") this.write({ ...prior, status: "superseded", supersededBy: id, updated: now });
    return m;
  }

  /** Accept a proposed memory. Applies its supersession, if any. */
  approve(idOrRef: string): Memory {
    const m = this.resolveId(idOrRef);
    if (m.status !== "proposed") throw new Error(`${m.id} is ${m.status}, not proposed`);
    const now = new Date().toISOString();
    const active: Memory = { ...m, status: "active", updated: now };
    const prior = m.supersedes ? this.list().find((x) => x.id === m.supersedes) : undefined;
    this.write(active);
    if (prior && prior.status === "active") {
      this.write({ ...prior, status: "superseded", supersededBy: m.id, updated: now });
    }
    return active;
  }

  /** Discard a proposed memory. */
  reject(idOrRef: string): Memory {
    const m = this.resolveId(idOrRef);
    if (m.status !== "proposed") throw new Error(`${m.id} is ${m.status}, not proposed`);
    fs.rmSync(this.file(m.id));
    return m;
  }

  setStatus(idOrPrefix: string, status: Status): Memory {
    const m = this.resolveId(idOrPrefix);
    const next = { ...m, status, updated: new Date().toISOString() };
    this.write(next);
    return next;
  }

  /** Permanently delete a memory file. Prefer `setStatus(id, "archived")`. */
  remove(idOrPrefix: string): Memory {
    const m = this.resolveId(idOrPrefix);
    fs.rmSync(this.file(m.id));
    return m;
  }

  private write(m: Memory): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const target = this.file(m.id);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, serialize(m));
    fs.renameSync(tmp, target);
  }
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}

function normalizeLink(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function openStore(start?: string): Store {
  const root = findRoot(start);
  if (!root) {
    throw new Error("no .memoryrail/ found in this directory or any parent. Run `memoryrail init` first.");
  }
  return new Store(root);
}
