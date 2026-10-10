import { execFileSync } from "node:child_process";

/** Paths staged for the next commit (empty outside a git repo). */
export function stagedFiles(root: string): string[] {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Time of the last commit touching `file`, or null if unknown (no git, untracked, ...). */
export function lastCommitTime(root: string, file: string): Date | null {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (!out) return null;
    const d = new Date(out);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
