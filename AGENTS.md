<!-- memoryrail:start -->
## Project memory (managed by MemoryRail)

_Generated from `.memoryrail/`. Do not edit between these markers: change the memories, then run `memoryrail sync`._

### Constraints
- [CON-8b89] **src/embeddings.ts is the only code allowed to use the network** — Our privacy promise is no network calls unless the user turns on semantic search and points it somewhere. Keep every other module offline, keep non-local URLs refused without allowRemote, and never write an API key to config.json or logs. (files: src/embeddings.ts, SECURITY.md, CONTRIBUTING.md)
- [CON-c9af] **Format changes must update docs/SPEC.md and spec/memory.schema.json, then be copied to memoryrail-si** — The website (private repo memoryrail-si) serves copies of the spec and the JSON Schema at memoryrail.si/spec. If the copies drift, the published spec is wrong. Copy both files there and redeploy after any format change. (files: docs/SPEC.md, spec/memory.schema.json)

### Decisions
- [DEC-8a82] **Closeness margin tuned to 0.05 on 12 queries (in-sample)** — Margin 0.10 returned 2.8 memories per query at 35% precision; 0.05 returned 2.0 at 50% with the same recall (12/12) and no false matches on 10 unrelated queries. 0.03 looked better still but would overfit a 12-query, single-answer set. Re-tune on a bigger, multi-answer set befor… (files: src/embeddings.ts)
- [DEC-c5a9] **Semantic search is opt-in through an OpenAI-compatible embeddings endpoint** — Off by default and adds no dependency or bundled model: users point it at Ollama (local) or a hosted API. Vectors are a git-ignored cache under .memoryrail/index/, rebuilt from the memories. Results are fused with BM25 by reciprocal rank. If the endpoint fails, search falls back… (files: src/semantic.ts, src/embeddings.ts, src/search.ts)
- [DEC-2e7c] **Client setup docs come from vendor docs, not memory; say what was not run** — docs/CLIENTS.md was written from the official Codex, VS Code and GitHub Copilot docs (checked 2026-10-10) and says plainly that we have not run Codex or Copilot against MemoryRail. Re-check the sources when a client changes; do not add a client config we have not read in its doc… (files: docs/CLIENTS.md)
- [DEC-e952] **Gate agent writes with config review agents instead of always** — Default stays off: git review is enough for solo use, and a gate adds friction. When on, durable types written over MCP are proposed until a human approves. Proposals never retire the memory they supersede until approved. (files: src/store.ts, src/mcp.ts)
- [DEC-7e9e] **Ideas from agent-memory, projectmem and Memory Trail are reimplemented, never copied** — Licenses differ (Apache-2.0, MIT, CC BY 4.0). We borrowed concepts only: precheck and doctor (projectmem), review gate, secret scan and install (agent-memory), short citable refs and stop-on-conflict (Memory Trail). Keep it that way; credit them in the README. (files: README.md)
- [DEC-8755] **Project memory is plain Markdown in the repo** — No database or hosted service: files are reviewable in PRs, travel with clones, and need no account. Anything that breaks this property is out of scope for the core. (files: docs/SPEC.md)

### Gotchas
- [GOT-95e8] **Embedding similarity floors are model-specific; unrelated text still scores high** — nomic-embed-text scores unrelated pairs 0.40-0.46 and good matches 0.54-0.73, so a fixed threshold is fragile and a nonsense query would otherwise match every memory. Hence minSimilarity (default 0.5, tuned only on nomic), a margin from the best match, and a contrast-with-median… (files: src/search.ts, src/embeddings.ts)
- [GOT-81a2] **Codex reads at most 32 KiB of AGENTS.md by default** — project_doc_max_bytes defaults to 32 KiB across the whole instruction chain, so a large generated block gets cut off silently. doctor warns above 32 KiB. Keep per-memory text short in sync output. (files: src/sync.ts, src/doctor.ts)
- [GOT-e8c2] **precheck --fail must ignore matches that are only a pinned rule** — Pinned constraints are always listed, so failing on any match would block every commit when used as a git hook. Fail only when a memory matched by file or by plan. (files: src/cli.ts, src/precheck.ts)
- [GOT-f758] **Windows installs can miss rollup's native binary** — npm optional-dependency bug (npm/cli#4828): vitest fails with 'Cannot find module @rollup/rollup-win32-x64-msvc'. Fix: npm install --no-save @rollup/rollup-win32-x64-msvc@<rollup version>.

### Open threads
- [THR-4c30] **Publish releases by hand until NPM_TOKEN is set** — 0.1.0 was published manually (npm login with 2FA, then npm publish --access public). The release workflow publishes on a v* tag only when the NPM_TOKEN repo secret exists, and skips if the version is already on npm. To automate: create an npm automation token and add it as the N…

How to use this memory:
- Before changing code, run `memoryrail precheck "<what you plan to do>" --file <path>` (or the MCP `precheck` tool). Use `memoryrail recall "<topic>"` for detail.
- Cite the memory you rely on as `[per DEC-xxxx]`. If your plan conflicts with a constraint or decision, stop and ask instead of proceeding.
- Record new decisions, approaches that failed, and gotchas with `memoryrail remember`. Finish a session with `memoryrail handoff`.
<!-- memoryrail:end -->
