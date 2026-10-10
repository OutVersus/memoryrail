# Contributing to MemoryRail

Thanks for helping. This project is small on purpose, so a few ground rules keep it that way.

## Set up

```sh
git clone https://github.com/OutVersus/memoryrail && cd memoryrail
npm install
npm test          # vitest, ~1 second
npm run typecheck
npm run build
```

Node 20 or newer. On Windows, if vitest fails with `Cannot find module @rollup/rollup-win32-x64-msvc`, that is an npm optional-dependency bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)). Reinstalling did not fix it on our machine; installing the missing binary did: `npm install --no-save @rollup/rollup-win32-x64-msvc@<the version of rollup in node_modules>`.

## This repo uses MemoryRail on itself

Before changing code, run:

```sh
node dist/cli.js precheck "what you plan to do" --file src/the-file.ts
```

and read what it returns. If you make a decision or hit a trap, record it with `memoryrail remember` and commit the new file. CI runs `sync --check` and `lint --strict`, so run `node dist/cli.js sync` after changing memories.

## What a good change looks like

- **Format changes** (anything in `docs/SPEC.md` or `spec/memory.schema.json`) must update both files, add a test, and add a line to `CHANGELOG.md`. The website serves copies of the spec, which the maintainers refresh.
- **No new runtime dependencies** without a strong reason. The core depends only on the MCP SDK and zod.
- **No network calls**, with one exception: the opt-in embeddings client (`src/embeddings.ts`), which only talks to the endpoint the user configured and refuses non-local addresses without `--allow-remote`. Everything else must stay offline. "Nothing leaves your machine unless you turn semantic search on and point it elsewhere" is a promise.
- **Tests** for behaviour you add or fix. `test/core.test.ts` covers the store, search, lint, sync and handoff; `test/features.test.ts` covers refs, secrets, review, precheck, install and doctor.
- **Say what you didn't verify** in the PR description.

## Reporting bugs

Open an issue with the command you ran, what you expected, what happened, your Node version and OS. For security problems, see [SECURITY.md](SECURITY.md) instead.

## Conduct

Be kind and be specific. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
