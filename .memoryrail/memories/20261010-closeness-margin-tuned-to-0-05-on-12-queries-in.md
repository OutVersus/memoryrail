---
id: "20261010-closeness-margin-tuned-to-0-05-on-12-queries-in"
type: "decision"
title: "Closeness margin tuned to 0.05 on 12 queries (in-sample)"
status: "active"
created: "2026-10-10T14:40:31.317Z"
updated: "2026-10-10T14:40:31.317Z"
tags: ["search"]
links: ["src/embeddings.ts"]
---

Margin 0.10 returned 2.8 memories per query at 35% precision; 0.05 returned 2.0 at 50% with the same recall (12/12) and no false matches on 10 unrelated queries. 0.03 looked better still but would overfit a 12-query, single-answer set. Re-tune on a bigger, multi-answer set before changing it. The README says the numbers are optimistic because of this.
