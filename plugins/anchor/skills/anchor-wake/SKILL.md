---
name: anchor-wake
description: Resume a build session from durable state instead of from conversation history. Invoke as the FIRST action of any coding or build session in a repo that has an .anchor.json, when the operator types the bare word "orient", after a compaction notice, whenever your context disagrees with a tool result, or when you are unsure what was already done. Runs `anchor read`, reconciles the board, and loads the write-through contract that governs the rest of the session.
---

# anchor-wake — resume, then keep the record live

You are working on a long build that spans many conversations. Context does not
carry between them; **the state branch and the board do**. This skill is how you
pick up, and how you leave the next session something better than a summary.

## Authority ranking (settle disagreements with this, not with vibes)

When two sources disagree, trust in this order:

1. **The repo as it actually is** — `git log`, `git status`, the files, test output.
2. **The board** — the issue and its Status field. This is what "next" means.
3. **`anchor read`** — the state branch brief.
4. **The operator's live message** — they are a drift sensor; their assertion outranks your context.
5. **This conversation's earlier turns** — trustworthy only if they were grounded at the time.
6. **A compaction summary** — historical. Cite it, never decide from it.

If you are about to act on (5) or (6) without (1)–(3) confirming, stop and re-read.

## Resume procedure

1. **Locate the repo.** If it is a connected folder on the operator's Mac, work
   there through the device shell. Otherwise clone it into the session workspace.
2. **`anchor read`** — this is the brief. ~250 tokens. Read it completely.
3. **`anchor doctor`** if the brief is empty or the state ref is missing.
4. **Ground against reality** — `git status`, `git log --oneline -5`, and the branch
   named in the brief. If `inflight` describes work the repo does not show, say so
   in one line and trust the repo.
5. **Read the board** — `anchor board ready` for the queue, and `gh issue view <n>
   --comments` for the issue you are taking. The newest checkpoint comment is the
   last session's own account of itself.
6. **Reconcile, out loud, briefly.** One short paragraph: what is done, what is
   genuinely in flight, what you are picking up. Name any `deadend` entries that
   touch the work you are about to do — those are paths already burned.
7. **Answer the open questions first.** If `anchor read` lists `OPEN QUESTIONS`,
   put them to the operator before doing work those answers would invalidate.
8. **Set the anchor for this session** — `anchor set issue "#N"`,
   `anchor set phase <...>`, `anchor set inflight <...>`. These write to your
   **lane** (this repo, or `ANCHOR_LANE`), not to the whole thing.

### If there is nothing to resume

The brief says so explicitly, and it is an instruction, not a formality.

**`FRESH PROJECT`** — nothing has ever been recorded. Do not infer the project
from the repo contents and start working. Ask the operator what this project is
and what the first unit of work is, then `anchor set goal` and `anchor file`.

**`NOTHING QUEUED FOR THIS LANE`** — oriented, but this lane has no issue and
nothing in flight. In order:

1. `anchor board ready` — the queue may have work the brief cannot see.
2. If the board is empty too, **ask the operator what this session is about and
   wait for the answer.** A cold session with no issue is the one case where you
   stop and ask rather than taking the most reasonable reading.
3. Once agreed, file it before working: `anchor file "<title>"` opens an issue and
   takes it in this lane, or `anchor set issue "#N"` for one that exists.

Never do unfiled work. Work with no issue produces a record with nothing to
attach it to, so the next session inherits changes it cannot account for — which
is the failure this whole system exists to prevent. Filing first costs one
command.

### If the brief shows other lanes

A thing that spans firmware, hardware and software has a lane per strand.
`ELSEWHERE ON THIS THING` is context so you do not contradict work happening
beside you — a constraint from another lane is real and binding. It is **not**
work to pick up: stay in your lane and your issue. If another lane's position
makes your issue impossible, say so and raise it rather than crossing over.

Do not re-derive what the brief already states. Do not re-explore the codebase to
rebuild a picture the brief gives you — that re-exploration is the cost this whole
system exists to avoid.

## The write-through contract (governs the rest of this session)

The record is written **as the work happens**, never as a summary at the end. A
summary written from a compacted context is exactly the artifact that fails.

Append within the same turn the thing occurs:

| Event | Command |
|---|---|
| A choice made between real alternatives | `anchor mark decision "<choice> — <why, and what it rules out>"` |
| A unit of work finished and verified | `anchor mark done "<what, and how you know>"` |
| Something is blocked | `anchor mark blocked "<what, on what>"` |
| An approach tried and abandoned | `anchor mark deadend "<approach> — <why it failed>. Do not revisit."` |
| Operator constraint or context worth keeping | `anchor mark note "<...>"` |
| A durable trap discovered | `anchor gotcha "<...>"` |
| Something only the operator can answer | `anchor ask "<...>"` |
| New work agreed that has no issue yet | `anchor file "<title>"` — file it before starting |

Also:
- **`anchor set inflight`** whenever what you are holding changes — before a long
  tool run, before a risky edit, before handing control back. `inflight` must read
  so that someone with no context knows exactly where the work stopped.
- **`anchor next`** whenever the plan changes. Keep it to the next 2–4 concrete
  steps, in order. Not a roadmap — the board holds the roadmap.

Write a `deadend` the moment an approach dies. It is the single highest-value entry
type and the one a summary always loses.

### What does NOT go in the record

Narration, token counts, "working on it", restatements of the brief, anything
re-derivable from `git log`, and your own reasoning. The record is decisions,
outcomes, traps and position — not a transcript.

## Session hygiene (this is the usage fix, not the state branch)

- **One issue per conversation.** When the issue is done, `anchor wrap` and start a
  fresh conversation for the next one. Do not continue into unrelated work —
  everything already in the window gets re-read on every later turn.
- **Delegate wide reads.** Surveying many files, auditing a dependency tree,
  comparing options across a codebase: send a subagent and keep only its
  conclusion. Never page large result sets through the conversation.
- **Keep data in files.** Analysis belongs in a script and a file, not in the
  window.
- **Say when to stop.** If the conversation has run long and the issue is not done,
  tell the operator plainly: "this is a good place to wrap and start fresh" — then
  `anchor wrap` on their word. You cannot measure remaining context in this
  environment, so use the honest proxies: many turns elapsed, a milestone just
  landed, or the topic about to change.

## If the state is missing or stale

- No `.anchor.json` → offer to run `anchor init --board <N> --owner <O>`.
- Brief older than the newest commit on the work branch → the last session died
  without wrapping. Reconstruct position from `git log` and the issue comments, say
  what you inferred, then `anchor set inflight` to correct the record.
- `anchor` not on PATH → it is vendored at `.anchor/bin/anchor` in the repo.
