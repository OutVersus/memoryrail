import type { Memory, MemoryType, NewMemory } from "./types.js";
import { renderMemory } from "./search.js";

export interface HandoffInput {
  title?: string;
  summary: string;
  next?: string[];
  links?: string[];
  tags?: string[];
}

export function handoffToMemory(input: HandoffInput, now: Date = new Date()): NewMemory {
  const summary = input.summary.trim();
  if (!summary) throw new Error("handoff needs a summary of what was done");
  const next = (input.next ?? []).map((n) => n.trim()).filter(Boolean);
  const body = next.length ? `${summary}\n\n### Next steps\n${next.map((n) => `- ${n}`).join("\n")}` : summary;
  return {
    type: "session",
    title: input.title?.trim() || `Session ${now.toISOString().slice(0, 16).replace("T", " ")}`,
    body,
    links: input.links,
    tags: input.tags,
  };
}

function section(heading: string, items: Memory[], render = renderMemory): string {
  return items.length ? `## ${heading}\n\n${items.map(render).join("\n\n")}` : "";
}

const newest = (a: Memory, b: Memory) => Date.parse(b.updated) - Date.parse(a.updated);

/** A paste-ready prompt that brings a fresh agent up to speed. */
export function resumePrompt(memories: Memory[], opts: { recentDecisions?: number } = {}): string {
  const active = memories.filter((m) => m.status === "active");
  const of = (t: MemoryType) => active.filter((m) => m.type === t).sort(newest);
  const lastSession = of("session")[0];
  const parts = [
    "You are resuming work on an existing project. Below is the project memory recorded by previous sessions. Treat constraints as rules, decisions as settled unless told otherwise, and gotchas as mistakes not to repeat.",
    lastSession ? section("Last session", [lastSession]) : "",
    section("Open threads", of("thread")),
    section("Constraints", of("constraint")),
    section("Recent decisions", of("decision").slice(0, opts.recentDecisions ?? 5)),
    section("Gotchas", of("gotcha")),
    "When you finish, record what you did and what is next with `memoryrail handoff`, and log any new decision with `memoryrail remember`.",
  ];
  return parts.filter(Boolean).join("\n\n");
}
