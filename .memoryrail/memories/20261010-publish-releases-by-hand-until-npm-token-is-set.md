---
id: "20261010-publish-releases-by-hand-until-npm-token-is-set"
type: "thread"
title: "Publish releases by hand until NPM_TOKEN is set"
status: "active"
created: "2026-10-10T02:24:21.135Z"
updated: "2026-10-10T02:24:21.135Z"
tags: ["release"]
links: []
---

0.1.0 was published manually (npm login with 2FA, then npm publish --access public). The release workflow publishes on a v* tag only when the NPM_TOKEN repo secret exists, and skips if the version is already on npm. To automate: create an npm automation token and add it as the NPM_TOKEN secret. Also keep the website copies of the spec in memoryrail-si in sync.
