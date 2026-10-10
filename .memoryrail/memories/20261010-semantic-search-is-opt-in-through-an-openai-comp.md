---
id: "20261010-semantic-search-is-opt-in-through-an-openai-comp"
type: "decision"
title: "Semantic search is opt-in through an OpenAI-compatible embeddings endpoint"
status: "active"
created: "2026-10-10T14:39:10.950Z"
updated: "2026-10-10T14:39:10.950Z"
tags: ["search"]
links: ["src/semantic.ts","src/embeddings.ts","src/search.ts"]
supersedes: "20261010-search-is-lexical-bm25-no-embeddings-yet-2"
---

Off by default and adds no dependency or bundled model: users point it at Ollama (local) or a hosted API. Vectors are a git-ignored cache under .memoryrail/index/, rebuilt from the memories. Results are fused with BM25 by reciprocal rank. If the endpoint fails, search falls back to keywords. Remote endpoints need --allow-remote.
