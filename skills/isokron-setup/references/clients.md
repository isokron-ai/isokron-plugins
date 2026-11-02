# What isokron-setup writes, per client

Pinned versions: kronicle-lite 0.8.0, sea-lite 0.6.0, cc-anchor v0.5.0
(commit dfc6259),
mcp-catalog-snap 0.1.0. All MCP servers run over stdio on the local machine and
share one store, `~/.kronicle-lite` (or `$KRONICLE_LITE_DATA_DIR`), so every
client orients against the same chain. Sources: each tool's README.

No snippet below passes `--data-dir`. kronicle-lite's exec-time pulse shims
(`kronicle-lite shim install`) check `$KRONICLE_LITE_DATA_DIR` or
`~/.kronicle-lite`; a server started on any other directory writes its reads
and retractions where the shims never look, and a `git push` through the shim
then succeeds against an empty chain. To move the store, export
`KRONICLE_LITE_DATA_DIR` where both the client and the shell running the shims
see it, rather than passing `--data-dir` to the server.

## Claude Code

```sh
claude plugin marketplace add rafe-walker/isokron-plugins --scope user|project
claude plugin marketplace add rafe-walker/cc-anchor#v0.5.0 --scope user|project
claude plugin install kronicle-lite@isokron-plugins       --scope user|project
claude plugin install cc-anchor@cc-anchor                 --scope user|project
claude plugin install sea-lite@isokron-plugins            --scope user|project   # team
```

The plugins bring the MCP servers (`npx -y kronicle-lite@0.8.0 serve`,
`npx -y sea-lite@0.6.0 serve`), the `orient` and `work-queue` skills and the
cc-anchor hooks. `project` scope writes `.claude/settings.json`, which
teammates are prompted to accept.

cc-anchor's hooks include the kronicle-lite **retraction push** (after every
tool call, retractions that landed since the session's cursor are injected
into the context: what the agent relied on, what it says now, the diff) and
the **pulse** (before `deploy|migrate|publish|release|git push|terraform
apply|kubectl apply`, an unreconciled retraction denies the command; chained
`build && deploy` calls are split). Both switch on by themselves because the
kronicle-lite plugin is enabled; nothing to configure. The hooks run the
kronicle-lite CLI that `npx -y kronicle-lite@0.8.0 serve` leaves in the npx
cache. Tune or switch off in `.claude/cc-anchor.json` (`push`, `pulse`,
`pulse_mode: warn`, `pulse_chain: check`, `pulse_match`). The sea-lite lease
heartbeat is on by default once the session holds claims.

team: `.claude/cc-anchor.json` gets `{"claim_guard": true, "scope_guard": true}`
(Stop blocked once while a sea-lite claim is live; Edit/Write inside another
actor's claimed paths denied; SubagentStop release is on automatically when
sea-lite is configured).

Optional, not done by the installer because it edits `~/.claude/settings.json`:
`/cc-anchor:anchor statusline install`.

## Cowork (Claude desktop)

Not scriptable. Customize > Plugins > **Add marketplace** >
`rafe-walker/isokron-plugins` > select **kronicle-lite** > **Install** (and
**sea-lite** for team). Repeat **Add marketplace** with `rafe-walker/cc-anchor#v0.5.0`.
Source: claude.com/docs/cowork/guide/plugins.

## Cursor

`.cursor/mcp.json` (merged key by key; existing servers untouched):

```json
{
  "mcpServers": {
    "kronicle-lite": { "command": "npx", "args": ["-y", "kronicle-lite@0.8.0", "serve", "--actor", "cursor"] },
    "sea-lite": {
      "type": "stdio", "command": "npx", "args": ["-y", "sea-lite@0.6.0", "serve", "--actor", "cursor"],
      "env": { "KRONICLE_LITE_DATA_DIR": "${userHome}/.kronicle-lite" }
    }
  }
}
```

The sea-lite entry is the sea-lite README's Cursor entry, pinned. cc-anchor's
scope-guard hook calls `sea-lite scope-check` without `--actor`; it resolves the
live server's identity (`cursor#<session>`), so the agent's own claimed paths
still pass.

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
args = ["-y", "kronicle-lite@0.8.0", "serve", "--actor", "codex"]
# isokron:end kronicle-lite

