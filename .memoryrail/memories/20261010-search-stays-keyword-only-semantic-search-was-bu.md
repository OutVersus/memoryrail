---
id: "20261010-search-stays-keyword-only-semantic-search-was-bu"
type: "decision"
title: "Search stays keyword-only; semantic search was built, measured and removed"
status: "active"
created: "2026-10-10T14:45:46.896Z"
updated: "2026-10-10T14:45:46.896Z"
tags: ["search"]
links: ["src/search.ts"]
supersedes: "20261010-search-is-lexical-bm25-no-embeddings-yet-2"
---

We built optional semantic search (OpenAI-compatible embeddings endpoint, git-ignored vector cache, hybrid ranking) in commit 69a3309 and reverted it. Reason: it needs a separate embedding server such as Ollama, which is a real setup hurdle, and it weakens the 'no network calls, no extra software' promise for a modest gain. Measured on a 16-memory corpus with nomic-embed-text: 12/12 vs 10/12 on reworded questions, 0/10 false matches, but half of the results were still not the answer, and the numbers were tuned in-sample. To revisit, start from git show 69a3309 rather than rewriting it; a built-in model (Transformers.js) was considered and not built.
