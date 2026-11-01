# sea-lite plugin

A work queue for parallel coding agents that can't collide, plus the `work-queue` skill that teaches Claude the claim, work, hand-off loop.

Run several agents against one backlog and the failure mode is not that they are slow: two of them pick up the same ticket, both "finish" it, and the second overwrites the first. Or one dies holding a ticket and nobody else ever touches it. sea-lite is a small MCP server where tickets are **fenced**:

- `sea_next` atomically picks the best eligible ticket **and** claims it. The caller gets a one-time claim token; every write (`sea_update`, `sea_transition`, `sea_link`) must present it. A write from anyone else is refused and names the holder.
- Claims are **leases** (<= 600 s). An agent that dies stops refreshing; the next reader sees the lapsed lease and treats the ticket as free. No sweeper, no cron.
- Tickets carry **typed links** (`depends_on`, `blocks`, `parent_of`, ...). `sea_next` will not hand out a ticket whose predecessors are still open, and the precedence graph stays acyclic on every write.
- `sea_apply` lays down up to 50 tickets and 100 links in one all-or-nothing write.
- Every change is an event on the hash chain that [kronicle-lite](https://github.com/rafe-walker/kronicle-lite) keeps; the same SQLite file holds both.

## What this plugin installs

| Component | What it is |
| --- | --- |
| MCP server `sea-lite` | `npx -y sea-lite@0.6.0 serve` over stdio, pinned to the published npm package |
| Skill `work-queue` | How to take work without colliding: claim, work under the fence, hand off, re-orient after a compaction |

### Tools exposed by the server

Read-only (`readOnlyHint: true`): `sea_get`, `sea_list`, `sea_history`.
Writes (`readOnlyHint: false`): `sea_create`, `sea_apply`, `sea_update`, `sea_transition`, `sea_link`, `sea_claim`, `sea_refresh`, `sea_release`, `sea_next`.

No tool deletes rows from disk, and the chain keeps every prior state. Some writes are still irreversible at the queue level: `sea_transition` into a terminal status (`resolved`, `wont_fix`, `duplicate`, `dropped`, `merged`) has no exit, `sea_link` can remove a link, and `sea_release` in operator role can force-release another actor's claim. Those three set `destructiveHint: true` (as does `sea_update`, which overwrites fields); the additive tools `sea_create`, `sea_apply`, `sea_claim`, `sea_refresh` and `sea_next` set it `false`, so a client prompts for the irreversible writes and not for the queue loop. Every tool sets a `title`; `openWorldHint` is `false` on all of them because the server never leaves the machine.

## Install

```sh
claude plugin marketplace add rafe-walker/isokron-plugins
```

Then inside Claude Code:

```
/plugin install sea-lite@isokron-plugins
```

Requires Node >= 20 on the machine, since the server runs through `npx`. Install `kronicle-lite@isokron-plugins` alongside it if you want the agent to orient against the shared chain (`get_system_state` shows every ticket, status and link change since the agent's last cursor).

## Usage

Start a task that comes from the queue by calling `sea_next`; the `work-queue` skill explains what to do with the claim token, when to `sea_refresh`, and how to `sea_release` or `sea_transition` before stopping. Look at the queue from a shell:

```sh
npx -y sea-lite@0.6.0 list
npx -y sea-lite@0.6.0 show <ticket-id>
npx -y sea-lite@0.6.0 verify
```

## What it runs, stores and sends

- **Runs**: the `sea-lite` npm package at the exact version pinned in `.mcp.json`. `npx` downloads it from the public npm registry the first time and caches it. It depends on `kronicle-lite` (for the chain) and `better-sqlite3` (native).
- **Stores**: tickets, links and claims in the SQLite database under `~/.kronicle-lite` (or `$KRONICLE_LITE_DATA_DIR`), shared with kronicle-lite. Claim tokens are shown once to the caller and never written to the chain.
- **Sends**: nothing. The server has no network code, no telemetry, and no accounts. All data stays on the local machine.

## Configuration

The server inherits Claude Code's environment, so set these in your shell or settings `env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `KRONICLE_LITE_DATA_DIR` | `~/.kronicle-lite` | Directory of the shared SQLite store |
| `SEA_LITE_ACTOR` | `local-agent` | Actor label on claims and writes. Give each parallel agent its own |
| `SEA_LITE_ROLE` | `agent` | `operator` unlocks force release of another actor's claim |
| `SEA_LITE_TRACKS` | `work` | Enabled lifecycle tracks, for example `work,design` |

## Skill source

`skills/work-queue/SKILL.md` is a verbatim copy of [`skills/work-queue/SKILL.md` in rafe-walker/sea-lite](https://github.com/rafe-walker/sea-lite/blob/main/skills/work-queue/SKILL.md) at v0.6.0. The upstream repo is the source of truth; run `node scripts/sync-skills.mjs` from the marketplace root to refresh the copy after an upstream release, then bump `version` in `.claude-plugin/plugin.json` and the pin in `.mcp.json` together.

## Links

- Source and docs: <https://github.com/rafe-walker/sea-lite>
- Issues and support: <https://github.com/rafe-walker/sea-lite/issues>
- Privacy policy: <https://isokron.ai/privacy>
- License: Apache-2.0 (see `LICENSE`)