# isokron:begin sea-lite (…)
[mcp_servers.sea_lite]
command = "npx"
args = ["-y", "sea-lite@0.6.0", "serve", "--actor", "codex"]
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
  "kronicle-lite": { "type": "stdio", "command": "npx", "args": ["-y", "kronicle-lite@0.8.0", "serve", "--actor", "copilot"] },
  "sea-lite":      { "type": "stdio", "command": "npx", "args": ["-y", "sea-lite@0.6.0", "serve", "--actor", "copilot"] }
} }
```

Copilot coding agent and code review read MCP config from repository
**Settings > Copilot > MCP servers**, which no file in the repo can set. The
installer prints this for the user to paste (read-only tools allowlisted, as
GitHub recommends):

```json
{ "mcpServers": {
  "kronicle-lite": { "type": "local", "command": "npx",
    "args": ["-y", "kronicle-lite@0.8.0", "serve", "--actor", "copilot"],
    "tools": ["get_system_state", "audit_assumptions", "recall", "verify", "verify_chain"] }
} }
```

team adds `sea-lite` the same way (`serve --actor copilot`,
`"env": { "SEA_LITE_ROLE": "agent" }`, tools `sea_get`, `sea_list`,
`sea_history`, `sea_scope_check`).

## Hermes Agent (Nous Research)

Not written by the installer; paste into `~/.hermes/config.yaml` under
`mcp_servers` (merge with any servers already there), then `/reload-mcp` in a
session or restart. Source:
hermes-agent.nousresearch.com/docs/user-guide/features/mcp and
/docs/reference/mcp-config-reference.

```yaml
mcp_servers:
  kronicle-lite:
    command: "npx"
    args: ["-y", "kronicle-lite@0.8.0", "serve", "--actor", "hermes"]
    env:
      KRONICLE_LITE_DATA_DIR: "${KRONICLE_LITE_DATA_DIR}"
    connect_timeout: 120
  sea-lite:            # team
    command: "npx"
    args: ["-y", "sea-lite@0.6.0", "serve", "--actor", "hermes"]
    env:
      KRONICLE_LITE_DATA_DIR: "${KRONICLE_LITE_DATA_DIR}"
    connect_timeout: 120
```

- Hermes does not hand stdio servers your shell environment, only a baseline
  (`PATH`, `HOME`, `USER`, `LANG`, `TERM`, `SHELL`, `TMPDIR`, `XDG_*`, …) plus
  the entry's `env`. The `KRONICLE_LITE_DATA_DIR` line forwards the variable
  when it is set; when it is unset Hermes drops the line, and the server uses
  `~/.kronicle-lite`, the same store the shims check.
- `connect_timeout` (default 60 s) also bounds `initialize`; 120 leaves room for
  the first `npx` download.
- Tools register as `mcp_kronicle_lite_get_system_state`,
  `mcp_sea_lite_sea_claim`, …; `tools.include` / `tools.exclude` take the
  original names.
- sea-lite keys tickets by the git repository of its working directory. Hermes
  starts the server in the session's pinned working directory, else in its own
  process directory; add `cwd: /path/to/repo` if Hermes runs from elsewhere.
- Hermes loads `.hermes.md`, else `AGENTS.md`, else `CLAUDE.md` as project
  context, so the wake contract reaches it through `AGENTS.md` unless the
  project has a `.hermes.md`.

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
- `.gitignore`: `.isokron/`, `.claude/cc-anchor/` (runtime), `.kronicle-lite/`
  (Copilot; earlier versions of the coding-agent JSON kept a store in the repo).
- kronicle-lite docs `<repo>-readme`, `<repo>-claude-md` / `<repo>-agents-md`,
  `<repo>-adr-<name>`; re-seeding skips unchanged files.
- `.claude/anchor.md`: `Project:` and `Goal:`; the first orient cursor goes to
  `.claude/cc-anchor/cursor` so the card carries it.
