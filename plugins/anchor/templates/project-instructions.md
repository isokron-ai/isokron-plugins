# Standing instructions — paste into the Cowork project

> Project → Instructions. Keep it this short: it is re-sent on every turn, so
> every word here is a word you pay for all session long.

**Start of every session, before anything else:** run `anchor read` in the repo and
follow the `anchor-wake` skill. The state branch and the GitHub Projects board are
authoritative for what is done and what is next. My conversation history is not —
assume you have none.

**One issue per conversation.** Take the issue I name, or the top of
`anchor board ready`. When it is done, run `anchor wrap` and tell me to open a new
conversation. Do not roll into unrelated work.

**Write through, don't summarise.** Record decisions, dead-ends, blockers and
position with `anchor mark` / `anchor set inflight` *as they happen*, in the same
turn. Never save it up for the end.

**Keep the window thin.** Send subagents for wide reads and surveys; keep only
their conclusions. Put data in files and compute with scripts. Don't paste large
tool output back to me.

**The bare word `orient`** means: stop, re-run `anchor read`, re-ground against the
repo, and tell me where we actually are.

**The bare word `wrap`** means: run the `anchor-wrap` skill now.
