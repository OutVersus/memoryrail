---
id: "20261010-gate-agent-writes-with-config-review-agents-inst"
type: "decision"
title: "Gate agent writes with config review agents instead of always"
status: "active"
created: "2026-10-10T01:08:41.470Z"
updated: "2026-10-10T01:08:41.470Z"
tags: []
links: ["src/store.ts","src/mcp.ts"]
---

Default stays off: git review is enough for solo use, and a gate adds friction. When on, durable types written over MCP are proposed until a human approves. Proposals never retire the memory they supersede until approved.
