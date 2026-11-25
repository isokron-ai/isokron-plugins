# anchor

Write-through session state for long builds, so a conversation can be **ended and
replaced** rather than grown.

Long conversations are the expensive failure mode: everything in the window is
re-read on every turn, and once a chat starts compacting it costs more usage while
getting *less* reliable. The usual fix — ask for a handoff file at the end — fails
because that file is written from an already-compacted context. It reads like a
summary of a summary.

anchor inverts it. The record is appended **while the work is happening**, from live
context. Resuming costs ~250 tokens.

## What it is

- **State on a git orphan branch** (`agent-state`), written with git plumbing, so
  your working tree, index and branch are never touched. Safe mid-edit, mid-rebase.
- **A ~250-token resume brief** — `anchor read` — holding goal, issue, position,
  next steps, gotchas, open questions and the recent decision/dead-end log.
- **GitHub Projects v2 as the queue** — the board says what's next; the brief says
  how far the current item got.
- **Two Claude skills** — `anchor-wake` (resume + the write-through contract) and
  `anchor-wrap` (clean close-out).

## Install

```
/plugin install anchor --marketplace isokron-ai/isokron-plugins
```

Then vendor the CLI into each repo it should track:

```bash
./skills/anchor-wake/scripts/install.sh /path/to/your/repo --board 7 --owner your-gh-login
cd /path/to/your/repo
git add .anchor .anchor.json && git commit -m "chore: vendor anchor state tool"
git push
```

Then enable the skills for your claude.ai account (Cowork loads skills from the
account, not from `~/.claude/skills`), and paste `templates/project-instructions.md`
into the Cowork project's instructions. **Do this on both Ultra accounts** — skills
are per-account; the state branch is shared through GitHub.

## Daily shape

```bash
anchor read                      # first thing in every new conversation
anchor set issue "#42"
anchor set inflight "retry.ts written, 429 path untested, not wired in yet"
anchor mark decision "exp backoff over fixed — fixed thundered upstream"
anchor mark deadend "p-retry swallows our cancellation. Do not revisit."
anchor next "write retry.test.ts" "wire into ingest.ts" "open PR"
anchor wrap --status "In Progress"     # then open a NEW conversation
```

## Commands

| | |
|---|---|
| `anchor read [--full]` | the resume brief |
| `anchor set goal\|issue\|branch\|phase\|inflight <v>` | set an anchor field |
| `anchor mark decision\|done\|blocked\|deadend\|note <text>` | append a log event |
| `anchor next <step>...` | replace the next-steps list |
| `anchor gotcha <text>` / `anchor ask <text>` / `anchor resolve <n>` | durable traps, open questions |
| `anchor wrap [--status S]` | flush + push + issue comment + board move |
| `anchor board ready\|status\|note` | Projects v2 helpers |
| `anchor doctor` | prerequisites and freshness |

## Many projects, one board each

Scope is per repo. `.anchor.json` sits in each repo and names that repo's board,
so there is no global "what's next" — the queue you get is always the queue for
the repo you are standing in. Switching projects is just `cd`.

**One thing, one repo** (the common case) — the board number goes in that repo's
`.anchor.json` and the state branch lives in that repo:

```bash
./skills/anchor-wake/scripts/install.sh ~/rotorcards --board 3 --owner rafe-walker
./skills/anchor-wake/scripts/install.sh ~/azlandlist --board 4 --owner rafe-walker
```

**One thing, many repos** — point every repo of that thing at the same board *and*
the same state home, so one brief and one queue cover the whole thing:

```bash
./skills/anchor-wake/scripts/install.sh ~/mcp-check --board 12 --owner isokron-ai \
  --state-remote https://github.com/isokron-ai/isokron-anchor
./skills/anchor-wake/scripts/install.sh ~/strapi-plugin-writesafe --board 12 --owner isokron-ai \
  --state-remote https://github.com/isokron-ai/isokron-anchor
```

Projects v2 already collects issues from many repos onto one board, so the queue
stays single. With a shared state home the log stamps each entry with the repo it
came from, and `anchor read` tags them when more than one is present:

```
11-25 00:33  deadend  [strapi-plugin-writesafe] v5 codemod rewrites our guards
11-25 00:34  note     [mcp-check] audit script now in CI
```

Without `--state-remote` each repo keeps its own state branch, which is what you
want when the repos are unrelated.

### Lanes

A shared state home needs more than one position, because firmware, hardware and
software move independently. Each strand is a **lane**, and each lane keeps its own
`issue`, `branch`, `phase`, `inflight` and `next`. `goal`, `gotchas` and
`questions` stay shared, since those are properties of the thing.

The lane defaults to the repo name, so a many-repo thing gets lanes for free. For
one repo that splits into strands, set `"lane"` in `.anchor.json` or pass
`ANCHOR_LANE=bootloader` for a session.

`anchor read` shows your lane in full and the others as one line each:

```
--- this lane: firmware ---
issue:    #58
inflight: DFU bootloader flashes, CRC check not written

NEXT (in order):
  1. write CRC check

ELSEWHERE ON THIS THING (context, not yours to resume):
  hardware   #61   Rev A board back from fab, shunt footprint wrong  (2h ago)
  software   #64   telemetry parser done, no reconnect handling      (20m ago)
```

That framing is deliberate: the other lanes are there so a session does not
contradict work happening beside it, not so it picks that work up. Lanes also make
the merge nearly conflict-free — two sessions in different lanes touch different
keys, so there is nothing to resolve.

With one repo and one lane, none of this shows and the output is unchanged.

## Two sessions at once

Concurrent writers merge rather than diverge. If two sessions (two machines, two
Claude accounts, or a cloud session and your Mac) write the state branch at the
same time, the losing push triggers a fetch-and-replay: the NDJSON log is unioned
and re-sorted by timestamp, `gotchas` and `questions` are unioned, and the scalar
anchor fields take the later writer. The result is a real two-parent merge commit,
and both sides converge on the next read.

Nothing is lost and no one has to resolve anything by hand. The one field that is
genuinely last-writer-wins is `inflight` — which is correct, since two sessions
cannot both be "where the work stopped".

## Requirements

`git`, `python3` (stdlib only), and `gh` for the board and issue features.
GitHub Projects v2 is GraphQL-only, so board commands go through `gh project`.

## Reading the state by hand

```bash
git fetch origin agent-state:refs/heads/agent-state
git show agent-state:STATE.md
git log --oneline agent-state
```

## Why not hooks

In Claude Code CLI this would be a `PreCompact`/`SessionStart` hook pair. In Cowork
it can't be: command hooks don't fire there, and `mcp_tool` hooks fail too because
Cowork runs hooks in a cloud VM with `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1`. There
is also no context gauge to trigger on. So the trigger is the standing instruction
plus the skill — and the write is made cheap and constant enough that no threshold
detection is needed.
