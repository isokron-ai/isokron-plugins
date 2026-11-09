# Submitting to the Claude directory

Three submissions, one per plugin folder. The directory refuses a marketplace root ("Pick one plugin first"), so each of `plugins/kronicle-lite`, `plugins/sea-lite` and `plugins/isokron-setup` is its own entry in the portal. Submit `isokron-setup` last: its skill installs the other two from this marketplace, so a reviewer who tries it should find them listed (or at least submitted). Source for every rule below: [Submit your plugin](https://claude.com/docs/plugins/submit), [Publish to the directory](https://claude.com/docs/directory/publish), [Plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist), [Connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria), fetched 2026-10-31.

## 0. Before you open the portal

| Requirement | Status |
| --- | --- |
| Paid claude.ai plan: Pro, Max, Team or Enterprise (Free cannot submit). On Team/Enterprise you must be an Owner or hold the **Directory** permission | You confirm |
| GitHub account connected on claude.ai **in the organization you submit from**, with push access to the repo. A connection made in another Claude org does not carry over | You confirm (Settings > Connectors > GitHub) |
| Repo `isokron-ai/isokron-plugins` on github.com. It may be private for Validate + submit (needs the Claude GitHub App installed on it and your consent to source upload), **must be public before Publish** | Push this repo; make public |
| The first organization to submit a given repo+folder owns the listing forever. Submit from the org that should own IsoKron's listings long term | Decide once |
| **Icon**: the listing icon is read only on the FIRST save/submit in the portal; adding it later does not change the listing. Add a square PNG, 512 to 2048 px, under 2 MB, at `plugins/<name>/.claude-plugin/icon.png` (or set `"icon": "./…"` in plugin.json) **before** the first save | Done: `plugins/<name>/.claude-plugin/icon.png`, 1024 px, original marks |
| 10 submissions per org per 24 h, drafts and withdrawals count | Three needed |
| Comply with [Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) and [Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | Read once |

Local checks already pass at the commit this file ships with:

```sh
claude plugin validate .                                              # marketplace
claude plugin validate --strict --profile directory ./plugins/kronicle-lite
claude plugin validate --strict --profile directory ./plugins/sea-lite
claude plugin validate --strict --profile directory ./plugins/isokron-setup
node scripts/sync-setup-skill.mjs --check
node --test tests/*.test.mjs
node scripts/check.mjs
node scripts/sync-skills.mjs --check
```

All pass with zero warnings. Re-run after any push: a validation result applies to one commit.

## 1. Portal walkthrough (repeat for each plugin)

Open <https://claude.ai/directory/manage> and select **Submit new**. Under **What would you like to submit?** pick **Plugin bundle**. (Do **not** pick MCP connector: that is for remote servers with a URL; kronicle-lite and sea-lite are local stdio servers, which the directory now accepts only inside a plugin bundle.)

### Source step

| Field | kronicle-lite | sea-lite | isokron-setup |
| --- | --- | --- | --- |
| Repository | `isokron-ai/isokron-plugins` | `isokron-ai/isokron-plugins` | `isokron-ai/isokron-plugins` |
| Plugin path (optional) | `plugins/kronicle-lite` | `plugins/sea-lite` | `plugins/isokron-setup` |
| Branch or tag (optional) | leave empty (follows default branch `main`) | leave empty | leave empty |

Select **Validate**. Expected report for kronicle-lite and sea-lite: no **Blocking** findings; one **Policy hold** titled **Runs a pinned npx or uvx package** (unavoidable for an npx launcher, see section 3); possibly a note about the icon. For isokron-setup: no npx launcher (it has no `.mcp.json`), so no launcher hold; expect a reviewer look at the skill's scripts instead (section 3, isokron-setup row). Fix anything marked Blocking in the repo, push, then **Re-validate**.

### Listing details step

Nothing to type. The portal reads these from `plugin.json` and `README.md`. What it will show:

| Listing field | kronicle-lite | sea-lite | isokron-setup |
| --- | --- | --- | --- |
| Name | `kronicle-lite` | `sea-lite` | `isokron-setup` |
| Display name | Kronicle Lite | Sea Lite | IsoKron Setup |
| Version | 0.3.0 | 0.2.0 | 0.1.0 |
| Short description | Hash-chained local document store with signed retrieval receipts and an orient protocol that tells the agent when its notes went stale. | Fenced work queue for parallel coding agents: leased claims, typed links, atomic batches, hash-chained history. Composes with kronicle-lite. | One-command installer for the IsoKron agent toolset: detects Claude Code, Cowork, Cursor, Codex and Copilot, shows one plan, asks once, then installs kronicle-lite + orient, cc-anchor and (team) sea-lite, seeds the wake contract and the chain, runs the first orient and verifies. Fully reversible. |
| Author | IsoKron, <https://isokron.ai> | same | same |
| Homepage | <https://isokron.ai> | same | same |
| Repository | <https://github.com/isokron-ai/kronicle-lite> | <https://github.com/isokron-ai/sea-lite> | <https://github.com/isokron-ai/isokron-plugins> |
| License | Apache-2.0 (plus `LICENSE` file in the folder) | same | same |
| Documentation (`documentationUrl`) | <https://github.com/isokron-ai/kronicle-lite#readme> | <https://github.com/isokron-ai/sea-lite#readme> | <https://github.com/isokron-ai/isokron-plugins/tree/main/plugins/isokron-setup#readme> |
| Support (`supportUrl`) | <https://github.com/isokron-ai/kronicle-lite/issues> | <https://github.com/isokron-ai/sea-lite/issues> | <https://github.com/isokron-ai/isokron-plugins/issues> |
| Privacy policy (`privacyPolicyUrl`) | <https://isokron.ai/privacy> (returned HTTP 200 on 2026-10-31) | same | same |
| Terms of service (`termsOfServiceUrl`) | not set (optional) | not set | not set |
| Long description | `plugins/<name>/README.md` | same | same |

To change any of these, edit `plugin.json` or the README, push, re-validate.

### Data handling step

Suggested answers. Both servers keep their data local; kronicle-lite also contacts its anchor service on two opt-in tool calls.

| Question | Answer | Why |
| --- | --- | --- |
| Does the plugin read or store personal data? | **No** personal data by design. It stores whatever content the user writes into it, in a SQLite file on the user's own machine (`~/.kronicle-lite`). The publisher never receives it. | sea-lite has no outbound network code. kronicle-lite sends checkpoint roots and signatures (never document contents) to the anchor service only on `checkpoint_chain {push: true}` with a license key configured, and reads its anchor listing on `anchor_status {remote: true}` |
| Does it send data to services other than its declared connectors? | **No.** Outbound traffic is `npx` fetching the pinned package from the public npm registry on first launch and, for kronicle-lite only, the anchor service (`https://anchor.isokron.ai` by default, `KRONICLE_ANCHOR_URL` to change it) on `checkpoint_chain {push: true}` and `anchor_status {remote: true}`. | Disclose the npm download and the anchor service explicitly; the scan flags undisclosed destinations. Both are named in the kronicle-lite README |
| How long is data kept? | Indefinitely on the user's machine, until the user deletes `~/.kronicle-lite`. The publisher retains nothing. | |
| Intended for people under 18? | **No** | |

**isokron-setup answers differently** (it is an installer, not a server):

| Question | Answer | Why |
| --- | --- | --- |
| Does the plugin read or store personal data? | **No.** It reads the project's README, CLAUDE.md / AGENTS.md and chosen ADRs and stores them in the user's local kronicle-lite chain (`~/.kronicle-lite`). It writes `.isokron/setup-manifest.json` in the project. The publisher never receives anything. | Scripts use only Node's standard library; no network code of their own |
| Does it send data to services other than its declared connectors? | **No.** Outbound traffic is only what the commands it runs do: `claude plugin marketplace add` / `install` (GitHub: `isokron-ai/isokron-plugins`, `isokron-ai/cc-anchor`), `npx` (npm registry: `kronicle-lite@0.10.0`, `sea-lite@0.7.1`, `mcp-catalog-snap@0.1.0`) and, for Cursor without Claude Code, `git clone` of `github.com/isokron-ai/cc-anchor` at `v0.6.0` into a temp dir. | All three destinations are named in the plugin README |
| Does it change configuration outside the project? | **Only after the user answers the plan question**, and only the files that question names: `~/.claude/settings.json` via `claude plugin` (user scope), `~/.codex/config.toml` (marked block). Each is backed up as `*.bak-isokron`; `uninstall.mjs` reverses it. `--scope-mode project` keeps everything in the repo. | State it up front; this is the likeliest reviewer question |
| How long is data kept? | Until the user runs `uninstall.mjs` (config) or deletes `~/.kronicle-lite` (seeded docs; the chain is append-only). | |
| Intended for people under 18? | **No** | |

### Compliance step

- Contact email: the address Anthropic can reach you at about this submission (the portal pre-fills your account email).
- Select all four acknowledgements.

### Review and submit step

- **How new versions reach the directory**: keep **GitHub push webhook** (needs admin on the repo to install the webhook; the **Set up push updates** button appears after submit, or later under **Settings > Updates**). The directory also polls the tracked branch on a schedule either way.
- **Auto-publish passing versions**: your choice. It does not apply until a reviewer has approved the first version anyway.
- Select **Submit for review**.

## 2. After submitting

- **Submissions** list in the portal shows the status; the plugin's **Versions** tab shows each scanned commit. A first listing is always read by a human reviewer before it goes live.
- When a version **passes every check**, select **Publish** on the plugin's page. By default a reviewer publishes it. Publishing needs the repo public; until then the page says **Publishing needs a public repository**. Make it public, then **Check for new commits**.
- **Rejected** (a reviewer decision, or a failed security scan on a never-published plugin): read **Requested changes** on the **Review** tab, push a fix, select **Resubmit for review**.
- **Held** is not a rejection; a reviewer clears it.
- Updates after go-live: bump `version` in `plugin.json` and the pin in `.mcp.json`, merge to `main`. The directory scans the commit and publishes per the auto-publish setting. The listing keeps serving the last published version while a new one is held or failing.
- Stuck submission: <directory@anthropic.com> (also the address if another org has somehow claimed this repo+folder).

## 3. Known rejection and hold causes, and where we stand

From the plugin pre-submission checklist. **Blocks** = cannot submit; **Hold** = submit allowed, reviewer must clear.

| Check | Result if failed | This repo |
| --- | --- | --- |
| Folder contains `.claude-plugin/plugin.json` | Blocks | Yes, all three |
| Submitting a marketplace root with several plugins | Blocks ("Pick one plugin first") | Submit each `plugins/<name>` folder |
| README of 40+ words outside code blocks in the plugin folder | Blocks | Yes, both |
| `LICENSE` file or `license` in plugin.json | Blocks | Both |
| `name`: lowercase, digits, hyphens, <= 64, not reserved (`claude`, `anthropic`, `official`, `plugin`, `mcp`, `test`), not taken by another org, not generic | Blocks / Hold | `kronicle-lite`, `sea-lite`: distinctive. Collision only if another org already listed the same name; the portal says **Name is taken** |
| `description`, `author`, `version` set | Warning | Set |
| Launcher package pinned to an exact version (`npx pkg@1.2.3`, not `@latest` or a range) | Blocks (**Unpinned npx launcher**) | `kronicle-lite@0.2.0`, `sea-lite@0.1.0` |
| No `.npmrc` / `bunfig.toml` / `uv.toml` in a plugin using a launcher | Blocks | None |
| No credentials in any file; secrets via `userConfig` `sensitive: true` | Blocks | No secrets, no userConfig |
| `.mcp.json` valid, each server has `command`+`args` or `url` | Blocks | Valid, stdio |
| MCP server command does not go through a shell / `-c` / `npm run` | Hold | Plain `npx` with plain args |
| No `.DS_Store`, `Thumbs.db`, symlinks, submodules, LFS | Blocks | None |
| Files under 256 KiB (non-image), <= 512 files, no uninspectable binaries | Hold | Largest file is the Apache LICENSE (11 KB) |
| Skill front matter: valid YAML, `description` is a single string | Blocks | Both skills pass |
| **Runs a pinned npx or uvx package** | **Hold, always** ("the package's own dependencies resolve at install time") | **Expected on both.** The only way to avoid it is to vendor the built server into the plugin folder, which would then hit the 256 KiB-per-file hold (`better-sqlite3` is native) and the "commit readable source, not compiled code" scan rule. Accept the hold |
| Security scan: undisclosed network destinations, hidden code, permission changes | Rejects a first submission | README of each plugin states exactly what it runs, stores and sends |
| isokron-setup: a skill that edits user config and installs other plugins | Not a listed Blocks item; expect a human reviewer to read `skills/isokron-setup/scripts/*.mjs` | Readable ES modules, `node:*` imports only, no minified or generated code, every write gated on `--yes` (and `--user-global-ok` for files outside the repo), every change reversible. 40 node:test cases in `tests/` cover detect / merge / idempotency / uninstall. The skill pre-approves no tools (no `allowed-tools`) |
| Icon | Warning | Missing; add before the first portal save (see section 0) |

### Tool annotations

The "missing tool annotations" rejection reason comes from the **MCP connector** checklist (remote servers): every tool must have a `title` plus `readOnlyHint: true` for read-only tools and `destructiveHint: true` for tools that modify or delete data, because these drive Claude's auto-permission behavior. The **plugin bundle** validator cannot see tool annotations at all (it only reads files in the folder; the npx package is held for a human), so annotations are not an automated Blocks/Hold item for this bundle. A reviewer who launches the server will see them, and Claude's permission prompts depend on them, so they still matter.

Current state, from `src/server.ts` in each upstream repo at the pinned versions:

**kronicle-lite 0.2.0: complete.** All 9 tools set `title` and `openWorldHint: false`. Read-only (`readOnlyHint: true`): `get_system_state`, `audit_assumptions`, `recall`, `verify`, `verify_chain`. Writes with explicit `destructiveHint: false`: `checkpoint_chain`, `put_document`, `supersede_block`. Destructive (`destructiveHint: true`): `tombstone_block`. No change needed.

**sea-lite 0.1.1: complete.** Shipped 2026-10-31 with explicit `destructiveHint` on every write tool: `false` for `sea_create`, `sea_apply`, `sea_claim`, `sea_refresh`, `sea_next`; `true` for `sea_update`, `sea_transition`, `sea_link`, `sea_release`. Readers unchanged (`readOnlyHint: true`). No change needed.

## 4. Things the docs ask for that this repo cannot satisfy yet

- **Public repository**: `isokron-ai/isokron-plugins` does not exist on GitHub yet. Create it, push `main`, make it public before Publish.
- **Icon**: no IsoKron icon asset is in this repo or the upstream repos. Add `plugins/<name>/.claude-plugin/icon.png` (square PNG, 512 to 2048 px, under 2 MB) before the first portal save, or the listing will never have one.
- **Avoiding the npx reviewer hold**: not possible without vendoring a native-dependency server; accept it.
- **`claude plugin validate` vs the portal**: the CLI covers a subset. The portal's **Validate** runs name-collision and the full file checks; run it before trusting the local pass.
- **Pairing with an MCP connector listing**: not applicable; these are local stdio servers with no remote URL, so there is no connector to submit alongside.
