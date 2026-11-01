# What isokron-setup writes, per client

Pinned versions: kronicle-lite 0.7.0, sea-lite 0.4.0, cc-anchor v0.3.0,
mcp-catalog-snap 0.1.0. All MCP servers run over stdio on the local machine and
share one store, `~/.kronicle-lite` (or `$KRONICLE_LITE_DATA_DIR`), so every
client orients against the same chain. Sources: each tool's README.

## Claude Code

```sh
claude plugin marketplace add rafe-walker/isokron-plugins --scope user|project
claude plugin marketplace add rafe-walker/cc-anchor       --scope user|project
claude plugin install kronicle-lite@isokron-plugins       --scope user|project
claude plugin install cc-anchor@cc-anchor                 --scope user|project
claude plugin install sea-lite@isokron-plugins            --scope user|project   # team
```

The plugins bring the MCP servers (`npx -y kronicle-lite@0.7.0 serve`,
`npx -y sea-lite@0.4.0 serve`), the `orient` and `work-queue` skills and the
cc-anchor hooks. `project` scope writes `.claude/settings.json`, which
teammates are prompted to accept.

team: `.claude/cc-anchor.json` gets `{"claim_guard": true, "scope_guard": true}`
(Stop blocked once while a sea-lite claim is live; Edit/Write inside another
actor's claimed paths denied; SubagentStop release is on automatically when
sea-lite is configured).

Optional, not done by the installer because it edits `~/.claude/settings.json`:
`/cc-anchor:anchor statusline install`.

## Cowork (Claude desktop)

Not scriptable. Customize > Plugins > **Add marketplace** >
`rafe-walker/isokron-plugins` > select **kronicle-lite** > **Install** (and
**sea-lite** for team). Repeat **Add marketplace** with `rafe-walker/cc-anchor`.
Source: claude.com/docs/cowork/guide/plugins.

## Cursor

`.cursor/mcp.json` (merged key by key; existing servers untouched):

```json
{
  "mcpServers": {
    "kronicle-lite": { "command": "npx", "args": ["-y", "kronicle-lite@0.7.0", "serve", "--actor", "cursor"] },
    "sea-lite": {
      "type": "stdio", "command": "npx", "args": ["-y", "sea-lite@0.4.0", "serve"],
      "env": { "KRONICLE_LITE_DATA_DIR": "${userHome}/.kronicle-lite" }
    }
  }
}
```

sea-lite runs without `--actor` in Cursor on purpose: cc-anchor's scope-guard
hook calls `sea-lite scope-check` without one, and the server and the hook must
share an actor label or the agent's own claimed paths read as someone else's.

Hooks: `node <cc-anchor>/scripts/anchor.mjs cursor install --root <project>`
copies the adapter to `.cursor/hooks/cc-anchor/` and merges six entries into
`.cursor/hooks.json` (existing hooks kept). Skills: `.agents/skills/orient/`
(and `work-queue/` for team), which Cursor reads.

## Codex

`~/.codex/config.toml` (or `.codex/config.toml` with `--scope-mode project`;
Codex reads that only in a trusted project). Appended as marked blocks:

```toml
# isokron:begin kronicle-lite (added by isokron-setup; its uninstall removes this block)
[mcp_servers.kronicle-lite]
command = "npx"
args = ["-y", "kronicle-lite@0.7.0", "serve", "--actor", "codex"]
# isokron:end kronicle-lite

# isokron:begin sea-lite (…)
[mcp_servers.sea_lite]
command = "npx"
args = ["-y", "sea-lite@0.4.0", "serve", "--actor", "codex"]
env_vars = ["KRONICLE_LITE_DATA_DIR"]
startup_timeout_sec = 20
default_tools_approval_mode = "writes"

[mcp_servers.sea_lite.tools.sea_transition]
approval_mode = "prompt"
# isokron:end sea-lite
```

If `mcp_servers.kronicle-lite` / `sea_lite` already exists in any spelling
(table, dotted key, inline), the block is not added. Skills: `.agents/skills/`.
No hook surface: guards are carried by the work-queue skill.

## GitHub Copilot

VS Code agent mode, `.vscode/mcp.json` (VS Code format, top-level `servers`):

```json
{ "servers": {
  "kronicle-lite": { "type": "stdio", "command": "npx", "args": ["-y", "kronicle-lite@0.7.0", "serve", "--actor", "copilot"] },
  "sea-lite":      { "type": "stdio", "command": "npx", "args": ["-y", "sea-lite@0.4.0", "serve", "--actor", "copilot"] }
} }
```

Copilot coding agent and code review read MCP config from repository
**Settings > Copilot > MCP servers**, which no file in the repo can set. The
installer prints this for the user to paste (read-only tools allowlisted, as
GitHub recommends):

```json
{ "mcpServers": {
  "kronicle-lite": { "type": "local", "command": "npx",
    "args": ["-y", "kronicle-lite@0.7.0", "serve", "--data-dir", "./.kronicle-lite", "--actor", "copilot"],
    "tools": ["get_system_state", "audit_assumptions", "recall", "verify", "verify_chain"] }
} }
```

## ci profile (repos that ship an MCP server)

`.mcp-catalog.json` → `npx -y mcp-catalog-snap@0.1.0 snapshot` →
`.mcp-catalog/<name>.json` baseline, and `.github/workflows/mcp-catalog.yml`
running `rafe-walker/mcp-catalog-snap@v0.1.0` after `npm ci` /
`npm run build --if-present`. The job fails on any byte drift of `tools/list`.

## Seeded into every project

- `CLAUDE.md` and/or `AGENTS.md`: the wake contract between
  `<!-- isokron:begin -->` and `<!-- isokron:end -->`. Skipped when the file
  already mentions `get_system_state` outside such a block. A CLAUDE.md that
  only imports `@AGENTS.md` gets it through AGENTS.md.
- `.gitignore`: `.isokron/`, `.claude/cc-anchor/` (runtime), `.kronicle-lite/` (Copilot).
- kronicle-lite docs `<repo>-readme`, `<repo>-claude-md` / `<repo>-agents-md`,
  `<repo>-adr-<name>`; re-seeding skips unchanged files.
- `.claude/anchor.md`: `Project:` and `Goal:`; the first orient cursor goes to
  `.claude/cc-anchor/cursor` so the card carries it.
