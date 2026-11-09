# kronicle-lite plugin

A local-first MCP server that tells your agent when its notes went stale, plus the `orient` skill that teaches Claude to use it.

kronicle-lite is a small SQLite-backed document store where every write is an event on a hash chain, every `recall()` hit carries a signed Ed25519 receipt that later answers "is this still current?" (`VERIFIED`, `SUPERSEDED`, `TOMBSTONED`, `UNVERIFIED`), and `get_system_state` gives the agent an orient call: pass your last cursor, get exactly what changed since, a drift banner when you have been away too long, and a retraction list of things you may have relied on that are now wrong.

It is one process, one file, no accounts. It is **not** a memory server; it sits beside whatever you use for semantic recall and guards the notes whose staleness would hurt.

## What this plugin installs

| Component | What it is |
| --- | --- |
| MCP server `kronicle-lite` | `npx -y kronicle-lite@0.10.0 serve` over stdio, pinned to the published npm package |
| Skill `orient` | The wake protocol: when to call `get_system_state`, how to read the drift banner and retractions, and the reconciliation discipline before any write |

### Tools exposed by the server

Read-only (`readOnlyHint: true`): `get_system_state`, `audit_assumptions`, `recall`, `verify`, `verify_chain`, `anchor_status`, `audit_query`.
Append-only writes (`readOnlyHint: false`, `destructiveHint: false`): `checkpoint_chain`, `put_document`, `supersede_block`, `audit_record`.
Destructive (`destructiveHint: true`): `tombstone_block` retires a block (the chain keeps the history; nothing is deleted from disk). `apply` runs up to 50 put / supersede / tombstone operations in one transaction, with a `dry_run` preview.

- `anchor_status`: the last off-box anchor and whether the local chain still matches it; `remote: true` also asks the anchor service.
- `audit_record` / `audit_query`: append MCP-audit evidence (catalog snapshots, measured calls, findings, gate results, fixes, regressions) to the chain and query it by audit id or catalog fingerprint.

Every tool sets a `title` and MCP annotations. `openWorldHint` is `true` on `checkpoint_chain` and `anchor_status`, the two tools that can contact the anchor service, and `false` on the other eleven.

## Install

```sh
claude plugin marketplace add isokron-ai/isokron-plugins
```

Then inside Claude Code:

```
/plugin install kronicle-lite@isokron-plugins
```

Requires Node >= 20 on the machine, since the server runs through `npx`.

## Usage

Type the bare word `orient` at the start of a session, after a compaction, or whenever a tool result disagrees with what you remember. The skill calls `get_system_state` with your previous cursor and walks you through reconciling retractions before you act. Pair it with the two-line wake contract from the upstream repo's [`examples/.claude/CLAUDE.md`](https://github.com/isokron-ai/kronicle-lite/tree/main/examples) if you want every session to re-ground automatically.

Store a document from a shell to see the chain in action:

```sh
npx -y kronicle-lite@0.10.0 put runbook ./runbook.md --title "Runbook"
npx -y kronicle-lite@0.10.0 orient --actor me
npx -y kronicle-lite@0.10.0 verify-chain
```

## What it runs, stores and sends

- **Runs**: the `kronicle-lite` npm package at the exact version pinned in `.mcp.json`. `npx` downloads it from the public npm registry the first time and caches it. Its native dependency is `better-sqlite3`.
- **Stores**: a SQLite database (`kronicle-lite.db`), an Ed25519 signing key (`signing-key.pem`, mode 0600), a cursor HMAC secret (`cursor-secret`, mode 0600) and `config.json` (anchor service URL and optional license key, mode 0600) in `~/.kronicle-lite`, or in `$KRONICLE_LITE_DATA_DIR` if set. After an anchor call it also keeps the service key list (`anchor-keys.cache.json`, mode 0600) and the countersigned receipts.
- **Sends**: only on two tool calls, to the anchor service (`https://anchor.isokron.ai` by default; `KRONICLE_ANCHOR_URL` or `anchor_url` in `config.json` to change it; `http://` is refused except on loopback):
  - `checkpoint_chain` with `push: true`, when a license key is configured: the checkpoint (chain id, sequence range, leaf count, Merkle root, key id, signature) and the chain's Ed25519 public key, with the license key as a bearer token. It first fetches the service key list (`/.well-known/anchor-keys.json`).
  - `anchor_status` with `remote: true`, once the chain has an anchor: reads this chain's anchor listing (`/v1/chains/<chain_id>`) and the service key list. The request carries the chain id only.

  Document contents, block text and event payloads never leave the machine: the service receives the root and its signature, not the leaves. Every other tool is local only. No telemetry.

## Configuration

The server inherits Claude Code's environment, so set these in your shell or settings `env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `KRONICLE_LITE_DATA_DIR` | `~/.kronicle-lite` | Where the database and keys live. Point sea-lite at the same directory to share one chain |
| `KRONICLE_LITE_ACTOR` | `local-agent` | Actor label recorded on cursors and writes |
| `KRONICLE_ANCHOR_URL` | `https://anchor.isokron.ai` | Anchor service used by `checkpoint_chain` (`push: true`) and `anchor_status` (`remote: true`) |
| `KRONICLE_ANCHOR_KEY` | unset | Anchor service license key; without it `push: true` sends nothing |

## Skill source

`skills/orient/SKILL.md` is a verbatim copy of [`skills/orient/SKILL.md` in isokron-ai/kronicle-lite](https://github.com/isokron-ai/kronicle-lite/blob/main/skills/orient/SKILL.md) at v0.10.0. The upstream repo is the source of truth; run `node scripts/sync-skills.mjs` from the marketplace root to refresh the copy after an upstream release, then bump `version` in `.claude-plugin/plugin.json` and the pin in `.mcp.json` together.

## Links

- Source and docs: <https://github.com/isokron-ai/kronicle-lite>
- Issues and support: <https://github.com/isokron-ai/kronicle-lite/issues>
- Privacy policy: <https://isokron.ai/privacy>
- License: Apache-2.0 (see `LICENSE`)
