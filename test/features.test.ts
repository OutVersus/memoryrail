import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store, initRoot, writeConfig } from "../src/store.js";
import { refOf } from "../src/refs.js";
import { scanSecrets, SecretError } from "../src/secrets.js";
import { precheck } from "../src/precheck.js";
import { installMcp, isInstalled } from "../src/install.js";
import { doctor } from "../src/doctor.js";
import { lint } from "../src/lint.js";
import { recall } from "../src/search.js";
import { sync } from "../src/sync.js";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoryrail-f-"));
  initRoot(dir);
  store = new Store(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("refs", () => {
  it("are stable, typed, and resolve case-insensitively", () => {
    const m = store.add({ type: "decision", title: "Use Postgres" });
    const ref = refOf(m);
    expect(ref).toMatch(/^DEC-[0-9a-f]{4}$/);
    expect(refOf(m)).toBe(ref);
    expect(store.resolveId(ref).id).toBe(m.id);
    expect(store.resolveId(ref.toLowerCase()).id).toBe(m.id);
  });

  it("prefix by type", () => {
    expect(refOf(store.add({ type: "attempt", title: "Tried SQLite" }))).toMatch(/^ATT-/);
    expect(refOf(store.add({ type: "gotcha", title: "A trap" }))).toMatch(/^GOT-/);
  });
});

describe("secrets", () => {
  const cases: Array<[string, string]> = [
    ["aws-access-key", "key is AKIAIOSFODNN7EXAMPLE ok"],
    ["github-token", "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"],
    ["private-key", "-----BEGIN RSA PRIVATE KEY-----"],
    ["url-credentials", "postgres://admin:hunter2pass@db.internal/app"],
    ["credential-assignment", 'password = "Tr0ub4dor3xyz"'],
    ["stripe-key", "sk_live_" + "A1b2C3d4E5f6G7h8I9j0"],
  ];
  it.each(cases)("detects %s", (rule, text) => {
    expect(scanSecrets(text).map((f) => f.rule)).toContain(rule);
  });

  it("does not flag ordinary prose about tokens and passwords", () => {
    expect(scanSecrets("Refresh tokens expire after a day; passwords are hashed with argon2.")).toEqual([]);
    expect(scanSecrets("token: refresh logic lives in auth.ts")).toEqual([]);
    expect(scanSecrets("Use postgres://localhost/app for local dev")).toEqual([]);
  });

  it("blocks writes without echoing the secret, and allows an explicit human override", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    let message = "";
    try {
      store.add({ type: "gotcha", title: "Deploy key", body: `use ${secret}` });
    } catch (e) {
      expect(e).toBeInstanceOf(SecretError);
      message = (e as Error).message;
    }
    expect(message).toContain("aws-access-key");
    expect(message).not.toContain(secret);
    expect(store.list()).toHaveLength(0);
    expect(store.add({ type: "gotcha", title: "Deploy key", body: `use ${secret}`, allowSecrets: true })).toBeTruthy();
  });

  it("lint reports secrets already in files", () => {
    store.add({ type: "gotcha", title: "Oops", body: "AKIAIOSFODNN7EXAMPLE", allowSecrets: true });
    expect(lint(store, { git: false }).some((i) => i.rule === "secret" && i.severity === "error")).toBe(true);
  });
});

describe("review gate", () => {
  it("proposed memories are invisible to recall and sync until approved", () => {
    const m = store.add({ type: "decision", title: "Adopt Kafka", body: "for events", status: "proposed" });
    expect(recall(store.list(), { query: "kafka" }).hits).toHaveLength(0);
    sync(store);
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).not.toContain("Adopt Kafka");

    store.approve(refOf(m));
    expect(recall(store.list(), { query: "kafka" }).hits).toHaveLength(1);
    sync(store);
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("Adopt Kafka");
  });

  it("a proposal does not retire the old memory until approved", () => {
    const old = store.add({ type: "decision", title: "Use Prisma" });
    const next = store.add({ type: "decision", title: "Use Drizzle", supersedes: old.id, status: "proposed" });
    expect(store.get(old.id)?.status).toBe("active");
    expect(lint(store, { git: false })).toEqual([]);
    store.approve(next.id);
    expect(store.get(old.id)).toMatchObject({ status: "superseded", supersededBy: next.id });
    expect(store.get(next.id)?.status).toBe("active");
  });

  it("reject deletes the proposal and leaves history alone", () => {
    const old = store.add({ type: "decision", title: "Use Prisma" });
    const next = store.add({ type: "decision", title: "Use Drizzle", supersedes: old.id, status: "proposed" });
    store.reject(next.id);
    expect(store.get(next.id)).toBeUndefined();
    expect(store.get(old.id)?.status).toBe("active");
  });

  it("only proposed memories can be approved or rejected", () => {
    const m = store.add({ type: "gotcha", title: "Already live" });
    expect(() => store.approve(m.id)).toThrow(/not proposed/);
    expect(() => store.reject(m.id)).toThrow(/not proposed/);
  });

  it("config defaults to off and persists", () => {
    expect(store.config().review).toBe("off");
    writeConfig(dir, { ...store.config(), review: "agents" });
    expect(new Store(dir).config().review).toBe("agents");
  });
});

