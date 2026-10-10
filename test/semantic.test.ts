import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Embedder, assertUsable, isLocalUrl, parseEmbeddingsConfig } from "../src/embeddings.js";
import { runEmbeddings } from "../src/embeddings-cmd.js";
import { doctor } from "../src/doctor.js";
import { precheck } from "../src/precheck.js";
import { recall, semanticCandidates } from "../src/search.js";
import { indexPath, indexStatus, refreshIndex, semanticScores } from "../src/semantic.js";
import { Store, initRoot, writeConfig } from "../src/store.js";

/**
 * A fake OpenAI-compatible /embeddings server. Words are grouped into concepts, so
 * "database" and "Postgres" land close together without sharing a single word.
 */
const CONCEPTS: string[][] = [
  ["database", "postgres", "sql", "orm", "drizzle", "prisma", "mysql", "storage"],
  ["env", "secret", "credential", "password", "token", "key", "keys"],
  ["image", "images", "picture", "pictures", "photo", "photos", "cache", "caching", "disk"],
  ["kubernetes", "cluster", "pods", "autoscaling"],
];

function vectorFor(text: string): number[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  return CONCEPTS.map((group) => 0.05 + words.filter((w) => group.includes(w)).length);
}

interface Seen {
  inputs: string[][];
  auth: Array<string | undefined>;
  bodies: Array<Record<string, unknown>>;
}

let server: http.Server;
let baseUrl: string;
const seen: Seen = { inputs: [], auth: [], bodies: [] };
let mode: "ok" | "reversed" | "short" | "500" | "hang" = "ok";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (mode === "hang") return;
      const body = JSON.parse(raw) as { input: string[] };
      seen.inputs.push(body.input);
      seen.bodies.push(body as Record<string, unknown>);
      seen.auth.push(req.headers["authorization"] as string | undefined);
      if (mode === "500") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("model exploded");
        return;
      }
      let data = body.input.map((t, index) => ({ object: "embedding", index, embedding: vectorFor(t) }));
      if (mode === "reversed") data = [...data].reverse();
      if (mode === "short") data = data.slice(1);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data, model: "mock" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let dir: string;
let store: Store;

