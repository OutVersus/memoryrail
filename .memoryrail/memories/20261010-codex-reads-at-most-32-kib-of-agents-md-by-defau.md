---
id: "20261010-codex-reads-at-most-32-kib-of-agents-md-by-defau"
type: "gotcha"
title: "Codex reads at most 32 KiB of AGENTS.md by default"
status: "active"
created: "2026-10-10T04:16:02.510Z"
updated: "2026-10-10T04:16:02.510Z"
tags: ["codex"]
links: ["src/sync.ts","src/doctor.ts"]
---

project_doc_max_bytes defaults to 32 KiB across the whole instruction chain, so a large generated block gets cut off silently. doctor warns above 32 KiB. Keep per-memory text short in sync output.
