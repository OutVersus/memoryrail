# Connect your agent

MemoryRail reaches an agent in two ways:

1. **The MCP server** (`memoryrail serve`): the agent calls tools like `precheck`, `recall` and `remember`. This is the full experience.
2. **Generated instruction files** (`memoryrail sync`): your rules, decisions and failed attempts are written into `AGENTS.md`, `CLAUDE.md` and `.cursor/rules/memoryrail.mdc`. Agents that read those files see the memory even without MCP, but can't write to it.

Install the CLI first: `npm install -g memoryrail` (Node 20 or newer). Then pick your client below.

> **How much of this is tested.** The server is tested with the official MCP SDK client over stdio, and the config shapes below were checked against each vendor's documentation (linked in each section, checked 2026-10-10). We have **not** run Codex or any Copilot surface against MemoryRail ourselves. If a snippet doesn't work, please open an issue with the client version and the error.

## How the server finds your memory

The server looks for `.memoryrail/` starting in the directory the client launches it in, then walks up. If your client launches servers somewhere else (a user-level config shared by many projects, or a cloud runner), point it at the repo:

```
memoryrail serve --root /path/to/repo
```

or set `MEMORYRAIL_ROOT=/path/to/repo` in the server's environment.

## Claude Code

```sh
memoryrail install claude
```

This adds a `memoryrail` server to the project's `.mcp.json`, keeping any other servers. Restart Claude Code. `CLAUDE.md` is updated by `memoryrail sync`.

## Cursor

```sh
memoryrail install cursor
```

This adds the server to `.cursor/mcp.json`. `memoryrail sync` also writes `.cursor/rules/memoryrail.mdc` (always applied).

## OpenAI Codex

Codex reads MCP servers from `~/.codex/config.toml`, or from `.codex/config.toml` in a project (trusted projects only). Add one with the CLI:

```sh
codex mcp add memoryrail -- memoryrail serve
```

or edit the TOML:

```toml
[mcp_servers.memoryrail]
command = "memoryrail"
args = ["serve"]
```

If you haven't installed MemoryRail globally, use `command = "npx"` and `args = ["-y", "memoryrail", "serve"]`. The server looks for `.memoryrail/` from the directory Codex launches it in (we haven't confirmed which directory that is for a user-level config), so for a single project you can pin it with `args = ["serve", "--root", "/path/to/repo"]`.

**Instructions:** Codex reads `AGENTS.md` from the project root down to your working directory, which `memoryrail sync` writes. By default Codex **stops reading after 32 KiB** of combined instructions (`project_doc_max_bytes`), so a large memory can be silently cut off. `memoryrail doctor` warns when `AGENTS.md` passes 32 KiB; archive stale memories (`memoryrail forget <ref>`) or raise the limit in your Codex config.

Sources: [Codex MCP](https://developers.openai.com/codex/mcp), [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md).

## GitHub Copilot

Copilot has several surfaces, and they are configured differently.

### Copilot in VS Code

Create `.vscode/mcp.json` in the workspace. The top-level key is `servers` (not `mcpServers`):

```json
{
  "servers": {
    "memoryrail": {
      "type": "stdio",
      "command": "memoryrail",
      "args": ["serve"]
    }
  }
}
```

MCP tools are available in Copilot's agent mode. VS Code starts the server with the workspace folder as its working directory by default, so no `--root` is needed.

Source: [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

### Copilot CLI

```sh
copilot mcp add memoryrail -- memoryrail serve
```

This writes to `~/.copilot/mcp-config.json`. To configure it by hand, or per project in `.github/mcp.json`, the top-level key is `mcpServers` and each server has a `type`:

```json
{
  "mcpServers": {
    "memoryrail": {
      "type": "local",
      "command": "memoryrail",
      "args": ["serve"],
      "tools": ["*"]
    }
  }
}
```

Copilot CLI can also read a project-level `.mcp.json`, but expects its own format. The entry that `memoryrail install claude` writes has no `type` field, which the Copilot CLI docs show, so use `copilot mcp add` or the JSON above for Copilot CLI instead of relying on that file.

Source: [Adding MCP servers for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

### Copilot cloud agent (assigned issues and pull requests)

The cloud agent doesn't read a file from your repo for MCP. A repository administrator pastes JSON into the repository's settings on GitHub.com (under Copilot, in the cloud/coding agent section; the exact menu name has changed between releases). `tools` is required:

```json
{
  "mcpServers": {
    "memoryrail": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "memoryrail", "serve"],
      "tools": ["resume", "precheck", "recall", "list_memories"]
    }
  }
}
```

Notes:

- The cloud agent runs on GitHub's side, not on your machine, so MemoryRail isn't installed there. Use `npx`.
- The example allows **read-only** tools. Add `"remember"` and `"handoff"` to let the agent write memory; its changes then appear in the pull request for you to review. Turning on `memoryrail config review agents` makes those writes wait for your approval.
- The cloud agent supports MCP **tools** only, not resources or prompts. MemoryRail exposes tools only, so nothing is lost.
- **Not verified:** which directory the cloud agent starts MCP servers in. If the server reports that it can't find `.memoryrail/`, add `"--root", "."` or the checkout path to `args`.

Source: [Configure MCP servers for the Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/agents/copilot-coding-agent/extending-copilot-coding-agent-with-mcp).

### Copilot instructions

- The Copilot cloud agent and Copilot CLI read `AGENTS.md` from the repository root, which `memoryrail sync` writes. ([Changelog](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/))
- Copilot also reads **`.github/copilot-instructions.md`**. `sync` doesn't write that file by default. To have it written there too, add `--also`:

  ```sh
  memoryrail sync --also .github/copilot-instructions.md
  ```

  Pass the same flag to `sync --check` in CI. Existing content in that file is kept; MemoryRail only manages the block between its markers. ([Copilot custom instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot))

## Any other MCP client

Register this as a stdio server in the client's MCP config:

```
command: memoryrail
args:    serve
```

Clients differ in file name and top-level key (`mcpServers` or `servers`) and some require a `type`; check the client's docs. If the client can't use MCP, the same commands work in a terminal (`memoryrail precheck "..." --file path`), and any tool that reads `AGENTS.md` still gets the summary from `memoryrail sync`.

## Check it worked

```sh
memoryrail doctor
```

reports whether memory is valid, synced, and registered for Claude Code or Cursor (it doesn't detect Codex or Copilot config). To test the server itself, ask your agent to call `list_memories`; it should return the memories in the repo.
