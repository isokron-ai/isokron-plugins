# isokron-setup plugin

One skill that takes a project from zero to a working **orient loop** in whatever coding agent you use. It finds the agent (Claude Code, Cowork, Cursor, Codex, GitHub Copilot) and the project, shows a single plan of every file it will write and every command it will run, asks you once, then installs the IsoKron tools, seeds them with your project's own docs, runs the first `orient` and verifies the result. Every change is recorded and reversible.

## Use it

```sh
claude plugin marketplace add rafe-walker/isokron-plugins
claude plugin install isokron-setup@isokron-plugins
```

Then, in the project, ask Claude to "set up isokron" (or run `/isokron-setup:isokron-setup`). Outside Claude Code the same skill installs with the cross-client Agent Skills CLI:

```sh
npx skills add rafe-walker/isokron-plugins --skill isokron-setup
```

## What it installs

| Profile | Tools |
| --- | --- |
| `memory` (default) | kronicle-lite MCP server + `orient` skill, cc-anchor (anchor card that survives compaction) |
| `team` | memory + sea-lite work queue + `work-queue` skill + cc-anchor claim guard (Stop) and scope guard (Edit/Write) |
| `ci` | team + mcp-catalog-snap baseline of your MCP server's `tools/list` and a GitHub Action that fails on drift (only for repos that ship an MCP server) |

Per client: Claude Code gets the plugins through `claude plugin marketplace add` / `claude plugin install`; Cursor gets `.cursor/mcp.json` entries and cc-anchor's hooks port; Codex gets marked `[mcp_servers.*]` tables in `~/.codex/config.toml`; Copilot gets `.vscode/mcp.json` plus the JSON to paste into repository Settings for the coding agent; Cowork gets the three-click path. The project gets a marked wake-contract block in `CLAUDE.md` / `AGENTS.md`, its README, CLAUDE.md / AGENTS.md and chosen ADRs stored in the kronicle-lite chain, and an anchor card with the project and goal.

## Safety

- Nothing is written until you answer the plan question; user-global files (for example `~/.codex/config.toml` or user-scope plugins) are named in the question and need that answer too.
- Existing keys, TOML tables and hooks are never overwritten: a clash is reported and left alone. Files that are not strict JSON are not touched; you get the snippet to add by hand.
- Each changed file is backed up once as `<file>.bak-isokron`; each change is recorded in `.isokron/setup-manifest.json`. `uninstall.mjs --yes` reverses them newest first and only removes plugins and marketplaces it added.

## What it runs and sends

The skill's scripts use only Node's standard library and run locally. They call `claude`, `git`, `npx` (the pinned packages `kronicle-lite@0.4.0`, `sea-lite@0.2.0`, `mcp-catalog-snap@0.1.0` from the public npm registry) and, for Cursor without Claude Code, `git clone` of `github.com/rafe-walker/cc-anchor` at tag `v0.2.0` into a temporary directory. Data stays in `~/.kronicle-lite` on your machine; nothing is sent to IsoKron.

Source: `skills/isokron-setup/` in [rafe-walker/isokron-plugins](https://github.com/rafe-walker/isokron-plugins). License: Apache-2.0.
