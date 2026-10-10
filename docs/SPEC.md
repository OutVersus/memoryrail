# MemoryRail format, version 1

MemoryRail stores project memory as plain files in a repository so that people, git, and any AI coding agent can read and write it. This document is the contract. Tools that follow it interoperate, whether or not they use this package.

## Layout

```
.memoryrail/
  config.json              { "version": 1, "review": "off" }
  memories/
    20261010-use-drizzle-over-prisma.md
    20261010-session-2026-10-10-17-30.md
```

A repository is a MemoryRail project if it contains `.memoryrail/config.json`. Tools locate the nearest one by walking up from the working directory.

## Memory files

One memory per file, named `<id>.md`. A file is YAML frontmatter followed by a free-form Markdown body.

```markdown
---
id: "20261010-use-drizzle-over-prisma"
type: "decision"
title: "Use Drizzle over Prisma"
status: "active"
created: "2026-10-10T17:30:00.000Z"
updated: "2026-10-10T17:30:00.000Z"
tags: ["db"]
links: ["src/db"]
---

Edge deploys need a small runtime, and Prisma's engine is too large.
```

Writers SHOULD encode every frontmatter value as JSON (which is valid YAML) so that files parse identically everywhere. Readers MUST accept any valid YAML scalar or flow sequence for these fields. The JSON Schema is at [`spec/memory.schema.json`](../spec/memory.schema.json).

### Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique id. MUST equal the file name without `.md`. By convention `YYYYMMDD-slug`. |
| `type` | yes | One of `decision`, `constraint`, `gotcha`, `attempt`, `thread`, `session`. |
| `title` | yes | One line. State the conclusion, not the topic. |
| `status` | yes | `active`, `proposed`, `superseded`, `archived`, or `resolved`. |
| `created`, `updated` | yes | ISO 8601 timestamps. |
| `tags` | no | Free-form labels. |
| `links` | no | Repo-relative POSIX paths the memory is about. Used for staleness detection. MUST NOT escape the repository. |
| `pinned` | no | If `true`, always surfaced first. Use sparingly. |
| `supersedes` | no | Id of the memory this one replaces. |
| `superseded_by` | no | Id of the memory that replaced this one. Set on the old memory. |

Unknown fields MUST be preserved by tools that rewrite files.

### Types

- **decision**: a choice that was made and why. Treated as settled unless superseded.
- **constraint**: a rule to follow (conventions, things not to touch).
- **gotcha**: a mistake made once that should not be repeated.
- **attempt**: an approach that was tried and **failed**, with why. Surfaced by `precheck` so nobody retries it without a new reason.
- **thread**: unfinished work or an open question. Becomes `resolved` when done.
- **session**: an end-of-session handoff: what was done and the next steps.

### Lifecycle

- Memories are never silently overwritten. To change a decision, create a new memory with `supersedes` set. The old one becomes `superseded` and gets `superseded_by`. Both stay in the repository, and git keeps the rest of the history.
- `archived` means "wrong or no longer relevant"; `resolved` applies to threads.
- `proposed` means written by an agent and **waiting for a human**. See Review gate.
- Only `active` memories are returned by default and written into generated agent files.

## Short refs

Every memory has a short, citable handle: a three-letter type prefix and four hex characters of the SHA-1 of its `id`, e.g. `DEC-a3f9`. Prefixes: `DEC` decision, `CON` constraint, `GOT` gotcha, `ATT` attempt, `THR` thread, `SES` session. Refs are **derived, never stored**, so two branches cannot allocate the same one. Tools MUST accept a ref wherever an id is accepted, and MUST report an ambiguity instead of guessing if two memories share a ref.

## Review gate

`config.json` may set `"review": "agents"`. Then durable memories (`decision`, `constraint`, `gotcha`, `attempt`) written by an agent are saved with `status: "proposed"` and are ignored by recall, precheck and sync until a human approves them (`status: "active"`) or rejects them (file deleted). A proposal with `supersedes` does **not** change the superseded memory until approval. The default is `"off"`: agent writes are active immediately and are reviewed in git like any change.

## Secrets

Memory is committed and replayed into model context, so tools MUST refuse to write text that looks like a credential (private keys, cloud and API tokens, URL credentials, `password=...` style assignments) and SHOULD report which rule matched without echoing the value. A human-only override is allowed. Linters SHOULD flag existing files that match.

## Precheck

Given a plan (free text) and/or the files about to change, `precheck` returns the active `constraint`, `attempt`, `gotcha` and `decision` memories that apply, most binding first. A memory applies if it is a pinned constraint, if one of its `links` is the changed path or a directory containing it, or if its text matches the plan. Agents are instructed to cite what they rely on as `[per REF]` and to stop and ask if a plan conflicts with a constraint or decision.

## Generated agent files

`memoryrail sync` writes a managed block into `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/memoryrail.mdc`:

```
<!-- memoryrail:start -->
...generated, deterministic...
<!-- memoryrail:end -->
```

Content outside the markers is never modified. The block lists active memories with their refs, followed by short usage instructions (precheck first, cite refs, stop on conflict, record failures). It is a pure function of the memories, with no timestamps, so `memoryrail sync --check` can fail CI when it is out of date.

## Staleness

For each `active` memory and each entry in `links`:

- the path does not exist: `stale-link` (warning)
- the path's last git commit is newer than the memory's `updated`: `maybe-stale` (warning)
- the path resolves outside the repository: `link-outside-repo` (error)

## Versioning

`config.json` carries `version`. Version 1 is this document. Breaking changes will increment it.
