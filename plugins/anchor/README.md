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

```bash
./install.sh /path/to/your/repo --board 7 --owner your-gh-login
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
