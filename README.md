# isokron-plugins

Claude Code plugin marketplace for [IsoKron](https://isokron.ai)'s local-first MCP servers. Each plugin bundles one published npm server with the skill that teaches Claude how to use it.

| Plugin | Server | What it does |
| --- | --- | --- |
| [`kronicle-lite`](plugins/kronicle-lite/) | [`kronicle-lite@0.2.0`](https://www.npmjs.com/package/kronicle-lite) | Hash-chained document store with signed retrieval receipts and an **orient** protocol that tells the agent when its notes went stale |
| [`sea-lite`](plugins/sea-lite/) | [`sea-lite@0.1.1`](https://www.npmjs.com/package/sea-lite) | Fenced **work queue** for parallel coding agents: leased claims, typed links, atomic batches, hash-chained history |

Both servers run over stdio on the local machine, store everything in `~/.kronicle-lite`, and send nothing anywhere. They share one SQLite file, so an agent that has both can `orient` against the same chain its tickets live on.

## Install

Add the marketplace once:

```sh
claude plugin marketplace add rafe-walker/isokron-plugins
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
.claude-plugin/marketplace.json     marketplace catalog (two entries)
plugins/kronicle-lite/
  .claude-plugin/plugin.json        manifest + directory listing fields
  .mcp.json                         npx -y kronicle-lite@0.2.0 serve
  skills/orient/SKILL.md            copy of upstream skills/orient/SKILL.md
  README.md, LICENSE
plugins/sea-lite/
  .claude-plugin/plugin.json
  .mcp.json                         npx -y sea-lite@0.1.1 serve
  skills/work-queue/SKILL.md        copy of upstream skills/work-queue/SKILL.md
  README.md, LICENSE
scripts/check.mjs                   JSON + required-field checks (CI)
scripts/sync-skills.mjs             refresh the skill copies from the pinned npm packages
SUBMISSION.md                       how to submit each plugin to the Claude directory
```

## Releasing a new version

1. Publish the new server version to npm from its own repo.
2. Edit the pin in `plugins/<name>/.mcp.json` and `version` in `plugins/<name>/.claude-plugin/plugin.json` to the new version.
3. Run `node scripts/sync-skills.mjs` to refresh the bundled skill, then `node scripts/check.mjs` and `claude plugin validate --strict --profile directory ./plugins/<name>`.
4. Commit and push to `main`. The Claude directory picks the commit up from the tracked branch; Claude Code users get it on their next plugin update.

## Source repositories

- kronicle-lite: <https://github.com/rafe-walker/kronicle-lite>
- sea-lite: <https://github.com/rafe-walker/sea-lite>

Issues about the servers go to those repos; issues about packaging go here.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
