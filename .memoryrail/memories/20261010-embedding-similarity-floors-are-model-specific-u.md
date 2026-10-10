---
id: "20261010-embedding-similarity-floors-are-model-specific-u"
type: "gotcha"
title: "Embedding similarity floors are model-specific; unrelated text still scores high"
status: "active"
created: "2026-10-10T14:39:11.107Z"
updated: "2026-10-10T14:39:11.107Z"
tags: ["search"]
links: ["src/search.ts","src/embeddings.ts"]
---

nomic-embed-text scores unrelated pairs 0.40-0.46 and good matches 0.54-0.73, so a fixed threshold is fragile and a nonsense query would otherwise match every memory. Hence minSimilarity (default 0.5, tuned only on nomic), a margin from the best match, and a contrast-with-median rule. Use 'memoryrail embeddings explain' to tune, and do not assume the default fits another model.