describe("precheck", () => {
  beforeEach(() => {
    store.add({ type: "attempt", title: "Caching images locally violates the provider TOS", body: "Tried it, had to delete the cache.", links: ["src/images"] });
    store.add({ type: "gotcha", title: "Stripe webhooks need the raw body", links: ["src/webhooks.ts"] });
    store.add({ type: "constraint", title: "Never commit .env files", pinned: true });
    store.add({ type: "decision", title: "Use Drizzle for the database" });
    store.add({ type: "thread", title: "Unrelated migration work" });
  });

  it("warns from a plan alone", () => {
    const r = precheck(store.list(), { plan: "cache images on disk to speed up the gallery" });
    expect(r.warnings.map((w) => w.memory.title)).toContain("Caching images locally violates the provider TOS");
    expect(r.rendered).toMatch(/\[per REF\]/);
  });

  it("warns from files alone, including files inside a linked directory", () => {
    const r = precheck(store.list(), { files: ["src/images/resize.ts", "src/webhooks.ts"] });
    const titles = r.warnings.map((w) => w.memory.title);
    expect(titles).toContain("Caching images locally violates the provider TOS");
    expect(titles).toContain("Stripe webhooks need the raw body");
  });

  it("always includes pinned constraints and puts rules and failed attempts first", () => {
    const r = precheck(store.list(), { plan: "stripe webhook handler", files: ["src/webhooks.ts"] });
    expect(r.warnings[0]?.memory.type).toBe("constraint");
    expect(r.warnings.some((w) => w.memory.type === "gotcha")).toBe(true);
  });

  it("ignores threads, sessions and inactive memories", () => {
    const attempt = store.list().find((m) => m.type === "attempt")!;
    store.setStatus(attempt.id, "archived");
    const r = precheck(store.list(), { plan: "migration work cache images" });
    expect(r.warnings.every((w) => ["constraint", "decision", "gotcha"].includes(w.memory.type))).toBe(true);
  });

  it("says so when nothing applies", () => {
    const r = precheck(store.list().filter((m) => !m.pinned), { plan: "kubernetes autoscaling" });
    expect(r.warnings).toHaveLength(0);
    expect(r.rendered).toMatch(/No relevant/);
  });
});

describe("install", () => {
  it("creates config, then is idempotent", () => {
    expect(installMcp(dir, "claude").action).toBe("created");
    expect(installMcp(dir, "claude").action).toBe("unchanged");
    expect(isInstalled(dir, "claude")).toBe(true);
    expect(isInstalled(dir, "cursor")).toBe(false);
  });

  it("preserves other servers and settings", () => {
    const file = path.join(dir, ".mcp.json");
    fs.writeFileSync(file, JSON.stringify({ other: 1, mcpServers: { github: { command: "gh-mcp" } } }));
    expect(installMcp(dir, "claude", { npx: true }).action).toBe("updated");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(doc.other).toBe(1);
    expect(doc.mcpServers.github).toEqual({ command: "gh-mcp" });
    expect(doc.mcpServers.memoryrail.command).toBe("npx");
  });

  it("refuses to overwrite invalid JSON", () => {
    const file = path.join(dir, ".mcp.json");
    fs.writeFileSync(file, "{ not json");
    expect(() => installMcp(dir, "claude")).toThrow(/not valid JSON/);
    expect(fs.readFileSync(file, "utf8")).toBe("{ not json");
  });

  it("writes the cursor config in a nested folder", () => {
    installMcp(dir, "cursor");
    expect(fs.existsSync(path.join(dir, ".cursor", "mcp.json"))).toBe(true);
  });
});

describe("doctor", () => {
  it("flags missing agent wiring and pending proposals, and fails on secrets", () => {
    store.add({ type: "decision", title: "Pending one", status: "proposed" });
    let checks = doctor(store);
    expect(checks.find((c) => c.name === "agents")?.status).toBe("warn");
    expect(checks.find((c) => c.name === "review")?.status).toBe("warn");
    expect(checks.some((c) => c.status === "fail")).toBe(false);

    store.add({ type: "gotcha", title: "Leaky", body: "AKIAIOSFODNN7EXAMPLE", allowSecrets: true });
    checks = doctor(store);
    expect(checks.find((c) => c.name === "secrets")?.status).toBe("fail");
  });

  it("is green when wired, synced and clean", () => {
    store.add({ type: "decision", title: "All good" });
    installMcp(dir, "claude");
    sync(store);
    fs.mkdirSync(path.join(dir, ".git"));
    const checks = doctor(store);
    expect(checks.filter((c) => c.status !== "ok")).toEqual([]);
  });
});

describe("sync extra targets", () => {
  it("writes the managed block into an extra file and keeps the rest", () => {
    store.add({ type: "constraint", title: "Always run the tests" });
    const rel = ".github/copilot-instructions.md";
    fs.mkdirSync(path.join(dir, ".github"));
    fs.writeFileSync(path.join(dir, rel), "# Repo instructions\n\nBe concise.\n");
    sync(store, { targets: [{ path: rel }] });
    const text = fs.readFileSync(path.join(dir, rel), "utf8");
    expect(text.startsWith("# Repo instructions\n\nBe concise.")).toBe(true);
    expect(text).toContain("Always run the tests");
    expect(sync(store, { targets: [{ path: rel }] })[0]?.action).toBe("unchanged");
  });

  it("refuses to write outside the repository", () => {
    expect(() => sync(store, { targets: [{ path: "../escape.md" }] })).toThrow(/outside the repository/);
    expect(() => sync(store, { targets: [{ path: path.join(os.tmpdir(), "abs.md") }] })).toThrow(/outside the repository/);
    expect(fs.existsSync(path.join(dir, "..", "escape.md"))).toBe(false);
  });
});

describe("doctor AGENTS.md size", () => {
  it("warns when AGENTS.md is larger than Codex reads by default", () => {
    store.add({ type: "decision", title: "Small" });
    sync(store);
    expect(doctor(store).some((c) => c.name === "size")).toBe(false);
    fs.appendFileSync(path.join(dir, "AGENTS.md"), "x".repeat(33 * 1024));
    const warn = doctor(store).find((c) => c.name === "size");
    expect(warn?.status).toBe("warn");
    expect(warn?.detail).toMatch(/32 KiB/);
  });
});