beforeEach(() => {
  mode = "ok";
  seen.inputs = [];
  seen.auth = [];
  seen.bodies = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoryrail-s-"));
  initRoot(dir);
  store = new Store(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const enable = (extra: Record<string, unknown> = {}) =>
  writeConfig(dir, { ...store.config(), embeddings: { baseUrl, model: "mock", ...extra } as never });

const requests = () => seen.inputs.length;

describe("isLocalUrl and config safety", () => {
  it.each([
    ["http://localhost:11434/v1", true],
    ["http://127.0.0.1:8080/v1", true],
    ["http://[::1]:11434/v1", true],
    ["http://app.localhost/v1", true],
    ["https://api.openai.com/v1", false],
    ["http://192.168.1.20:11434/v1", false],
    ["http://localhost.evil.com/v1", false],
    ["not a url", false],
  ])("%s -> local=%s", (url, local) => expect(isLocalUrl(url)).toBe(local));

  it("refuses remote endpoints unless explicitly allowed", () => {
    expect(() => assertUsable({ baseUrl: "https://api.openai.com/v1", model: "m" })).toThrow(/not a local address/);
    expect(() => assertUsable({ baseUrl: "https://api.openai.com/v1", model: "m", allowRemote: true })).not.toThrow();
  });

  it("refuses non-http schemes and credentials in the URL", () => {
    expect(() => assertUsable({ baseUrl: "file:///etc/passwd", model: "m" })).toThrow(/http or https/);
    expect(() => assertUsable({ baseUrl: "http://user:pw@localhost/v1", model: "m" })).toThrow(/credentials/);
  });

  it("treats malformed config as not configured", () => {
    expect(parseEmbeddingsConfig(undefined)).toBeUndefined();
    expect(parseEmbeddingsConfig({ baseUrl: "http://localhost/v1" })).toBeUndefined();
    expect(parseEmbeddingsConfig({ baseUrl: "http://localhost/v1", model: "m", dimensions: -1 })).toEqual({ baseUrl: "http://localhost/v1", model: "m" });
  });
});

describe("Embedder", () => {
  it("posts model and input, and returns unit vectors", async () => {
    const [v] = await new Embedder({ baseUrl, model: "mock" }).embed(["database"]);
    expect(seen.bodies[0]).toMatchObject({ model: "mock", input: ["database"] });
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
  });

  it("restores input order when the server returns results out of order", async () => {
    mode = "reversed";
    const [a, b] = await new Embedder({ baseUrl, model: "mock" }).embed(["database", "cache images"]);
    expect(a![0]!).toBeGreaterThan(a![2]!); // database text is mostly the database dimension
    expect(b![2]!).toBeGreaterThan(b![0]!); // image text is mostly the image dimension
  });

  it("splits large inputs into batches", async () => {
    const texts = Array.from({ length: 70 }, (_, i) => `memory ${i}`);
    const out = await new Embedder({ baseUrl, model: "mock" }).embed(texts);
    expect(out).toHaveLength(70);
    expect(seen.inputs.map((b) => b.length)).toEqual([32, 32, 6]);
  });

  it("sends the key from the named environment variable, and never in errors", async () => {
    const env = { MY_KEY: "sk-test-secret-value-123" } as NodeJS.ProcessEnv;
    await new Embedder({ baseUrl, model: "mock", apiKeyEnv: "MY_KEY" }, { env }).embed(["x"]);
    expect(seen.auth[0]).toBe("Bearer sk-test-secret-value-123");

    mode = "500";
    const err = await new Embedder({ baseUrl, model: "mock", apiKeyEnv: "MY_KEY" }, { env }).embed(["x"]).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/500/);
    expect((err as Error).message).not.toContain("sk-test-secret-value-123");
  });

  it("explains a missing API key variable", async () => {
    await expect(new Embedder({ baseUrl, model: "mock", apiKeyEnv: "NOPE_KEY" }, { env: {} }).embed(["x"])).rejects.toThrow(/NOPE_KEY is not set/);
  });

  it("rejects a response with the wrong number of vectors", async () => {
    mode = "short";
    await expect(new Embedder({ baseUrl, model: "mock" }).embed(["a", "b"])).rejects.toThrow(/1 vectors for 2 inputs/);
  });

  it("times out instead of hanging", async () => {
    mode = "hang";
    await expect(new Embedder({ baseUrl, model: "mock" }, { timeoutMs: 100 }).embed(["x"])).rejects.toThrow(/timed out/);
  });
});

describe("index", () => {
  beforeEach(() => {
    store.add({ type: "decision", title: "Use Postgres for storage" });
    store.add({ type: "constraint", title: "Never commit .env files" });
    enable();
  });

  it("embeds everything once, then only what changed", async () => {
    const embedder = new Embedder(store.config().embeddings!);
    expect((await refreshIndex(store, embedder)).embedded).toBe(2);
    const first = requests();
    expect((await refreshIndex(store, embedder)).embedded).toBe(0);
    expect(requests()).toBe(first); // nothing sent when nothing changed

    store.add({ type: "gotcha", title: "Image cache must be purged" });
    expect((await refreshIndex(store, embedder)).embedded).toBe(1);
    expect(seen.inputs.at(-1)).toHaveLength(1);
  });

  it("re-embeds an edited memory and forgets a deleted one", async () => {
    const embedder = new Embedder(store.config().embeddings!);
    await refreshIndex(store, embedder);
    const m = store.list().find((x) => x.type === "decision")!;
    store.setStatus(m.id, "archived"); // changes `updated` only, text unchanged => same hash
    expect((await refreshIndex(store, embedder)).embedded).toBe(0);

    const c = store.list().find((x) => x.type === "constraint")!;
    store.remove(c.id);
    await refreshIndex(store, embedder);
    const saved = JSON.parse(fs.readFileSync(indexPath(dir), "utf8"));
    expect(Object.keys(saved.entries)).toEqual([m.id]);
  });

  it("rebuilds when the model changes, so vectors from different models are never mixed", async () => {
    await refreshIndex(store, new Embedder(store.config().embeddings!));
    writeConfig(dir, { ...store.config(), embeddings: { baseUrl, model: "other-model" } });
    const status = indexStatus(store, store.config().embeddings!);
    expect(status.matchesConfig).toBe(false);
    expect((await refreshIndex(store, new Embedder(store.config().embeddings!))).embedded).toBe(2);
  });

  it("keeps the cache out of git", async () => {
    await refreshIndex(store, new Embedder(store.config().embeddings!));
    const ignore = fs.readFileSync(path.join(dir, ".memoryrail", ".gitignore"), "utf8");
    expect(ignore.split("\n").filter((l) => l.trim() === "index/")).toHaveLength(1);
    await refreshIndex(store, new Embedder(store.config().embeddings!), { rebuild: true });
    expect(fs.readFileSync(path.join(dir, ".memoryrail", ".gitignore"), "utf8").split("\n").filter((l) => l.trim() === "index/")).toHaveLength(1);
  });

  it("reports staleness without touching the network", () => {
    const before = requests();
    const s = indexStatus(store, store.config().embeddings!);
    expect(s).toMatchObject({ exists: false, total: 2, indexed: 0, stale: 2 });
    expect(requests()).toBe(before);
  });
});

describe("semantic recall", () => {
  beforeEach(() => {
    store.add({ type: "decision", title: "Use Postgres for storage", body: "Relational data." });
    store.add({ type: "constraint", title: "Never commit .env files", body: "Secrets live in the vault." });
    store.add({ type: "gotcha", title: "Kubernetes pods restart", body: "Autoscaling resets state." });
    enable({ minSimilarity: 0.5 });
  });

  it("finds a memory that shares no words with the query", async () => {
    const lexical = recall(store.list(), { query: "database" });
    expect(lexical.hits).toHaveLength(0); // keyword search cannot do this

    const semantic = await semanticScores(store, "database");
    expect(semantic).not.toBeNull();
    const r = recall(store.list(), { query: "database", semantic: semantic! });
    expect(r.hits[0]?.memory.title).toBe("Use Postgres for storage");
  });

  it("does not match unrelated memories", async () => {
    const semantic = await semanticScores(store, "database");
    const titles = semanticCandidates(store.list(), semantic!).map((m) => m.title);
    expect(titles).toEqual(["Use Postgres for storage"]);
  });

  it("returns nothing when the query matches nothing, instead of the nearest memory", async () => {
    const semantic = await semanticScores(store, "invoicing");
    expect(semanticCandidates(store.list(), semantic!)).toEqual([]);
  });

  it("keeps keyword matches and pinned memories working alongside", async () => {
    store.add({ type: "constraint", title: "Always run the tests", pinned: true });
    const semantic = await semanticScores(store, "database");
    const r = recall(store.list(), { query: "database", semantic: semantic! });
    expect(r.hits[0]?.memory.pinned).toBe(true);
    expect(r.hits.map((h) => h.memory.title)).toContain("Use Postgres for storage");
  });

  it("falls back to keyword search, with a warning, when the endpoint is down", async () => {
    await semanticScores(store, "warm the index");
    writeConfig(dir, { ...store.config(), embeddings: { baseUrl: "http://127.0.0.1:1/v1", model: "mock" } });
    const warn = vi.fn();
    const result = await semanticScores(store, "database", { warn });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/semantic search unavailable.*keyword search/);
    // recall still works, lexically
    expect(recall(store.list(), { query: "postgres" }).hits).toHaveLength(1);
  });

  it("is a no-op when not configured", async () => {
    writeConfig(dir, { version: 1, review: "off" });
    expect(await semanticScores(store, "database")).toBeNull();
    expect(requests()).toBe(0);
  });
});

describe("semantic precheck", () => {
  it("warns about a failed attempt described in different words", async () => {
    store.add({ type: "attempt", title: "Caching images on disk violated the provider terms", body: "Purged it." });
    store.add({ type: "decision", title: "Use Postgres for storage" });
    enable();
    const plan = "keep pictures locally";
    expect(precheck(store.list(), { plan }).warnings).toHaveLength(0); // keywords alone miss it
    const semantic = await semanticScores(store, plan);
    const r = precheck(store.list(), { plan, semantic: semantic! });
    expect(r.warnings.map((w) => w.memory.type)).toEqual(["attempt"]);
    expect(r.warnings[0]!.reasons).toContain("similar in meaning to your plan");
  });
});

describe("doctor", () => {
  it("reports keyword-only, local, remote and mismatched states", async () => {
    const find = () => doctor(store).find((c) => c.name === "search")!;
    expect(find()).toMatchObject({ status: "ok", detail: expect.stringMatching(/keyword search only/) });

    store.add({ type: "decision", title: "Use Postgres" });
    enable();
    await refreshIndex(store, new Embedder(store.config().embeddings!));
    expect(find()).toMatchObject({ status: "ok", detail: expect.stringMatching(/1\/1 memories indexed/) });

    writeConfig(dir, { ...store.config(), embeddings: { baseUrl, model: "different" } });
    expect(find().status).toBe("warn");

    writeConfig(dir, { ...store.config(), embeddings: { baseUrl: "https://api.example.com/v1", model: "m", allowRemote: true } });
    expect(find()).toMatchObject({ status: "warn", detail: expect.stringMatching(/api\.example\.com.*not a local address/) });
  });
});

describe("embeddings command", () => {
  let written = "";
  beforeEach(() => {
    written = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
      written += String(s);
      return true;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("setup connects, saves the config, builds the index, and off removes both", async () => {
    store.add({ type: "decision", title: "Use Postgres for storage" });
    expect(await runEmbeddings(["setup", "--url", baseUrl, "--model", "mock"], store)).toBe(0);
    expect(written).toMatch(/Connected: 127\.0\.0\.1:\d+ \(local/);
    expect(store.config().embeddings).toMatchObject({ baseUrl, model: "mock" });
    expect(fs.existsSync(indexPath(dir))).toBe(true);

    written = "";
    await runEmbeddings(["status"], store);
    expect(written).toMatch(/1\/1 memories up to date/);

    await runEmbeddings(["off"], store);
    expect(store.config().embeddings).toBeUndefined();
    expect(fs.existsSync(indexPath(dir))).toBe(false);
  });

  it("setup refuses a remote URL before sending anything", async () => {
    const before = requests();
    await expect(runEmbeddings(["setup", "--url", "https://api.openai.com/v1", "--model", "m"], store)).rejects.toThrow(/not a local address/);
    expect(store.config().embeddings).toBeUndefined();
    expect(requests()).toBe(before);
  });

  it("setup does not save a config for an endpoint that doesn't work", async () => {
    mode = "500";
    await expect(runEmbeddings(["setup", "--url", baseUrl, "--model", "mock"], store)).rejects.toThrow(/500/);
    expect(store.config().embeddings).toBeUndefined();
  });

  it("explain lists scores and which memories match", async () => {
    store.add({ type: "decision", title: "Use Postgres for storage" });
    store.add({ type: "constraint", title: "Never commit .env files" });
    enable();
    expect(await runEmbeddings(["explain", "database"], store)).toBe(0);
    expect(written).toMatch(/match\s+.*Use Postgres for storage/);
    expect(written).toMatch(/Never commit \.env files/);
  });
});
