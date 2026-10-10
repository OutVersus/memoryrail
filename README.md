# MemoryRail

[![npm](https://img.shields.io/npm/v/memoryrail)](https://www.npmjs.com/package/memoryrail)
[![CI](https://github.com/OutVersus/memoryrail/actions/workflows/ci.yml/badge.svg)](https://github.com/OutVersus/memoryrail/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Git-native project memory for coding agents.** Website: [memoryrail.si](https://memoryrail.si)

Decisions, constraints, gotchas and failed attempts live in your repo as plain Markdown. People can read and review them in a PR. Any agent that speaks MCP (Claude Code, Cursor, Codex, Copilot, Aider, ...) can read and write them, and gets warned before it repeats a mistake.

- **Warns before a mistake repeats.** `memoryrail precheck` takes what an agent is about to do and the files it will touch, and returns the rules, failed attempts, gotchas and decisions that apply.
- **Plain files, no database.** `.memoryrail/memories/*.md`, one memory per file. Diff it, grep it, review it.
- **Travels with the repo.** Clone it and the memory comes along. Branches carry their own memory.
- **One source, every agent.** `memoryrail sync` keeps `AGENTS.md`, `CLAUDE.md` and `.cursor/rules` in step, so you maintain one memory instead of three config files.
- **Safe to commit.** Text that looks like a secret is refused. An optional review gate holds agent-written memories until you approve them.
- **Local and private.** No account and no server. No network calls unless you turn on the optional semantic search, which sends memory text to the embeddings endpoint *you* choose (a local one keeps it on your machine).
- **Stays honest.** Memories link to files; `memoryrail lint` flags the ones whose files changed or vanished. New decisions *supersede* old ones instead of overwriting them.

> Status: **0.1, early.** The format is specified ([docs/SPEC.md](docs/SPEC.md)) and may change before 1.0.

## What it looks like

```
$ memoryrail precheck "cache images on disk" --file src/images/a.ts
Check these before you proceed. Cite what you rely on as [per REF]. If your plan
conflicts with a constraint or decision, stop and ask.

- [CON-5413] (constraint) Never commit .env files — pinned rule
- [ATT-f485] (attempt) Caching images locally violates the provider TOS — about
  src/images/a.ts; matches your plan
    We cached originals to speed up the gallery. Provider flagged it; had to purge.
```

Each memory is a small file you can read and edit by hand:

```markdown
---
id: "20261010-caching-images-locally-violates-the-provider-tos"
type: "attempt"
title: "Caching images locally violates the provider TOS"
status: "active"
links: ["src/images"]
---

We cached originals to speed up the gallery. The provider flagged it and we had to purge.
```

Six types: `decision`, `constraint`, `gotcha`, `attempt` (tried and failed, with why), `thread` (unfinished work), `session` (end-of-session handoff).

## Install

Needs Node 20 or newer.

```sh
npm install -g memoryrail    # puts `memoryrail` on your PATH
```

Or run any command without installing, as `npx memoryrail <command>`. Note that `memoryrail install` registers the server as the command `memoryrail`, so that needs the global install; use `memoryrail install claude --npx` to register `npx -y memoryrail serve` instead.

## Quick start

```sh
memoryrail init
memoryrail remember "Use Drizzle over Prisma" --type decision \
  --body "Edge deploys need a small runtime." --link src/db.ts
memoryrail remember "Never commit .env files" --type constraint --pin
memoryrail sync            # writes AGENTS.md, CLAUDE.md, .cursor/rules/memoryrail.mdc
memoryrail install claude  # registers the MCP server in .mcp.json (or: cursor, all)
memoryrail doctor          # checks that everything is valid, safe, synced and wired up
git add .memoryrail AGENTS.md CLAUDE.md .mcp.json && git commit -m "Add project memory"
```

## Connect an agent (MCP)

Setup for **Claude Code, Cursor, OpenAI Codex and GitHub Copilot** (VS Code, CLI and the cloud agent) is in [docs/CLIENTS.md](docs/CLIENTS.md). The short version for Claude Code and Cursor:

```sh
# Claude Code or Cursor, written into the repo's own config (keeps other servers)
memoryrail install claude      # .mcp.json
memoryrail install cursor      # .cursor/mcp.json
```

Or by hand in any MCP client config (Claude Desktop, ...):

```json
{
  "mcpServers": {
    "memoryrail": { "command": "memoryrail", "args": ["serve"] }
  }
}
```

The server uses the nearest `.memoryrail/` above its working directory, or pass `--root <path>`.

| Tool | Use |
|---|---|
| `resume` | Call first in a session: last handoff, open threads, constraints, recent decisions, gotchas |
| `precheck` | Call before changing code: the rules, failed attempts, gotchas and decisions that apply to a plan or files |
| `recall` | Search memory for what you are about to work on (token-budgeted) |
| `remember` | Record a decision, constraint, gotcha, failed attempt or thread; `supersedes` replaces an old one |
| `handoff` | Call last: what was done and the next steps |
| `list_memories`, `forget`, `resolve_thread` | Housekeeping |

## The workflow

1. **Start:** the agent calls `resume` (or you run `memoryrail resume` and paste the output).
2. **Work:** it calls `precheck` before changing code, `recall "<area>"` for detail, and `remember` when it decides something, hits a trap, or watches an approach fail. It cites what it relies on as `[per DEC-a3f9]` and stops to ask if its plan conflicts with a constraint or decision.
3. **Finish:** it calls `handoff` with a summary and next steps.
4. **Review:** memory changes show up in the git diff like any other change. `memoryrail sync` and `memoryrail lint` run in CI.

## CLI

```
memoryrail init
memoryrail remember <title> [--type decision|constraint|gotcha|attempt|thread|session] [--body ..] [--stdin]
                            [--tag ..] [--link <path>] [--pin] [--supersedes <id>] [--propose]
memoryrail precheck [plan] [--file <path>]... [--staged] [--fail] [--json]
memoryrail recall [query] [--type ..] [--limit n] [--budget tokens] [--all] [--json]
memoryrail list | show <id> | resolve <id> | forget <id> [--delete]
memoryrail review | approve <id>... [--all] | reject <id>...
memoryrail config review [off|agents]
memoryrail handoff --summary <text> [--next <step>]... [--title ..] [--link ..]
memoryrail resume
memoryrail sync [--check] [--also <path>]...
memoryrail lint [--strict] [--no-git] [--json]
memoryrail doctor
memoryrail install <claude|cursor|all> [--npx]
memoryrail serve [--root <path>]
```

Anywhere an id is accepted you can use the id, any unambiguous prefix, or the short ref shown in output (`DEC-a3f9`).

### Review gate

By default an agent's memories are active immediately and you review them in git. For more control:

```sh
memoryrail config review agents
```

Now decisions, constraints, gotchas and failed attempts written over MCP are saved as *proposed*. They are ignored by `recall`, `precheck` and `sync` until you run `memoryrail review` and then `approve` or `reject`. A proposal that supersedes an older memory leaves it untouched until approved.

### Git hook

`precheck --staged --fail` exits 3 when a staged file has a relevant failed attempt, gotcha or decision. Pinned rules alone never fail it.

```sh
# .git/hooks/pre-commit
memoryrail precheck --staged --fail || echo "Review the memories above before committing." >&2
```

### CI

```yaml
- run: npx memoryrail sync --check   # generated agent files are up to date
- run: npx memoryrail lint --strict  # no stale links, duplicates, secrets or broken files
```

## Semantic search (optional)

By default, search matches words (BM25 over title, tags, links and body, with a mild recency boost), so `recall "database"` won't find a memory that only says "Postgres". Semantic search adds matching by meaning: "can we copy implementation from competitors" finds the memory titled "reimplemented, never copied".

It works with any OpenAI-compatible embeddings endpoint. MemoryRail adds no dependency and downloads no model. With [Ollama](https://ollama.com) everything stays on your machine:

```sh
ollama pull nomic-embed-text
memoryrail embeddings setup --url http://localhost:11434/v1 --model nomic-embed-text
```

- **Where it applies:** `recall` and `precheck`, from the CLI and over MCP. Keyword and semantic results are combined. `--no-semantic` forces keywords only.
- **It never breaks search.** If the endpoint is down, search falls back to keywords and prints a warning to stderr.
- **The index is a cache.** Vectors live in `.memoryrail/index/`, which is git-ignored and rebuilt from the memories. Only new or changed memories are re-embedded; switching models rebuilds it, so vectors from different models are never mixed.
- **Commands:** `memoryrail embeddings setup | status | index [--rebuild] | explain "<query>" | off`.

**Privacy.** Turning this on is the one case where MemoryRail talks to a network. The text of your memories, and your search queries, are sent to the endpoint you configure. A local address (localhost) keeps that on your machine. A remote one is refused unless you pass `--allow-remote`, and `doctor` flags it. For a hosted provider, also pass `--key-env <VAR>` to name the environment variable holding the API key; the key itself is never stored. Memory text is already screened for secrets when it is written, but treat anything in memory as something the provider will see.

**Tuning.** How similar is "similar enough" depends on the model, so the threshold is configurable (`--min-similarity`, default 0.5). A match must also be close to the best match and stand out from the typical memory, so a query with no real answer matches nothing. Run `memoryrail embeddings explain "<query>"` to see every memory's score and adjust.

**What we measured, and didn't.** On a 16-memory corpus (this project's own) with `nomic-embed-text` through Ollama, using 12 reworded questions that each have one right answer:

| | found the right memory | results returned per query | share of results that were right |
|---|---|---|---|
| keyword search | 10 of 12 | 3.0 | 28% |
| semantic search | 12 of 12 | 2.0 | 50% |

Ten unrelated queries (weather, recipes, flights, ...) produced no false matches. Read this with care: it is a small sample on a small corpus, the closeness margin was tuned on these same 12 questions so the semantic numbers are optimistic, and the defaults were only tuned on this one model. Half of what semantic search returns is still not the answer you wanted. Expect a modest gain on small memories and a larger one as the memory grows and wording varies. We have **not** tested hosted providers. The index is a single JSON file read on every search, which is fine for hundreds of memories, not for tens of thousands.

## Limitations

- **Search is keyword-based by default** (see Semantic search above to add matching by meaning). Without it, write titles that state the conclusion in the words you would search for, and use tags.
- `maybe-stale` relies on git history; it is skipped outside a git repository.
- **The secret scanner is a pattern check, not a guarantee.** It catches common key formats and `password = ...` assignments, and it will miss secrets in unusual shapes. Treat it as a safety net, and don't paste credentials into memory.
- `install` configures Claude Code and Cursor only. For Codex and Copilot, follow [docs/CLIENTS.md](docs/CLIENTS.md); those snippets come from the vendors' documentation and haven't been run against MemoryRail by us.
- Codex stops reading `AGENTS.md` after 32 KiB by default. `memoryrail doctor` warns when yours gets that large.
- This is an early release (0.x). The format and commands may change before 1.0, and it has had little use on real projects so far. Please open issues.
- The memory is only as good as what agents and people record. MemoryRail makes recording cheap and reviewable; it does not do it for you.

## Library

```ts
import { openStore, recall, precheck, sync } from "memoryrail";

const store = openStore();
store.add({ type: "gotcha", title: "Run migrations before seeding" });
console.log(recall(store.list(), { query: "migrations" }).rendered);
console.log(precheck(store.list(), { plan: "seed the database", files: ["db/seed.ts"] }).rendered);
sync(store);
```

## Credits

MemoryRail borrows ideas, not code, from three open-source projects: [projectmem](https://github.com/riponcm/projectmem) (warn before a failed approach is repeated; a doctor command), [agent-memory](https://github.com/xChuCx/agent-memory) (a human review gate, secret scanning, one-command client setup) and [Memory Trail](https://github.com/frmoretto/memory-trail) (short citable decision ids, "stop if it conflicts"). Look at them too; they take different approaches.

## Contributing

```sh
npm install
npm test
npm run build
```

Issues and PRs welcome. Changes to the on-disk format must update [docs/SPEC.md](docs/SPEC.md) and the JSON Schema.

## License

MIT. See [LICENSE](LICENSE).
