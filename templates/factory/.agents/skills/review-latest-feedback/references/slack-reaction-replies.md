# Slack Reaction Replies

At sweep exit, reconcile every parent in the scoped inventory that has this
task's `👀`, including eyes left by earlier runs. Capture the exact Slack actor
ID used by the connected tool at sweep start. Treat an eye as owned by this
task only when its reaction owner ID matches that actor ID. Each owned eye
needs a current disposition and a matching status reply by that same actor
under that same parent. A same-run fix gets its final reply after verification;
continuing work gets a concrete progress reply. An earlier generic “taking a
look” does not satisfy this update. If an existing reply already names the
exact canonical disposition label and includes its recorded evidence verbatim,
read it back and record its timestamp and author ID instead of duplicating it.
Do not accept a vague or negated substring such as `Not fixed` as the `Fixed`
label. Use `Partially fixed` while any distinct handoff remains unfinished.

Channel reads may expose a thread reply as a separate row. Resolve its
`thread_ts` or permalink and inventory it as a reply to the root, not as a new
report. If that reply carries this task's eye, its status reply must be posted
in the same root thread after the eyed message. Record both the source message
timestamp and root thread timestamp; if the connector hides `thread_ts`, resolve
the permalink before recording it.

The parent inventory must retain the reaction-owner IDs and the same-parent
reply timestamp, author ID, disposition, evidence, and read-back text for every
owned eye. Record an explicit decision for both `✅` and `🎫` on every owned
eye: `present` with its scope, or `none` with the reason no mark applies. Record
verified fixed scopes with their proof and each distinct human handoff with its
scope, owner, and action. In the framework repository, run
`pnpm feedback:inventory-check -- .tmp/feedback-inventory.json` before the
recap; a failed check means owned-eye reconciliation is incomplete. The checker
does not authorize changing another actor's reactions or replies.

## Prior questions and reporter replies

At sweep start, search the exact bot disclosure in each scoped channel and
exhaust the pages to find prior questions and their context:

```text
slack_search: "this was sent from a bot." in:<#CHANNEL>
  sort=timestamp sort_dir=asc include_context=true max_context_length=300
```

Also scan channel messages from the saved reply cursor; on the first run, scan
available history. Since `after:` is date-only, start one day before the cursor,
exhaust pages, resolve hits to their root, and advance the cursor only through
processed messages. Read inherited threads with this actor's eye even when they
also have `✅`: it closes only its verified scope, not a newer reporter answer
or another open scope. Skip other actors' marks unless explicitly handed off.

Count an answer only when a human posts after the question, without this
workflow's disclosure, and the reply addresses it. Read the full thread to
exclude partial, unrelated, or deferred answers; a newer human post reopens the
question. Attempt the fix with new evidence before asking again. Wait silently
if the question is less than four days old. At four days, mark it **Abandoned -
no answer in 4 days** without re-asking, then carry any remaining defect as
internal work. For legacy replies without disclosure or eyes, search once per
connected actor and verify the author and thread.

End every new or edited Slack reply with the exact sentence
`this was sent from a bot.`. A connector-added `Sent using ChatGPT` footer is
not a substitute.

Keep `👀` as claim history while any scope is active, waiting, or unverified.
Reconcile each report as one unit: send or verify its current same-thread
status reply, then immediately add and read back the applicable reactions
before advancing to the next report. Add `✅` as soon as any reported scope is
verified **Fixed** under the Phase 2 bar, including a partial fix; use
**Partially fixed** for the overall disposition when another scope remains,
and describe both scopes separately in the reply. Do not wait for an entire
multi-symptom report to be resolved before checking off its verified scope.
An open PR can earn `✅` when a focused test or equivalent proof verifies the
source fix. Say that merge or rollout is still pending; the checkmark does not
claim the change is shipped or live.
Add `🎫` only for each distinct unfinished scope that needs a human to take
ownership or act; name the owner and action, and link a real ticket when one
exists. A partial fix with a separate human handoff can have both `✅` and
`🎫`. Work that remains with this workflow is active, not a human handoff. An
unanswered reporter request stays at `👀` without `🎫`.

Use the same connected Slack identity for reactions, replies, and read-back.
Compare exact actor IDs returned for the reaction and reply; do not describe a
separate “workflow identity” when the connector posts as the invoking user. An
explicit handoff from another eye owner permits investigation and a status
reply only; it does not transfer the eye or authorize changing that actor's
reactions. If the eye owner differs from the connected actor, or an actor ID
cannot be verified, record the mismatch and leave the item visibly
unreconciled for its owner. Do not claim that eye or create a duplicate reply
under another actor.
Never remove an eye or another person's reaction. If this workflow's own `✅`
or `🎫` is no longer justified, remove only that reaction if the connector
supports it and read back the corrected state. Otherwise record the exact
stale reaction and leave the report unreconciled.

An unanswered request for a reporter-provided URL, access grant, or evidence is
**Asked** or **Clarification needed**, not a separate human handoff. Keep `👀`
and state the exact question; do not add `🎫` solely for that wait. Use `🎫`
when another person must take a distinct review, ownership, or decision action
that this workflow cannot complete.

Preserve cluster handling: identify known duplicates before claiming them;
represent duplicate non-owner threads by permalink and **Clustered** in one
owner-thread status. Do not react or reply in a non-owner thread unless a
distinct question or update needs its own disposition; if it does, react and
reply there as a separate item. If a duplicate is discovered only after this
run added `👀`, keep it and post a concise **Clustered** reply with the owner
permalink; never remove the reaction.

Compare each reported symptom with the evidence. State what is fixed and what
is not. Use `✅` only for verified fixed scope. Use `🎫` for each distinct
unfinished scope that needs a human to take ownership or act, whether or not a
ticket exists. Link a verified ticket and name its owner/action; if no ticket
or owner is assigned, state the exact handoff and that gap in the reply and
ledger. Do not create or promise a ticket without authorization. Never imply a
partial fix resolved the whole report.

For beta app fixes, check the matching merge-triggered publisher, but keep its
details in the recap. In the reply, link the merged PR and say it merged, then
give the beta status in plain language. Say the behavior is live on beta only
after checking it there. While publication is queued or running, say the update
should arrive within about 24 hours. If publication finished but the app or
behavior is unavailable to check, say the beta update is out and briefly name
what could not be checked. If the publisher is missing or failed, give no ETA
and state the next action and owner. Leave commit hashes, branch names, CI
results, workflow or publisher details, and run IDs out of reporter replies.
For packages, link the merged PR and state availability without verification
details.

Read back the reaction and reply through the same connector, and verify their
actor IDs match the recorded sweep identity before recording the item as
replied.
