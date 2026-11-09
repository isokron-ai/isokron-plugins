---
name: isokron-setup
description: One-command installer for the IsoKron agent toolset (kronicle-lite memory chain + orient, cc-anchor compaction card, sea-lite work queue, mcp-catalog-snap CI). Detects Claude Code, Cowork, Cursor, Codex and GitHub Copilot plus the project, shows one plan, asks once, then installs, seeds the wake contract and the chain, runs the first orient and verifies. Use when the user says "set up isokron", "install kronicle-lite / sea-lite / cc-anchor", "set up orient", "isokron-setup", or asks to uninstall them.
license: Apache-2.0
compatibility: Needs node >= 20, npx, git; jq and bash for cc-anchor hooks. Network to the npm registry and GitHub on first install. Works in Claude Code, Cursor, Codex, GitHub Copilot and any Agent Skills client that can run shell commands; Cowork gets printed click steps.
metadata:
  author: IsoKron
  homepage: https://isokron.ai
  version: "0.1.0"
---

# isokron-setup

Take a project from zero to a working **orient loop** in one pass:
detect → plan → **ask once** → install → seed → verify. Every write is
idempotent, backed up once as `<file>.bak-isokron`, and recorded in
`.isokron/setup-manifest.json` so `uninstall.mjs` can reverse it.

## Where the scripts are

`scripts/` sits next to this file. Claude Code substitutes `${CLAUDE_SKILL_DIR}`
in the commands below with this folder; run them exactly as written (no
`S=…` prefix, so they match a `Bash(node:*)` permission). In other clients
replace `${CLAUDE_SKILL_DIR}` with the folder this SKILL.md was loaded from
(typically `.agents/skills/isokron-setup`, `.claude/skills/isokron-setup` or
`~/.cursor/skills/isokron-setup`). Run every command from the project directory.

## Hard rules

1. **Write nothing before the user says yes to the plan.** `detect.mjs` is
   read-only. `install.mjs` refuses without `--yes`.
2. **Ask exactly once.** In Claude Code use the **AskUserQuestion** tool. In any
   other client ask one explicit question in chat and wait for the answer; do
   not treat silence or an earlier general request as a yes.
3. **User-global config needs its own yes.** If the plan lists
   `User-global changes` (e.g. `~/.codex/config.toml`, user-scope Claude
   plugins), the question must name them; pass `--user-global-ok` only if the
   user picked the option that includes them. Otherwise use `--scope-mode project`.
4. Never hand-edit the files the scripts manage; re-run the script instead.
   Never pass `--yes` to `uninstall.mjs` without asking either.

## 1. Detect

```sh
node "${CLAUDE_SKILL_DIR}/scripts/detect.mjs" --text
```

It prints the clients it found (Claude Code CLI / `~/.claude`, Claude desktop
for Cowork, `.cursor/`, `~/.codex/config.toml`, `.vscode/` or
`.github/copilot-*`), the project (git root, CLAUDE.md / AGENTS.md, monorepo,
README, `docs/adr/*.md`, whether it ships an MCP server) and the plan for the
default `memory` profile. `--profile team|ci`, `--clients a,b`, `--adr all|a.md,b.md`,
`--goal "…"`, `--scope-mode project` change the plan; drop `--text` for JSON.
Run it again with `--profile team` and, if the repo ships an MCP server,
`--profile ci` so you can show the deltas.

## 2. Plan, then ask once

Show the user the `--text` plan (trim nothing that writes a file or runs a
command). Then ask **one** AskUserQuestion with up to four questions:

| Question | Options |
| --- | --- |
| Profile | `memory` — kronicle-lite + orient + cc-anchor (Recommended) · `team` — adds sea-lite, work-queue skill, scope guard + claim/stop hooks · `ci` — team + mcp-catalog-snap baseline and GitHub Action (only offer when detect found an MCP server) |
| Apply? | `Apply, including the user-global changes listed` · `Project files only` (`--scope-mode project`) · `Cancel` |
| Anchor goal (what are you working on now?) | `Skip, set it later` · free text via Other |
| ADRs to seed into the chain (only if detect listed some) | `All N` · `None` · or name them via Other |

