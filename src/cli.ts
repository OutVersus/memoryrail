#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { doctor } from "./doctor.js";
import { stagedFiles } from "./git.js";
import { handoffToMemory, resumePrompt } from "./handoff.js";
import { CLIENT_FILES, installMcp, type Client } from "./install.js";
import { lint } from "./lint.js";
import { precheck } from "./precheck.js";
import { refOf } from "./refs.js";
import { recall, renderMemory } from "./search.js";
import { Store, DIR_NAME, initRoot, openStore, writeConfig } from "./store.js";
import { sync } from "./sync.js";
import { isMemoryType, MEMORY_TYPES, type Memory, type MemoryType } from "./types.js";

const VERSION = "0.1.0";

const HELP = `memoryrail ${VERSION} — git-native project memory for coding agents

Usage: memoryrail <command> [options]

Commands:
  init                         Create .memoryrail/ in the current directory
  remember <title>             Record a memory
      --type <t>                 ${MEMORY_TYPES.join(" | ")} (default: decision)
      --body <text>              Details (or --stdin to read from stdin)
      --tag <t>                  Repeatable
      --link <path>              Repo file this is about (repeatable); enables staleness checks
      --pin                      Always include in recall and sync
      --supersedes <id>          Replace an earlier memory, keeping its history
      --propose                  Save as proposed; takes effect after \`approve\`
      --allow-secrets            Skip the secret scan (humans only)
  precheck [plan]              Before acting: which rules, failed attempts and gotchas apply?
      --file <path>              Repeatable   --staged (use files staged in git)
      --fail                     Exit 3 if anything relevant is found (for git hooks)   --json
  recall [query]               Search memories, ranked and token-budgeted
      --type <t>                 Repeatable filter
      --limit <n>   --budget <tokens>   --all (include superseded/archived)   --json
  list                         List memories (--type, --all, --json)
  show <id>                    Print one memory (id, prefix, or ref like DEC-a3f9)
  review                       Show memories waiting for approval
  approve <id>... | --all      Accept proposed memories
  reject <id>...               Discard proposed memories
  config [review [off|agents]] Show or set the review gate for agent-written memories
  resolve <id>                 Mark a thread resolved
  forget <id>                  Archive a memory (--delete to remove the file)
  handoff                      Record an end-of-session summary
      --summary <text>  (or --stdin)   --title <t>   --next <step> (repeatable)   --link <path>
  resume                       Print a prompt that brings a fresh agent up to speed
  sync                         Write AGENTS.md, CLAUDE.md and .cursor/rules from memory
      --check                    Exit 1 if generated files are out of date (for CI)
  lint                         Find stale links, duplicates, and broken files
      --strict                   Treat warnings as errors   --no-git   --json
  doctor                       Health check: valid, safe, synced, and reachable by agents
  install <claude|cursor|all>  Register the MCP server in the repo's client config (--npx)
  serve                      Run the MCP server over stdio

Run from anywhere inside a repo; the nearest .memoryrail/ is used.
Docs: https://memoryrail.si`;

class UsageError extends Error {}

function readStdin(): string {
  return fs.readFileSync(0, "utf8");
}

function parseTypes(values: string[] | undefined): MemoryType[] | undefined {
  if (!values?.length) return undefined;
  return values.map((v) => {
    if (!isMemoryType(v)) throw new UsageError(`unknown type "${v}". Use one of: ${MEMORY_TYPES.join(", ")}`);
    return v;
  });
}

