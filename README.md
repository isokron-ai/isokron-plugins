# isokron-plugins

Claude Code plugin marketplace for [IsoKron](https://isokron.ai)'s local-first MCP servers. Each server plugin bundles one published npm server with the skill that teaches Claude how to use it; `isokron-setup` installs all of them, in any coding agent, with one command.

| Plugin | Server | What it does |
| --- | --- | --- |
| [`kronicle-lite`](plugins/kronicle-lite/) | [`kronicle-lite@0.10.0`](https://www.npmjs.com/package/kronicle-lite) | Hash-chained document store with signed retrieval receipts and an **orient** protocol that tells the agent when its notes went stale |
| [`sea-lite`](plugins/sea-lite/) | [`sea-lite@0.7.1`](https://www.npmjs.com/package/sea-lite) | Fenced **work queue** for parallel coding agents: leased claims, typed links, atomic batches, hash-chained history |
| [`isokron-setup`](plugins/isokron-setup/) | skill only (no server) | **One-command installer** for the whole toolset in Claude Code, Cursor, Codex, Copilot (and the click path for Cowork): plan, one question, install, seed, first orient, verify; fully reversible |

Both servers run over stdio on the local machine, store everything in `~/.kronicle-lite`, and send nothing anywhere. They share one SQLite file, so an agent that has both can `orient` against the same chain its tickets live on.

## One-command setup

From your project, in any coding agent that runs shell commands:

```sh
npx skills add isokron-ai/isokron-plugins --skill isokron-setup
```

then ask the agent to "set up isokron" (the `skills` CLI needs Node >= 22.20; the installer itself needs Node >= 20). In Claude Code you can use the plugin instead:

```sh
claude plugin marketplace add isokron-ai/isokron-plugins && claude plugin install isokron-setup@isokron-plugins
```

The skill detects your client(s) (Claude Code, Cowork, Cursor, Codex, GitHub Copilot) and the project, prints one plan listing every file it will write and every command it will run, and asks once (user-global files such as `~/.codex/config.toml` are named in that question). Then it installs the profile you picked:

| Profile | Installs |
| --- | --- |
| `memory` (default) | kronicle-lite + `orient`, cc-anchor (anchor card that survives compaction; kronicle-lite retraction push after each tool call and a pulse that holds Bash to read-only calls while a change is pending) |
| `team` | memory + sea-lite + `work-queue`, cc-anchor claim guard (Stop) and scope guard (Edit/Write) |
| `ci` | team + an mcp-catalog-snap baseline and GitHub Action, for repos that ship an MCP server |

It seeds the project (a marked wake-contract block in `CLAUDE.md` / `AGENTS.md`; README, CLAUDE.md / AGENTS.md and chosen ADRs put into the chain; the anchor card's project and goal), runs the first `orient` as the same actor your agent's server uses so the next session resumes from that cursor, and verifies (`verify-chain`, a real `recall` over MCP stdio, `claude plugin list`, per-client config checks). Every change is backed up once as `<file>.bak-isokron` and recorded in `.isokron/setup-manifest.json`; `uninstall.mjs --yes` reverses it. Details: [`plugins/isokron-setup/README.md`](plugins/isokron-setup/README.md), [`skills/isokron-setup/references/clients.md`](skills/isokron-setup/references/clients.md).

## Install the servers directly

Add the marketplace once:

```sh
claude plugin marketplace add isokron-ai/isokron-plugins
```

Then install either or both plugins from inside Claude Code:

```
/plugin install kronicle-lite@isokron-plugins
/plugin install sea-lite@isokron-plugins
```

Or from the shell:

```sh
claude plugin install kronicle-lite@isokron-plugins
claude plugin install sea-lite@isokron-plugins
```

Requires Node >= 20, because each server is launched with `npx -y <package>@<version> serve`. The first launch downloads the package from the public npm registry; later launches use the cache.

## Layout

```
.claude-plugin/marketplace.json     marketplace catalog (three entries)
plugins/kronicle-lite/
  .claude-plugin/plugin.json        manifest + directory listing fields
  .mcp.json                         npx -y kronicle-lite@0.10.0 serve
  skills/orient/SKILL.md            copy of upstream skills/orient/SKILL.md
  README.md, LICENSE
plugins/sea-lite/
  .claude-plugin/plugin.json
  .mcp.json                         npx -y sea-lite@0.7.1 serve
  skills/work-queue/SKILL.md        copy of upstream skills/work-queue/SKILL.md
  README.md, LICENSE
plugins/isokron-setup/
  .claude-plugin/plugin.json, icon.png
  skills/isokron-setup/             byte-identical copy of skills/isokron-setup/
  README.md, LICENSE
skills/isokron-setup/               the installer as a standalone Agent Skill (npx skills add)
  SKILL.md                          agentskills.io front matter; detect → ask once → install → verify
  scripts/                          detect.mjs, install.mjs, verify.mjs, uninstall.mjs, lib.mjs (node:* only)
  references/clients.md             exact per-client snippets
  assets/                           orient + work-queue skill copies for non-Claude clients
tests/isokron-setup.test.mjs        node:test, hermetic (fake HOME, fake claude / kronicle-lite / cc-anchor)
scripts/check.mjs                   JSON + required-field checks, Agent Skills spec, copy drift (CI)
scripts/sync-skills.mjs             refresh the skill copies from the pinned npm packages
scripts/sync-setup-skill.mjs        refresh the isokron-setup copies (--check fails on drift)
SUBMISSION.md                       how to submit each plugin to the Claude directory
```

## Releasing a new version

1. Publish the new server version to npm from its own repo.
2. Edit the pin in `plugins/<name>/.mcp.json` and `version` in `plugins/<name>/.claude-plugin/plugin.json` to the new version.
3. Run `node scripts/sync-skills.mjs` to refresh the bundled skill, then `node scripts/sync-setup-skill.mjs` (the installer's skill assets and plugin copy), bump the pins in `skills/isokron-setup/scripts/lib.mjs` (`PINS`) and `references/clients.md`, then `node --test tests/*.test.mjs`, `node scripts/check.mjs` and `claude plugin validate --strict --profile directory ./plugins/<name>`.
4. Commit and push to `main`. The Claude directory picks the commit up from the tracked branch; Claude Code users get it on their next plugin update.

## Source repositories

- kronicle-lite: <https://github.com/isokron-ai/kronicle-lite>
- sea-lite: <https://github.com/isokron-ai/sea-lite>

Issues about the servers go to those repos; issues about packaging go here.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
