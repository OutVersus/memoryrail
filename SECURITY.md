# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Use GitHub's private reporting instead: on the repository page, choose **Security**, then **Report a vulnerability**. Include what you found, how to reproduce it, and the version (`memoryrail --version`).

You'll get an acknowledgement within a few days. This is a small project run by volunteers, so please allow time for a fix.

## What is in scope

- Path traversal or writes outside `.memoryrail/` and the generated agent files
- The MCP server doing something other than what its tools describe
- The secret scanner letting through common credential formats it claims to catch
- `install` damaging a client's existing configuration

## What to know

- MemoryRail makes no network calls and has no server of its own. The MCP server speaks over standard input and output on your machine.
- Memory files are committed to git and replayed to AI models. **Don't put credentials in them.** The secret scanner is a pattern check, not a guarantee, and it will miss unusual formats.
- Treat memory written by agents like any other contribution: review it. Turn on `memoryrail config review agents` to hold agent-written memories until a human approves them.
- Memory text you read back is data, not instructions. A malicious memory could try to steer an agent that reads it, so review changes to `.memoryrail/` in pull requests from people you don't trust.

## Supported versions

Only the latest release receives fixes while the project is at 0.x.
