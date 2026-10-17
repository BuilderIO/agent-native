# Slack Reaction Replies

At sweep exit, reconcile every report root in the scoped inventory that has this
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
label; reject the whole reply if a `Fixed` label is later contradicted by a
claim that the scope remains not fixed, unfixed, or broken. Use `Partially
fixed` while any distinct handoff remains unfinished.
This is one current status reply per owned eye, not a reply on every sweep.
Reuse the existing same-actor reply while its disposition and evidence remain
current; send an update when either materially changes. For a recent
unanswered reporter question, reuse the existing same-actor question/update as
the status reply when it states the disposition and evidence. If it does not,
post at most one concise status update that points to the existing unanswered
question without asking it again; then wait silently. Do not send another
question or progress ping before the four-day rule below. When a disposition
includes a human handoff, the status reply must name every handoff's recorded
owner and action; include its scope when the report context does not make it
clear.

When editing an ordinary Slack reply, pass its visible body as
`message.markdown_text` to `slack_edit_message`; `message.text` is a fallback
for structured block messages and may leave the visible reply unchanged. Treat
the returned message ID as acknowledgment only. Read the exact reply back with
`slack_read_thread` and compare the stored body to the intended status before
counting it as posted. Use `slack_send_message` only when a new reply is
needed, with its `message` field and the root `thread_ts`.

`slack_read_thread` may append a synthetic `Status marks:` summary after the
thread. That is connector metadata, not part of any Slack message; do not copy
it into a reply. Likewise, omit connector-added `Sent using ChatGPT` footer
text from the intended body. `slack_send_message` may append that footer to a
new reply; if it does, remove it by editing with `message.markdown_text`, then
read the reply back again. Include the exact bot disclosure in the visible body
yourself; the connector footer is not a substitute.

Apply reactions to the report root, not the status reply: call
`slack_add_reaction` with the root's `channel_id`, its timestamp as
`message_ts`, and the emoji name without colons (`eyes`, `white_check_mark`, or
`ticket`). A colon-coded emoji mentioned in reply text does not add a reaction.
After each reaction call, read the root with `slack_get_reactions` and verify
the intended emoji and this actor's ID are present before recording it or
moving to another report. A successful tool response is only an acknowledgment;
the readback is the proof. If a reaction cannot be reconciled, record the exact
blocker instead of treating the reply text as a substitute.

Channel reads may expose a thread reply as a separate row. Resolve its
`thread_ts` or permalink and inventory it as a reply to the root, not as a new
report. Put reactions for an ordinary report on its root; do not add another
`👀` to a reply just because it appears as a channel row. If an earlier run put
this task's mark on a reply by mistake, remove only that mark from the reply,
read the reply's reactions back, and reconcile the actual root separately. A
reply that raises a genuinely distinct issue may be tracked as its own source
row with a separate disposition, but it still belongs to its actual root
thread. Record both the source message timestamp and root thread timestamp; if
the connector hides `thread_ts`, resolve the permalink before recording it.

The parent inventory must retain the reaction-owner IDs and the same-parent
reply timestamp, author ID, disposition, evidence, and read-back text for every
owned root eye. Record an explicit decision for both `✅` and `🎫` on every owned
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
question. Attempt the fix with new evidence before asking again. Do not ask
again while the question is less than four days old; after the one-time status
reconciliation above, wait silently without another question or progress ping.
At four days, mark it **Abandoned - no answer in 4 days** without re-asking,
then carry any remaining defect as internal work. For legacy replies without
disclosure or eyes, search once per connected actor and verify the author and
thread.

End every new or edited Slack reply with the exact sentence
`this was sent from a bot.`. A connector-added `Sent using ChatGPT` footer is
not a substitute.

