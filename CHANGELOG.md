# Changelog

## Unreleased

- **Optional semantic search.** `memoryrail embeddings setup | status | index | explain | off` adds matching by meaning to `recall` and `precheck` (CLI and MCP), using any OpenAI-compatible embeddings endpoint such as a local Ollama. Off by default; no new dependencies; falls back to keyword search if the endpoint is unreachable
- Non-local endpoints are refused unless `--allow-remote`; API keys are read from a named environment variable and never stored; the vector index is a git-ignored cache in `.memoryrail/index/`
- A query with no real answer matches nothing (minimum similarity, closeness to the best match, and contrast with the median)
- `--no-semantic` on `recall` and `precheck`; `doctor` reports semantic search status and flags remote endpoints
- Spec: optional `embeddings` config, `.memoryrail/.gitignore`, derived `index/`

## 0.1.1 (2026-10-10)

- Setup guide for OpenAI Codex and GitHub Copilot (VS Code, CLI, cloud agent): `docs/CLIENTS.md`
- `sync --also <path>` writes the managed block into extra files, e.g. `.github/copilot-instructions.md`; paths outside the repo are refused
- `doctor` warns when `AGENTS.md` exceeds Codex's default 32 KiB read limit

## 0.1.0 (2026-10-10)

Initial version.

- Memory as Markdown files in `.memoryrail/`; types: decision, constraint, gotcha, attempt, thread, session
- CLI and MCP server (resume, precheck, recall, remember, handoff, list, forget, resolve)
- `precheck`: surfaces constraints, failed attempts, gotchas and decisions for a plan or files; `--staged` and `--fail` for git hooks
- Short citable refs (`DEC-a3f9`) derived from ids
- Review gate (`config review agents`, `review`, `approve`, `reject`)
- Secret scanning on write and in `lint`
- `sync` to AGENTS.md, CLAUDE.md and Cursor rules; `sync --check` for CI
- `lint` (stale links, git-changed files, duplicates, secrets), `doctor`, `install` for Claude Code and Cursor
- Format spec and JSON Schema