Clients default to everything detected; mention that, and honor a correction
in the free-text answer. If the user cancels, stop.

## 3–4. Install and seed

```sh
node "${CLAUDE_SKILL_DIR}/scripts/install.mjs" --profile <p> [--clients a,b] [--goal "<answer>"] \
  [--adr all|a.md,b.md] [--scope-mode project] --yes [--user-global-ok]
```

What it does, per client (exact snippets in `references/clients.md`):

- **Claude Code**: `claude plugin marketplace add isokron-ai/isokron-plugins`,
  `… add isokron-ai/cc-anchor#v0.6.0`, `claude plugin install kronicle-lite@isokron-plugins`,
  `cc-anchor@cc-anchor` (+ `sea-lite@isokron-plugins` for team). Scope `user`
  for memory, `project` for team or `--scope-mode project`.
- **Cowork**: cannot be scripted; print the click path from the plan.
- **Cursor**: merges `.cursor/mcp.json`; runs cc-anchor `cursor install`
  (hooks port) from the plugin cache or a clone of the pinned cc-anchor commit
  (tag `v0.6.0` @ 0c3c183) in a temp dir.
- **Codex**: appends marked `[mcp_servers.*]` tables to `~/.codex/config.toml`
  (or `.codex/config.toml` with `--scope-mode project`); never rewrites other tables.
- **Copilot**: merges `.vscode/mcp.json` (`servers`); prints the coding-agent
  JSON for repo Settings > Copilot > MCP servers.
- **Hermes Agent**: not detected or written; if the user runs Hermes, show the
  `~/.hermes/config.yaml` snippet from `references/clients.md`.
- **team**: `.claude/cc-anchor.json` `claim_guard` + `scope_guard` (Claude Code and Cursor hooks).
- **ci**: `.mcp-catalog.json`, baseline snapshot, `.github/workflows/mcp-catalog.yml`.
  Ask for the server launch command if detect could not guess it (`--server-cmd`).
- **Seed**: `<!-- isokron:begin/end -->` wake-contract block in CLAUDE.md /
  AGENTS.md, `.gitignore` block, `kronicle-lite put` of README + CLAUDE.md /
  AGENTS.md + chosen ADRs, anchor card `set project` / `set goal`, first `orient`.

Show the user the first-orient output it prints. A `conflict` line means the
user already had that key or table: it was left alone; tell them. An
`unparseable` line (JSONC with comments) means add the printed snippet by hand.

## 5. Verify

```sh
node "${CLAUDE_SKILL_DIR}/scripts/verify.mjs"
```

Runs `kronicle-lite doctor` when the CLI has it (0.4.0+), otherwise
`verify-chain` plus a real `recall` over MCP stdio against the seeded docs;
`claude plugin list`; config checks per client (TOML parsed with `tomllib`
when python3 exists); cc-anchor `doctor`. Paste its one-screen summary to the
user as the final message. If a check fails, say which and offer uninstall.

## 6. Uninstall

```sh
node "${CLAUDE_SKILL_DIR}/scripts/uninstall.mjs"          # dry run: lists what it will reverse
node "${CLAUDE_SKILL_DIR}/scripts/uninstall.mjs" --yes    # after the user agrees
```

Reverses the manifest newest-first: uninstalls only the plugins and
marketplaces it added, restores `.bak-isokron` originals when the file is
unchanged since install (otherwise removes just our key / table / block),
deletes files and directories it created when empty. The kronicle-lite chain is
append-only: seeded docs stay unless `--purge-store` and install created the
store. No manifest? `--no-manifest --yes` strips the marked blocks and restores
backups.

## Environment overrides (tests, air-gapped installs)

`ISOKRON_HOME` (home dir), `KRONICLE_LITE_DATA_DIR`, `ISOKRON_KRONICLE_LITE_BIN`
and `ISOKRON_CATALOG_SNAP_BIN` (CLI path instead of pinned npx),
`ISOKRON_CC_ANCHOR_DIR` (a cc-anchor checkout), `ISOKRON_MARKETPLACE_SOURCE` /
`ISOKRON_CC_ANCHOR_SOURCE` (local marketplace paths), `--no-probe` (skip
`claude plugin list` during detect).
