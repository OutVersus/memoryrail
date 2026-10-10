---
id: "20261010-precheck-fail-must-ignore-matches-that-are-only"
type: "gotcha"
title: "precheck --fail must ignore matches that are only a pinned rule"
status: "active"
created: "2026-10-10T01:08:41.386Z"
updated: "2026-10-10T01:08:41.386Z"
tags: []
links: ["src/cli.ts","src/precheck.ts"]
---

Pinned constraints are always listed, so failing on any match would block every commit when used as a git hook. Fail only when a memory matched by file or by plan.
