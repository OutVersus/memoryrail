<!-- memoryrail:start -->
## Project memory (managed by MemoryRail)

_Generated from `.memoryrail/`. Do not edit between these markers: change the memories, then run `memoryrail sync`._

### Constraints
- [CON-c9af] **Format changes must update docs/SPEC.md and spec/memory.schema.json, then be copied to memoryrail-si** — The website (private repo memoryrail-si) serves copies of the spec and the JSON Schema at memoryrail.si/spec. If the copies drift, the published spec is wrong. Copy both files there and redeploy after any format change. (files: docs/SPEC.md, spec/memory.schema.json)

### Decisions
- [DEC-25f4] **Search is lexical BM25, no embeddings yet** — Still lexical. Keeps the CLI dependency-light and offline. Semantic recall is planned as an optional layer. Documented as a limitation in the README and FAQ. (files: src/search.ts)
- [DEC-e952] **Gate agent writes with config review agents instead of always** — Default stays off: git review is enough for solo use, and a gate adds friction. When on, durable types written over MCP are proposed until a human approves. Proposals never retire the memory they supersede until approved. (files: src/store.ts, src/mcp.ts)
- [DEC-7e9e] **Ideas from agent-memory, projectmem and Memory Trail are reimplemented, never copied** — Licenses differ (Apache-2.0, MIT, CC BY 4.0). We borrowed concepts only: precheck and doctor (projectmem), review gate, secret scan and install (agent-memory), short citable refs and stop-on-conflict (Memory Trail). Keep it that way; credit them in the README. (files: README.md)
- [DEC-8755] **Project memory is plain Markdown in the repo** — No database or hosted service: files are reviewable in PRs, travel with clones, and need no account. Anything that breaks this property is out of scope for the core. (files: docs/SPEC.md)

### Gotchas
- [GOT-e8c2] **precheck --fail must ignore matches that are only a pinned rule** — Pinned constraints are always listed, so failing on any match would block every commit when used as a git hook. Fail only when a memory matched by file or by plan. (files: src/cli.ts, src/precheck.ts)
- [GOT-f758] **Windows installs can miss rollup's native binary** — npm optional-dependency bug (npm/cli#4828): vitest fails with 'Cannot find module @rollup/rollup-win32-x64-msvc'. Fix: npm install --no-save @rollup/rollup-win32-x64-msvc@<rollup version>.

### Open threads
- [THR-4c30] **Publish releases by hand until NPM_TOKEN is set** — 0.1.0 was published manually (npm login with 2FA, then npm publish --access public). The release workflow publishes on a v* tag only when the NPM_TOKEN repo secret exists, and skips if the version is already on npm. To automate: create an npm automation token and add it as the N…
- [THR-e74a] **Publish to npm and add Codex/Copilot setup docs** — Package is not yet published; README install section says so. Update once published.

How to use this memory:
- Before changing code, run `memoryrail precheck "<what you plan to do>" --file <path>` (or the MCP `precheck` tool). Use `memoryrail recall "<topic>"` for detail.
- Cite the memory you rely on as `[per DEC-xxxx]`. If your plan conflicts with a constraint or decision, stop and ask instead of proceeding.
- Record new decisions, approaches that failed, and gotchas with `memoryrail remember`. Finish a session with `memoryrail handoff`.
<!-- memoryrail:end -->