function toInt(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${name} must be a positive integer`);
  return n;
}

function out(s: string): void {
  process.stdout.write(s.endsWith("\n") ? s : s + "\n");
}

function line(m: Memory): string {
  const status = m.status === "active" ? "" : ` [${m.status}]`;
  return `${refOf(m).padEnd(8)} ${m.type.padEnd(10)} ${m.title}${status}`;
}

async function run(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    out(HELP);
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    out(VERSION);
    return 0;
  }

  const parse = <T extends Record<string, { type: "string" | "boolean"; multiple?: boolean }>>(options: T) =>
    parseArgs({ args: rest, options, allowPositionals: true, strict: true });

  switch (cmd) {
    case "init": {
      const { created } = initRoot(process.cwd());
      out(created ? `Created ${DIR_NAME}/ — try: memoryrail remember "Use X over Y" --type decision` : `${DIR_NAME}/ already exists`);
      return 0;
    }

    case "remember": {
      const { values, positionals } = parse({
        type: { type: "string" },
        body: { type: "string" },
        stdin: { type: "boolean" },
        tag: { type: "string", multiple: true },
        link: { type: "string", multiple: true },
        pin: { type: "boolean" },
        supersedes: { type: "string" },
        propose: { type: "boolean" },
        "allow-secrets": { type: "boolean" },
      });
      const title = positionals.join(" ").trim();
      if (!title) throw new UsageError('usage: memoryrail remember "<title>" [--type decision] [--body ...]');
      const type = parseTypes([values.type ?? "decision"])![0]!;
      const body = values.stdin ? readStdin() : values.body;
      const m = openStore().add({
        type,
        title,
        body,
        tags: values.tag,
        links: values.link,
        pinned: values.pin,
        supersedes: values.supersedes,
        status: values.propose ? "proposed" : "active",
        allowSecrets: values["allow-secrets"],
      });
      out(
        m.status === "proposed"
          ? `Proposed ${m.type} ${refOf(m)}: ${m.id}\nIt takes effect after \`memoryrail approve ${refOf(m)}\`.`
          : `Saved ${m.type} ${refOf(m)}: ${m.id}`,
      );
      return 0;
    }

    case "precheck": {
      const { values, positionals } = parse({
        file: { type: "string", multiple: true },
        staged: { type: "boolean" },
        fail: { type: "boolean" },
        json: { type: "boolean" },
      });
      const store = openStore();
      const files = [...(values.file ?? []), ...(values.staged ? stagedFiles(store.root) : [])];
      const plan = positionals.join(" ");
      if (!plan.trim() && !files.length) {
        throw new UsageError('usage: memoryrail precheck "<what you plan to do>" [--file <path>]... | --staged');
      }
      const result = precheck(store.list(), { plan, files });
      out(values.json ? JSON.stringify(result.warnings.map((w) => ({ ref: refOf(w.memory), reasons: w.reasons, memory: w.memory })), null, 2) : result.rendered);
      // Pinned rules are always listed; they alone must not fail a hook, or every commit would be blocked.
      const specific = result.warnings.some((w) => w.reasons.some((r) => r !== "pinned rule"));
      return values.fail && specific ? 3 : 0;
    }

    case "review": {
      parse({});
      const proposed = openStore()
        .list()
        .filter((m) => m.status === "proposed")
        .sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
      if (!proposed.length) {
        out("Nothing waiting for review.");
        return 0;
      }
      out(proposed.map((m) => `${renderMemory(m)}${m.supersedes ? `\n_would supersede: ${m.supersedes}_` : ""}`).join("\n\n"));
      out(`\n${proposed.length} waiting. \`memoryrail approve <ref>\` to accept, \`memoryrail reject <ref>\` to discard.`);
      return 0;
    }

    case "approve": {
      const { values, positionals } = parse({ all: { type: "boolean" } });
      const store = openStore();
      const ids = values.all ? store.list().filter((m) => m.status === "proposed").map((m) => m.id) : positionals;
      if (!ids.length) throw new UsageError("usage: memoryrail approve <id|ref>... | --all");
      for (const id of ids) {
        const m = store.approve(id);
        out(`Approved ${refOf(m)}: ${m.title}`);
      }
      return 0;
    }

    case "reject": {
      const { positionals } = parse({});
      if (!positionals.length) throw new UsageError("usage: memoryrail reject <id|ref>...");
      const store = openStore();
      for (const id of positionals) out(`Rejected ${store.reject(id).title}`);
      return 0;
    }

    case "config": {
      const { positionals } = parse({});
      const store = openStore();
      const [key, value] = positionals;
      if (!key) {
        out(JSON.stringify(store.config(), null, 2));
        return 0;
      }
      if (key !== "review") throw new UsageError(`unknown setting "${key}". Available: review`);
      if (value === undefined) {
        out(store.config().review);
        return 0;
      }
      if (value !== "off" && value !== "agents") throw new UsageError("review must be `off` or `agents`");
      writeConfig(store.root, { ...store.config(), review: value });
      out(
        value === "agents"
          ? "Review gate on: decisions, constraints, gotchas and failed attempts written by agents over MCP wait for `memoryrail approve`."
          : "Review gate off: agent-written memories take effect immediately (review them in git).",
      );
      return 0;
    }

    case "doctor": {
      parse({});
      const checks = doctor(openStore());
      const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" } as const;
      for (const c of checks) out(`${mark[c.status]}  ${c.name.padEnd(10)} ${c.detail}`);
      return checks.some((c) => c.status === "fail") ? 1 : 0;
    }

    case "install": {
      const { values, positionals } = parse({ npx: { type: "boolean" } });
      const target = positionals[0];
      const clients: Client[] =
        target === "all" ? (Object.keys(CLIENT_FILES) as Client[]) : target && target in CLIENT_FILES ? [target as Client] : [];
      if (!clients.length) throw new UsageError(`usage: memoryrail install <${Object.keys(CLIENT_FILES).join("|")}|all> [--npx]`);
      const store = openStore();
      for (const c of clients) {
        const r = installMcp(store.root, c, { npx: values.npx });
        out(`${r.action}: ${r.file}`);
      }
      out("Restart the client so it picks up the new MCP server.");
      return 0;
    }

    case "recall": {
      const { values, positionals } = parse({
        type: { type: "string", multiple: true },
        limit: { type: "string" },
        budget: { type: "string" },
        all: { type: "boolean" },
        json: { type: "boolean" },
      });
      const result = recall(openStore().list(), {
        query: positionals.join(" "),
        types: parseTypes(values.type),
        limit: toInt(values.limit, "limit"),
        budget: toInt(values.budget, "budget"),
        includeInactive: values.all,
      });
      if (values.json) {
        out(JSON.stringify(result.hits.map((h) => h.memory), null, 2));
      } else {
        out(result.rendered || "No matching memories.");
        if (result.truncated) out("\n(more results available: raise --limit or --budget)");
      }
      return 0;
    }

    case "list": {
      const { values } = parse({ type: { type: "string", multiple: true }, all: { type: "boolean" }, json: { type: "boolean" } });
      const types = parseTypes(values.type);
      const items = openStore()
        .list()
        .filter((m) => (values.all || m.status === "active") && (!types || types.includes(m.type)))
        .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
      out(values.json ? JSON.stringify(items, null, 2) : items.length ? items.map(line).join("\n") : "No memories yet.");
      return 0;
    }

    case "show": {
      const { positionals } = parse({});
      if (!positionals[0]) throw new UsageError("usage: memoryrail show <id>");
      out(renderMemory(openStore().resolveId(positionals[0])));
      return 0;
    }

    case "resolve": {
      const { positionals } = parse({});
      if (!positionals[0]) throw new UsageError("usage: memoryrail resolve <id>");
      const store = openStore();
      const target = store.resolveId(positionals[0]);
      if (target.type !== "thread") throw new UsageError(`only threads can be resolved; ${target.id} is a ${target.type}`);
      out(`Resolved ${store.setStatus(target.id, "resolved").id}`);
      return 0;
    }

    case "forget": {
      const { values, positionals } = parse({ delete: { type: "boolean" } });
      if (!positionals[0]) throw new UsageError("usage: memoryrail forget <id> [--delete]");
      const store = openStore();
      if (values.delete) out(`Deleted ${store.remove(positionals[0]).id}`);
      else out(`Archived ${store.setStatus(store.resolveId(positionals[0]).id, "archived").id}`);
      return 0;
    }

    case "handoff": {
      const { values } = parse({
        summary: { type: "string" },
        stdin: { type: "boolean" },
        title: { type: "string" },
        next: { type: "string", multiple: true },
        link: { type: "string", multiple: true },
        tag: { type: "string", multiple: true },
      });
      const summary = values.stdin ? readStdin() : values.summary;
      if (!summary?.trim()) throw new UsageError('usage: memoryrail handoff --summary "what you did" [--next "step"]...');
      const m = openStore().add(
        handoffToMemory({ title: values.title, summary, next: values.next, links: values.link, tags: values.tag }),
      );
      out(`Recorded handoff: ${m.id}\nNext session: run \`memoryrail resume\` for a prompt.`);
      return 0;
    }

    case "resume": {
      parse({});
      out(resumePrompt(openStore().list()));
      return 0;
    }

    case "sync": {
      const { values } = parse({ check: { type: "boolean" } });
      const changes = sync(openStore(), { check: values.check });
      const pending = changes.filter((c) => c.action !== "unchanged");
      for (const c of changes) out(`${values.check && c.action !== "unchanged" ? "out of date" : c.action}: ${c.path}`);
      if (values.check && pending.length) {
        process.stderr.write("Generated files are out of date. Run `memoryrail sync` and commit the result.\n");
        return 1;
      }
      return 0;
    }

    case "lint": {
      const { values } = parse({ strict: { type: "boolean" }, "no-git": { type: "boolean" }, json: { type: "boolean" } });
      const issues = lint(openStore(), { git: !values["no-git"] });
      if (values.json) out(JSON.stringify(issues, null, 2));
      else if (!issues.length) out("No issues found.");
      else for (const i of issues) out(`${i.severity.padEnd(7)} ${i.rule.padEnd(20)} ${i.id ?? i.file ?? ""}  ${i.message}`);
      const failing = issues.some((i) => i.severity === "error" || (values.strict && i.severity === "warning"));
      return failing ? 1 : 0;
    }

    case "serve": {
      const { values } = parse({ root: { type: "string" } });
      const root = values.root ? path.resolve(values.root) : undefined;
      const { serveStdio } = await import("./mcp.js");
      await serveStdio(root ? new Store(root) : openStore());
      return -1; // keep the process alive; the transport owns it now
    }

    default:
      throw new UsageError(`unknown command "${cmd}". Run \`memoryrail help\`.`);
  }
}

run(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`memoryrail: ${msg}\n`);
    process.exitCode = err instanceof UsageError ? 2 : 1;
  },
);