Use reactions as current status, not permanent claim history. At the root,
`👀` marks this workflow's open claim, `✅` marks one or more named scopes that
passed direct post-change proof, and `🎫` marks an accepted handoff to a named
human. The single root `✅` covers the verified scopes listed in
`fixedScopes[]`. A partial fix can show both `👀` and `✅`. For every `👀` this
workflow owns, post a current status in that
root's thread; unclaimed items and another actor's eyes are not ours to reply
to. Reconcile each report as one unit: send or verify its current same-thread
status reply, then immediately update and read back the applicable reactions
before advancing to the next report. Add `✅` as soon as any reported scope
passes the direct post-change proof bar, including before merge; use
**Partially fixed** for the overall disposition when another scope remains,
and describe both scopes separately in the reply. Do not wait for an entire
multi-symptom report to be resolved before checking off its verified scope.
Keep your own `👀` while any report scope or follow-up remains open. After all
scopes and follow-ups close, post the final status, remove only your own eye,
and read back the final reply and reactions. An eye is not kept as claim
history after work closes. If the connector cannot remove it, use Slack UI; if
that is also unavailable, record the exact blocker and leave the reaction
unreconciled. An open PR can earn `✅` as soon as the relevant
`verifying-changes` proof bar passes. During that period, `✅` marks the
verified scope and `👀` remains for the open merge or another unresolved
scope/follow-up; the marks are independent. For UI behavior, a focused
regression qualifies only if it exercises the changed component and asserts the
reported visible result or persisted state; callback-only assertions, mocked
children, class-name checks, and source inspection do not. For clipping,
wrapping, contrast, or alignment, inspect rendered geometry at the reported
viewport or replay the flow in the running app. Use an app/preview replay when
the regression does not meet that bar. For non-UI scopes, use the area-specific
action, query, or test proof. Say that merge or rollout is still pending; the
checkmark records the verified scope and does not claim it is shipped or live.
Add `🎫` only after a different named human accepts a specific unfinished
action in the source thread. An unambiguous contextual “yes”/“sure” may accept a
preceding direct request when it names the human and exact action; record both
the request and acceptance reply, including timestamps and actor IDs. The
ticket covers only that requested action: do not infer a broader fix, PR, or
delivery promise. A role assignment, generic team ping, ask without a reply, or
ambiguous/hedged assent is not acceptance. A partial fix with a separately
accepted handoff can have both `✅` and `🎫`.
Work that remains with this workflow is active, not a human handoff. An
unanswered reporter request stays at `👀` without `🎫`. Link a ticket only if
one already exists; do not create or promise one without authorization. If a
human later refuses the accepted action, remove only your stale `🎫`, keep
`👀`, and report the blocker.

Use the same connected Slack identity for reactions, replies, and read-back.
Compare exact actor IDs returned for the reaction and reply; do not describe a
separate “workflow identity” when the connector posts as the invoking user. An
explicit handoff from another eye owner permits investigation and a status
reply only; it does not transfer the eye or authorize changing that actor's
reactions. If the eye owner differs from the connected actor, or an actor ID
cannot be verified, record the mismatch and leave the item visibly
unreconciled for its owner. Do not claim that eye or create a duplicate reply
under another actor.
Never remove another person's reaction. Remove only this workflow's own `👀`,
`✅`, or `🎫`, and only when its status rule no longer applies; read back the
corrected state. If the connector cannot remove an own reaction, use Slack UI;
if that is also unavailable, record the exact blocker and leave the report
unreconciled.

An unanswered request for a reporter-provided URL, access grant, or evidence is
**Asked** or **Clarification needed**, not a separate human handoff. Keep `👀`
and state the exact question; do not add `🎫` solely for that wait. Use `🎫`
only after a named person accepts that distinct action in the source thread. A
role or requested handoff without acceptance does not qualify.

Preserve cluster handling: identify known duplicates before claiming them;
represent duplicate non-owner threads by permalink and **Clustered** in one
owner-thread status. Do not react or reply in a non-owner thread unless a
distinct question or update needs its own disposition; if it does, react and
reply there as a separate item. If a duplicate is discovered after this run
added `👀`, record its permalink in the owner's **Clustered** status. Remove
only your own eye from the duplicate after its scope and follow-ups close; keep
it while a distinct question or update remains open.

Compare each reported symptom with the evidence. State what is fixed and what
is not. Use `✅` only for verified fixed scope. Use `🎫` only for each distinct
unfinished scope accepted by a named human; link an existing ticket if there is
one, and record the person's Slack ID, exact acceptance, and action. If nobody
has accepted, keep `👀` and state who still needs to act or what reporter input
is needed, with no `🎫`. Do not create or promise a ticket without
authorization. Never imply a partial fix resolved the whole report.

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

For every reply in each final full-thread snapshot, record a read-back of the
workflow reactions on that reply. If the connector shows `👀`, `✅`, or `🎫`,
call `slack_get_reactions` for the reply's own timestamp and record exact owner
IDs for those workflow emoji; record `"none"` with `{}` when none appears and
omit unrelated emoji. These reads are separate from the root read-back. The
checker rejects any of this actor's workflow marks on a reply, so remove only
this actor's misplaced reply mark and verify the reply again.

Read back the reaction and reply through the same connector, and verify their
actor IDs match the recorded sweep identity before recording the item as
replied. In the final recap, count marks by distinct report root and this
actor's reaction-owner IDs: open `👀` claims, verified `✅` scopes, and
`🎫` handoffs accepted by a named person. Explain why an open scope has no
`✅` and why an unfinished action has no `🎫`; a low count is valid when no
scope has passed verification or nobody has accepted a separate action. Do not
balance reactions for appearance. Treat reaction text in a reply, another
actor's mark, or a reply-row reaction as no substitute for the required root
read-back.
