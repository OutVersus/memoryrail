import fs from "node:fs";
import path from "node:path";
import { CLIENT_FILES, isInstalled, type Client } from "./install.js";
import { lint } from "./lint.js";
import { CODEX_DOC_LIMIT_BYTES, sync } from "./sync.js";
import { DIR_NAME, FORMAT_VERSION, type Store } from "./store.js";

export interface Check {
  status: "ok" | "warn" | "fail";
  name: string;
  detail: string;
}

/** One-shot health report: is memory present, valid, safe, synced and reachable by agents? */
export function doctor(store: Store): Check[] {
  const checks: Check[] = [];
  const add = (status: Check["status"], name: string, detail: string) => checks.push({ status, name, detail });

  const config = store.config();
  if (config.version === FORMAT_VERSION) add("ok", "format", `${DIR_NAME}/ uses format version ${config.version}`);
  else add("fail", "format", `config says version ${config.version}; this tool reads version ${FORMAT_VERSION}`);

  const { memories, errors } = store.loadAll();
  if (errors.length) add("fail", "files", `${errors.length} unreadable memory file(s); run \`memoryrail lint\``);
  else add("ok", "files", `${memories.length} memor${memories.length === 1 ? "y" : "ies"}, all valid`);

  const issues = lint(store);
  const secrets = issues.filter((i) => i.rule === "secret");
  if (secrets.length) add("fail", "secrets", `${secrets.length} memory file(s) look like they contain a secret; remove it and rotate the credential`);
  else add("ok", "secrets", "no secrets detected");

  const otherErrors = issues.filter((i) => i.severity === "error" && i.rule !== "secret" && i.rule !== "invalid-file");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (otherErrors.length) add("fail", "integrity", `${otherErrors.length} error(s); run \`memoryrail lint\``);
  else if (warnings.length) add("warn", "freshness", `${warnings.length} warning(s) (stale links, duplicates); run \`memoryrail lint\``);
  else add("ok", "freshness", "no stale links or duplicates");

  const proposed = memories.filter((m) => m.status === "proposed").length;
  if (proposed) add("warn", "review", `${proposed} proposed memor${proposed === 1 ? "y is" : "ies are"} waiting; run \`memoryrail review\``);
  else add("ok", "review", config.review === "agents" ? "review gate on, nothing waiting" : "review gate off (agent writes go live; review them in git)");

  const drift = sync(store, { check: true }).filter((c) => c.action !== "unchanged");
  if (drift.length) add("warn", "sync", `${drift.map((d) => d.path).join(", ")} out of date; run \`memoryrail sync\``);
  else add("ok", "sync", "AGENTS.md, CLAUDE.md and Cursor rules are up to date");

  try {
    const bytes = fs.statSync(path.join(store.root, "AGENTS.md")).size;
    if (bytes > CODEX_DOC_LIMIT_BYTES) {
      add("warn", "size", `AGENTS.md is ${Math.round(bytes / 1024)} KiB; Codex stops reading it after 32 KiB by default. Archive stale memories or raise project_doc_max_bytes`);
    }
  } catch {
    /* no AGENTS.md yet; the sync check above already says so */
  }

  const wired = (Object.keys(CLIENT_FILES) as Client[]).filter((c) => isInstalled(store.root, c));
  if (wired.length) add("ok", "agents", `MCP server registered for: ${wired.join(", ")}`);
  else add("warn", "agents", "no MCP client configured in this repo; run `memoryrail install claude` or `install cursor`");

  if (fs.existsSync(path.join(store.root, ".git"))) add("ok", "git", "inside a git repository");
  else add("warn", "git", "not a git repository; memory will not be versioned or reviewable");

  return checks;
}
