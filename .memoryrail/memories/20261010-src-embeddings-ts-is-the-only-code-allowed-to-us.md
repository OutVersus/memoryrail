---
id: "20261010-src-embeddings-ts-is-the-only-code-allowed-to-us"
type: "constraint"
title: "src/embeddings.ts is the only code allowed to use the network"
status: "active"
created: "2026-10-10T14:39:11.031Z"
updated: "2026-10-10T14:39:11.031Z"
tags: []
links: ["src/embeddings.ts","SECURITY.md","CONTRIBUTING.md"]
pinned: true
---

Our privacy promise is no network calls unless the user turns on semantic search and points it somewhere. Keep every other module offline, keep non-local URLs refused without allowRemote, and never write an API key to config.json or logs.
