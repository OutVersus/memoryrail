---
id: "20261010-windows-installs-can-miss-rollup-s-native-binary"
type: "gotcha"
title: "Windows installs can miss rollup's native binary"
status: "active"
created: "2026-10-10T00:50:46.273Z"
updated: "2026-10-10T00:50:46.273Z"
tags: []
links: []
---

npm optional-dependency bug (npm/cli#4828): vitest fails with 'Cannot find module @rollup/rollup-win32-x64-msvc'. Fix: npm install --no-save @rollup/rollup-win32-x64-msvc@<rollup version>.
