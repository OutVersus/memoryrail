import fs from "node:fs";
import path from "node:path";
import { lastCommitTime } from "./git.js";
import { scanSecrets } from "./secrets.js";
import { tokenize } from "./search.js";
import type { Store } from "./store.js";

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  rule: string;
  id?: string;
  file?: string;
  message: string;
}

export interface LintOptions {
  /** Check linked files against git history. Disabled in tests without a repo. */
  git?: boolean;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function lint(store: Store, opts: LintOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const { memories, errors } = store.loadAll();

  for (const e of errors) {
    issues.push({ severity: "error", rule: "invalid-file", file: e.file, message: e.message });
  }

  const byId = new Map(memories.map((m) => [m.id, m]));
  const active = memories.filter((m) => m.status === "active");

  for (const m of memories) {
    const secrets = scanSecrets(m.title, m.body, ...m.tags, ...m.links);
    if (secrets.length) {
      issues.push({
        severity: "error",
        rule: "secret",
        id: m.id,
        message: `looks like it contains a secret (${secrets.map((s) => s.rule).join(", ")}); remove it and rotate the credential`,
      });
    }
  }

  for (const m of memories) {
    if (m.supersededBy) {
      const next = byId.get(m.supersededBy);
      if (!next) {
        issues.push({ severity: "error", rule: "dangling-supersede", id: m.id, message: `superseded_by points to missing memory ${m.supersededBy}` });
      } else if (next.supersedes !== m.id && next.status !== "proposed") {
        issues.push({ severity: "warning", rule: "supersede-mismatch", id: m.id, message: `${next.id} does not point back via supersedes` });
      }
      if (m.status === "active") {
        issues.push({ severity: "warning", rule: "supersede-status", id: m.id, message: "has superseded_by but status is still active" });
      }
    }
    if (m.supersedes && !byId.has(m.supersedes)) {
      issues.push({ severity: "error", rule: "dangling-supersede", id: m.id, message: `supersedes missing memory ${m.supersedes}` });
    }
  }

  for (const m of active) {
    for (const link of m.links) {
      const abs = path.resolve(store.root, link);
      if (!abs.startsWith(store.root + path.sep) && abs !== store.root) {
        issues.push({ severity: "error", rule: "link-outside-repo", id: m.id, message: `link escapes the repository: ${link}` });
        continue;
      }
      if (!fs.existsSync(abs)) {
        issues.push({ severity: "warning", rule: "stale-link", id: m.id, message: `linked path no longer exists: ${link}` });
        continue;
      }
      if (opts.git !== false) {
        const changed = lastCommitTime(store.root, link);
        if (changed && changed.getTime() > Date.parse(m.updated)) {
          issues.push({
            severity: "warning",
            rule: "maybe-stale",
            id: m.id,
            message: `${link} changed after this memory was last updated; review it`,
          });
        }
      }
    }
  }

  const sets = active.map((m) => ({ m, t: new Set(tokenize(m.title)) }));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i]!;
      const b = sets[j]!;
      if (a.m.type === b.m.type && jaccard(a.t, b.t) >= 0.8) {
        issues.push({ severity: "warning", rule: "possible-duplicate", id: a.m.id, message: `very similar to ${b.m.id}; merge or supersede one` });
      }
    }
  }

  return issues;
}
