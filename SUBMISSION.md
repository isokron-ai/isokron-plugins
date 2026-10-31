# Submitting to the Claude directory

Two submissions, one per plugin folder. The directory refuses a marketplace root ("Pick one plugin first"), so each of `plugins/kronicle-lite` and `plugins/sea-lite` is its own entry in the portal. Source for every rule below: [Submit your plugin](https://claude.com/docs/plugins/submit), [Publish to the directory](https://claude.com/docs/directory/publish), [Plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist), [Connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria), fetched 2026-10-31.

## 0. Before you open the portal

| Requirement | Status |
| --- | --- |
| Paid claude.ai plan: Pro, Max, Team or Enterprise (Free cannot submit). On Team/Enterprise you must be an Owner or hold the **Directory** permission | You confirm |
| GitHub account connected on claude.ai **in the organization you submit from**, with push access to the repo. A connection made in another Claude org does not carry over | You confirm (Settings > Connectors > GitHub) |
| Repo `rafe-walker/isokron-plugins` on github.com. It may be private for Validate + submit (needs the Claude GitHub App installed on it and your consent to source upload), **must be public before Publish** | Push this repo; make public |
| The first organization to submit a given repo+folder owns the listing forever. Submit from the org that should own IsoKron's listings long term | Decide once |
| **Icon**: the listing icon is read only on the FIRST save/submit in the portal; adding it later does not change the listing. Add a square PNG, 512 to 2048 px, under 2 MB, at `plugins/<name>/.claude-plugin/icon.png` (or set `"icon": "./…"` in plugin.json) **before** the first save | Done: `plugins/<name>/.claude-plugin/icon.png`, 1024 px, original marks |
| 10 submissions per org per 24 h, drafts and withdrawals count | Two needed |
| Comply with [Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) and [Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | Read once |

Local checks already pass at the commit this file ships with:

```sh
claude plugin validate .                                              # marketplace
claude plugin validate --strict --profile directory ./plugins/kronicle-lite
claude plugin validate --strict --profile directory ./plugins/sea-lite
node scripts/check.mjs
node scripts/sync-skills.mjs --check
```

All pass with zero warnings. Re-run after any push: a validation result applies to one commit.

## 1. Portal walkthrough (repeat for each plugin)

Open <https://claude.ai/directory/manage> and select **Submit new**. Under **What would you like to submit?** pick **Plugin bundle**. (Do **not** pick MCP connector: that is for remote servers with a URL; kronicle-lite and sea-lite are local stdio servers, which the directory now accepts only inside a plugin bundle.)

### Source step

| Field | kronicle-lite | sea-lite |
| --- | --- | --- |
| Repository | `rafe-walker/isokron-plugins` | `rafe-walker/isokron-plugins` |
| Plugin path (optional) | `plugins/kronicle-lite` | `plugins/sea-lite` |
| Branch or tag (optional) | leave empty (follows default branch `main`) | leave empty |

Select **Validate**. Expected report: no **Blocking** findings; one **Policy hold** titled **Runs a pinned npx or uvx package** (unavoidable for an npx launcher, see section 3); possibly a note about the icon. Fix anything marked Blocking in the repo, push, then **Re-validate**.

### Listing details step

Nothing to type. The portal reads these from `plugin.json` and `README.md`. What it will show:

| Listing field | kronicle-lite | sea-lite |
| --- | --- | --- |
| Name | `kronicle-lite` | `sea-lite` |
| Display name | Kronicle Lite | Sea Lite |
| Version | 0.2.0 | 0.1.1 |
| Short description | Hash-chained local document store with signed retrieval receipts and an orient protocol that tells the agent when its notes went stale. | Fenced work queue for parallel coding agents: leased claims, typed links, atomic batches, hash-chained history. Composes with kronicle-lite. |
| Author | Joshua Bryan, <https://isokron.ai> | same |
| Homepage | <https://isokron.ai> | same |
| Repository | <https://github.com/rafe-walker/kronicle-lite> | <https://github.com/rafe-walker/sea-lite> |
| License | Apache-2.0 (plus `LICENSE` file in the folder) | same |
| Documentation (`documentationUrl`) | <https://github.com/rafe-walker/kronicle-lite#readme> | <https://github.com/rafe-walker/sea-lite#readme> |
| Support (`supportUrl`) | <https://github.com/rafe-walker/kronicle-lite/issues> | <https://github.com/rafe-walker/sea-lite/issues> |
| Privacy policy (`privacyPolicyUrl`) | <https://isokron.ai/privacy> (returned HTTP 200 on 2026-10-31) | same |
| Terms of service (`termsOfServiceUrl`) | not set (optional) | not set |
| Long description | `plugins/<name>/README.md` | same |

To change any of these, edit `plugin.json` or the README, push, re-validate.

### Data handling step

Suggested answers. Both servers are identical in behavior here.

| Question | Answer | Why |
| --- | --- | --- |
| Does the plugin read or store personal data? | **No** personal data by design. It stores whatever content the user writes into it, in a SQLite file on the user's own machine (`~/.kronicle-lite`). The publisher never receives it. | No network code in either server |
| Does it send data to services other than its declared connectors? | **No.** The only outbound traffic is `npx` fetching the pinned package from the public npm registry on first launch. | Disclose the npm download explicitly; the scan flags undisclosed destinations |
| How long is data kept? | Indefinitely on the user's machine, until the user deletes `~/.kronicle-lite`. The publisher retains nothing. | |
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
| Folder contains `.claude-plugin/plugin.json` | Blocks | Yes, both |
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
| Icon | Warning | Missing; add before the first portal save (see section 0) |

### Tool annotations

The "missing tool annotations" rejection reason comes from the **MCP connector** checklist (remote servers): every tool must have a `title` plus `readOnlyHint: true` for read-only tools and `destructiveHint: true` for tools that modify or delete data, because these drive Claude's auto-permission behavior. The **plugin bundle** validator cannot see tool annotations at all (it only reads files in the folder; the npx package is held for a human), so annotations are not an automated Blocks/Hold item for this bundle. A reviewer who launches the server will see them, and Claude's permission prompts depend on them, so they still matter.

Current state, from `src/server.ts` in each upstream repo at the pinned versions:

**kronicle-lite 0.2.0: complete.** All 9 tools set `title` and `openWorldHint: false`. Read-only (`readOnlyHint: true`): `get_system_state`, `audit_assumptions`, `recall`, `verify`, `verify_chain`. Writes with explicit `destructiveHint: false`: `checkpoint_chain`, `put_document`, `supersede_block`. Destructive (`destructiveHint: true`): `tombstone_block`. No change needed.

**sea-lite 0.1.1: complete.** Shipped 2026-10-31 with explicit `destructiveHint` on every write tool: `false` for `sea_create`, `sea_apply`, `sea_claim`, `sea_refresh`, `sea_next`; `true` for `sea_update`, `sea_transition`, `sea_link`, `sea_release`. Readers unchanged (`readOnlyHint: true`). No change needed.

## 4. Things the docs ask for that this repo cannot satisfy yet

- **Public repository**: `rafe-walker/isokron-plugins` does not exist on GitHub yet. Create it, push `main`, make it public before Publish.
- **Icon**: no IsoKron icon asset is in this repo or the upstream repos. Add `plugins/<name>/.claude-plugin/icon.png` (square PNG, 512 to 2048 px, under 2 MB) before the first portal save, or the listing will never have one.
- **Avoiding the npx reviewer hold**: not possible without vendoring a native-dependency server; accept it.
- **`claude plugin validate` vs the portal**: the CLI covers a subset. The portal's **Validate** runs name-collision and the full file checks; run it before trusting the local pass.
- **Pairing with an MCP connector listing**: not applicable; these are local stdio servers with no remote URL, so there is no connector to submit alongside.
