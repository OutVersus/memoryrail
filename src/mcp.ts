import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handoffToMemory, resumePrompt } from "./handoff.js";
import { precheck } from "./precheck.js";
import { refOf } from "./refs.js";
import { recall } from "./search.js";
import { semanticScores } from "./semantic.js";
import type { Store } from "./store.js";
import { DURABLE_TYPES, MEMORY_TYPES } from "./types.js";
import { VERSION } from "./version.js";

const typeEnum = z.enum(MEMORY_TYPES);

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
});

/** Run a tool body, turning thrown errors into MCP tool errors instead of crashing the server. */
function guard<A>(fn: (args: A) => string | Promise<string>): (args: A) => Promise<ReturnType<typeof text> | ReturnType<typeof fail>> {
  return async (args) => {
    try {
      return text(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

// stdout carries the protocol; diagnostics go to stderr.
const warn = (m: string) => process.stderr.write(`memoryrail: ${m}
`);

export function createServer(store: Store): McpServer {
  const server = new McpServer({ name: "memoryrail", version: VERSION });

  server.tool(
    "recall",
    "Search this project's memory (decisions, constraints, gotchas, open threads, past sessions). Call this at the start of a task and before changing an area you have not touched. Returns the most relevant active memories within a token budget.",
    {
      query: z.string().optional().describe("What you are about to work on. Omit for the most recent and pinned memories."),
      types: z.array(typeEnum).optional().describe("Restrict to these memory types."),
      limit: z.number().int().positive().max(50).optional(),
      budget: z.number().int().positive().max(20000).optional().describe("Approximate token budget for the response."),
    },
    guard(async ({ query, types, limit, budget }) => {
      const semantic = query ? await semanticScores(store, query, { warn }) : null;
      const r = recall(store.list(), { query, types, limit, budget, semantic: semantic ?? undefined });
      if (!r.hits.length) return "No matching memories.";
      return r.rendered + (r.truncated ? "\n\n(More results exist: raise limit or budget, or narrow the query.)" : "");
    }),
  );

  server.tool(
    "remember",
    "Record something future sessions must know. Use 'decision' for choices and their reasons, 'constraint' for rules to follow, 'gotcha' for traps, 'attempt' for an approach that was tried and FAILED (say why, so nobody retries it), 'thread' for unfinished work. Pass supersedes to replace an earlier memory instead of duplicating it. Never include secrets, tokens or passwords: they are rejected. If the project requires review, durable memories are saved as proposed until a human approves them.",
    {
      type: typeEnum,
      title: z.string().min(1).describe("One line. State the conclusion, not the topic."),
      body: z.string().optional().describe("Why, and anything needed to apply it."),
      tags: z.array(z.string()).optional(),
      links: z.array(z.string()).optional().describe("Repo-relative files this is about, so staleness can be detected."),
      pinned: z.boolean().optional().describe("Always surface this memory. Use sparingly."),
      supersedes: z.string().optional().describe("Id of an earlier memory this replaces."),
    },
    guard((input) => {
      const gated = store.config().review === "agents" && DURABLE_TYPES.includes(input.type);
      const m = store.add({ ...input, status: gated ? "proposed" : "active" });
      return gated
        ? `Proposed ${m.type} ${refOf(m)}: ${m.id}. It is not active until a human runs \`memoryrail approve ${refOf(m)}\`.`
        : `Saved ${m.type} ${refOf(m)}: ${m.id}`;
    }),
  );

  server.tool(
    "precheck",
    "Call BEFORE you change code. Given what you plan to do and the files you will touch, returns the project's constraints, previously failed approaches, gotchas and decisions that apply. Cite what you rely on as [per REF]; if your plan conflicts with a constraint or decision, stop and ask the user.",
    {
      plan: z.string().optional().describe("What you are about to do, in plain words."),
      files: z.array(z.string()).optional().describe("Repo-relative paths you are about to change."),
    },
    guard(async ({ plan, files }) => {
      const semantic = plan ? await semanticScores(store, plan, { warn }) : null;
      return precheck(store.list(), { plan, files, semantic: semantic ?? undefined }).rendered;
    }),
  );

  server.tool(
    "list_memories",
    "List memory ids and titles, newest first. Use recall for content.",
    { types: z.array(typeEnum).optional(), include_inactive: z.boolean().optional() },
    guard(({ types, include_inactive }) => {
      const items = store
        .list()
        .filter((m) => (include_inactive || m.status === "active") && (!types?.length || types.includes(m.type)))
        .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
      return items.length ? items.map((m) => `${refOf(m)}  [${m.type}] ${m.title}`).join("\n") : "No memories yet.";
    }),
  );

  server.tool(
    "forget",
    "Archive a memory that is wrong or no longer relevant. It stays in git history. For a thread that is finished, use resolve_thread instead.",
    { id: z.string() },
    guard(({ id }) => `Archived ${store.setStatus(store.resolveId(id).id, "archived").id}`),
  );

  server.tool(
    "resolve_thread",
    "Mark an open thread as resolved.",
    { id: z.string() },
    guard(({ id }) => {
      const m = store.resolveId(id);
      if (m.type !== "thread") throw new Error(`${m.id} is a ${m.type}, not a thread`);
      return `Resolved ${store.setStatus(m.id, "resolved").id}`;
    }),
  );

  server.tool(
    "handoff",
    "Call at the end of a session: what you did, what is unfinished, and the next steps. The next session's resume prompt starts from this.",
    {
      summary: z.string().min(1),
      next: z.array(z.string()).optional().describe("Concrete next steps."),
      title: z.string().optional(),
      links: z.array(z.string()).optional(),
    },
    guard((input) => `Recorded handoff: ${store.add(handoffToMemory(input)).id}`),
  );

  server.tool(
    "resume",
    "Get a prompt summarizing the last session, open threads, constraints, recent decisions and gotchas. Call this first in a new session.",
    {},
    guard(() => resumePrompt(store.list())),
  );

  return server;
}

export async function serveStdio(store: Store): Promise<void> {
  const server = createServer(store);
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; log to stderr only.
  process.stderr.write(`memoryrail MCP server ready (root: ${store.root})\n`);
}
