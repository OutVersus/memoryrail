# Changelog

## 0.1.0 (unreleased)

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
