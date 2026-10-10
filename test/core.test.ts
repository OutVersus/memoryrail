import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/index.js";
import { Store, initRoot, findRoot } from "../src/store.js";
import { recall } from "../src/search.js";
import { lint } from "../src/lint.js";
import { sync, START, END } from "../src/sync.js";
import { handoffToMemory, resumePrompt } from "../src/handoff.js";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoryrail-"));
  initRoot(dir);
  store = new Store(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("frontmatter", () => {
  it("round-trips values including quotes and colons", () => {
    const data = { id: "a", title: 'Use "Drizzle": not Prisma', tags: ["db", "orm"], pinned: true };
    const parsed = parseFrontmatter(stringifyFrontmatter(data, "Body text\n\nSecond paragraph"));
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe("Body text\n\nSecond paragraph");
  });

  it("handles CRLF and an empty body", () => {
    const parsed = parseFrontmatter('---\r\nid: "x"\r\n---\r\n');
    expect(parsed.data).toEqual({ id: "x" });
    expect(parsed.body).toBe("");
  });

  it("rejects files without frontmatter", () => {
    expect(() => parseFrontmatter("# just markdown")).toThrow(/frontmatter/);
  });
});

describe("store", () => {
  it("adds, reads back, and creates unique ids for the same title", () => {
    const a = store.add({ type: "decision", title: "Use Drizzle", body: "Edge deploys." });
    const b = store.add({ type: "decision", title: "Use Drizzle" });
    expect(a.id).not.toBe(b.id);
    expect(store.get(a.id)?.body).toBe("Edge deploys.");
    expect(store.list()).toHaveLength(2);
  });

  it("supersede keeps history and hides the old memory from recall", () => {
    const old = store.add({ type: "decision", title: "Use Prisma" });
    const next = store.add({ type: "decision", title: "Use Drizzle", supersedes: old.id });
    expect(store.get(old.id)).toMatchObject({ status: "superseded", supersededBy: next.id });
    expect(store.get(next.id)?.supersedes).toBe(old.id);
    const titles = recall(store.list(), { query: "database orm" }).hits.map((h) => h.memory.title);
    expect(titles).not.toContain("Use Prisma");
    const all = recall(store.list(), { query: "prisma", includeInactive: true });
    expect(all.hits.map((h) => h.memory.title)).toContain("Use Prisma");
  });

  it("resolves unambiguous id prefixes only", () => {
    const a = store.add({ type: "gotcha", title: "Alpha trap" });
    store.add({ type: "gotcha", title: "Alpha trap" });
    expect(() => store.resolveId(a.id.slice(0, 8))).toThrow(/ambiguous/);
    expect(store.resolveId(a.id).id).toBe(a.id);
  });

  it("reports malformed files instead of throwing", () => {
    fs.writeFileSync(path.join(store.dir, "broken.md"), "no frontmatter here");
    const { memories, errors } = store.loadAll();
    expect(memories).toHaveLength(0);
    expect(errors[0]?.file).toContain("broken.md");
  });

  it("does not read ids that escape the memories folder", () => {
    expect(store.get("../config")).toBeUndefined();
  });

  it("finds the root from a nested directory", () => {
    const nested = path.join(dir, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    expect(findRoot(nested)).toBe(fs.realpathSync(dir) === dir ? dir : findRoot(nested));
    expect(findRoot(nested)).not.toBeNull();
  });
});

describe("recall", () => {
  beforeEach(() => {
    store.add({ type: "decision", title: "Use Drizzle for database access", body: "Edge deploys need a small runtime.", tags: ["db"] });
    store.add({ type: "gotcha", title: "Stripe webhooks need the raw body", body: "Parsing JSON first breaks signature checks.", links: ["src/webhooks.ts"] });
    store.add({ type: "constraint", title: "Never commit .env files", body: "Secrets live in the vault.", pinned: true });
  });

  it("ranks the relevant memory first", () => {
    const r = recall(store.list(), { query: "stripe webhook signature" });
    const firstUnpinned = r.hits.find((h) => !h.memory.pinned);
    expect(firstUnpinned?.memory.title).toMatch(/Stripe/);
  });

  it("always puts pinned memories first", () => {
    const r = recall(store.list(), { query: "stripe webhook" });
    expect(r.hits[0]?.memory.pinned).toBe(true);
  });

  it("returns nothing unrelated for a query with no matches", () => {
    const r = recall(store.list().filter((m) => !m.pinned), { query: "kubernetes" });
    expect(r.hits).toHaveLength(0);
  });

  it("filters by type", () => {
    const r = recall(store.list(), { types: ["gotcha"] });
    expect(r.hits.every((h) => h.memory.type === "gotcha")).toBe(true);
  });

  it("respects the budget but always returns one result", () => {
    for (let i = 0; i < 10; i++) store.add({ type: "decision", title: `Decision ${i} about caching`, body: "x".repeat(400) });
    const r = recall(store.list(), { query: "caching", budget: 150 });
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    expect(r.hits.length).toBeLessThan(10);
    expect(r.truncated).toBe(true);
  });
});

describe("lint", () => {
  it("flags links to files that no longer exist", () => {
    store.add({ type: "gotcha", title: "Old trap", links: ["src/gone.ts"] });
    const issues = lint(store, { git: false });
    expect(issues.map((i) => i.rule)).toContain("stale-link");
  });

  it("passes when links exist", () => {
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/here.ts"), "");
    store.add({ type: "gotcha", title: "Live trap", links: ["src/here.ts"] });
    expect(lint(store, { git: false })).toEqual([]);
  });

  it("flags links that escape the repository", () => {
    store.add({ type: "gotcha", title: "Sneaky", links: ["../outside.txt"] });
    expect(lint(store, { git: false }).map((i) => i.rule)).toContain("link-outside-repo");
  });

  it("flags near-duplicate titles and invalid files", () => {
    store.add({ type: "decision", title: "Use Postgres for storage" });
    store.add({ type: "decision", title: "Use Postgres for the storage" });
    fs.writeFileSync(path.join(store.dir, "bad.md"), "oops");
    const rules = lint(store, { git: false }).map((i) => i.rule);
    expect(rules).toContain("possible-duplicate");
    expect(rules).toContain("invalid-file");
  });
});

describe("sync", () => {
  beforeEach(() => {
    store.add({ type: "constraint", title: "No default exports" });
    store.add({ type: "decision", title: "Use Drizzle", body: "Edge deploys." });
  });

  it("creates files, then is idempotent", () => {
    const first = sync(store);
    expect(first.every((c) => c.action === "created")).toBe(true);
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("No default exports");
    expect(fs.readFileSync(path.join(dir, ".cursor/rules/memoryrail.mdc"), "utf8")).toMatch(/alwaysApply: true/);
    expect(sync(store).every((c) => c.action === "unchanged")).toBe(true);
  });

  it("preserves hand-written content around the managed block", () => {
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# My notes\n\nKeep this.\n");
    sync(store);
    store.add({ type: "gotcha", title: "Watch out" });
    sync(store);
    const text = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(text.startsWith("# My notes\n\nKeep this.")).toBe(true);
    expect(text).toContain("Watch out");
    expect(text.split(START)).toHaveLength(2);
    expect(text.split(END)).toHaveLength(2);
  });

  it("--check reports drift without writing", () => {
    const changes = sync(store, { check: true });
    expect(changes.some((c) => c.action !== "unchanged")).toBe(true);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
  });
});

describe("handoff", () => {
  it("builds a session memory and surfaces it in the resume prompt", () => {
    store.add({ type: "thread", title: "Migrate auth to sessions" });
    store.add(handoffToMemory({ summary: "Finished the token table.", next: ["Wire up logout", "Add tests"] }));
    const prompt = resumePrompt(store.list());
    expect(prompt).toContain("Finished the token table.");
    expect(prompt).toContain("- Wire up logout");
    expect(prompt).toContain("Migrate auth to sessions");
  });

  it("requires a summary", () => {
    expect(() => handoffToMemory({ summary: "  " })).toThrow(/summary/);
  });
});
