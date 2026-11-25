---
name: anchor-wrap
description: Close out a build session cleanly so the next conversation can resume for ~250 tokens. Invoke when the operator says wrap, checkpoint, handoff, "let's stop here", or that they are starting a new conversation; when an issue is finished; or when you judge the conversation has run long enough that continuing is wasteful. Flushes state, pushes the state branch, comments on the issue and moves the board.
---

# anchor-wrap — end the session, keep the thread

A wrap is not a summary. The record was written as the work happened; a wrap
**flushes, verifies and publishes** it, then leaves the next session a clean entry
point.

## Procedure

1. **Flush what is only in your head.** Anything from this session not yet in the
   record goes in now — especially decisions, dead-ends and the true position:
   - `anchor set inflight "<exactly where the work stopped>"`
   - `anchor next "<step>" "<step>" "<step>"`
   - any outstanding `anchor mark decision|deadend|blocked|note`
2. **Be honest about unfinished work.** Uncommitted changes, a test you did not
   run, an edit you are unsure about: `anchor mark blocked` or a `note`. A wrap
   that overstates completeness is worse than no wrap — the next session will
   build on a false floor.
3. **Commit or declare the code.** Either commit the work branch and push it, or
   record in `inflight` that there are uncommitted changes and what they are.
   Never leave the next session guessing which.
4. **`anchor wrap --status "<board status>"`** — writes the brief, pushes the state
   branch, posts a checkpoint comment on the issue, and moves the board. Use the
   board's own status values (e.g. `In Progress`, `Blocked`, `Done`).
5. **Verify the handoff.** Run `anchor read` one more time and read it as if you
   knew nothing. If it does not tell you what to do next, fix it before stopping.
6. **Tell the operator, in two lines:** what landed, and the first thing the next
   conversation will do. Nothing else — they do not need a recap of the session.

## The test that matters

Before you stop, ask: *if the next session read only this brief and the board,
would it do the right next thing without asking me anything?*

If no, the gap is usually one of these — fix it:
- `inflight` is vague ("working on the retry logic") rather than positional
  ("retry.ts written, 429 path untested, not wired into ingest.ts yet").
- A dead-end is missing, so the next session will burn the same hours.
- `next` lists intentions rather than actions.
- An open question is unanswered and blocks step 1.

## Do not

- Do not write a narrative of the session into the issue comment; `anchor wrap`
  publishes the structured brief and that is enough.
- Do not mark an issue Done on the board because the code is written. Done means
  verified — tests run, or the operator confirmed.
- Do not keep working after a wrap. Start a new conversation.
