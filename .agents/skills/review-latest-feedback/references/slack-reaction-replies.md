# Slack Reaction Replies

Use the connected Slack integration for every Slack read and write. Never use a browser, screenshots, or UI automation to operate Slack.

At sweep exit, reconcile every report root in the scoped inventory that has
this task's `👀`, `✅`, or `🎫`, including marks left by earlier runs. Capture
the exact Slack actor ID used by the connected tool at sweep start. A mark is
owned by this task only when its reaction owner ID matches that actor ID and the
root is the workflow's by the parent skill's evidence: a bot-disclosure reply from
that account, or a root listed under "Claimed, not yet answered" in memory.md. A
matching reaction without that evidence is a manual mark: leave it alone. Keep
the disposition, evidence, scopes, and human actions in the internal inventory.
Post a reporter reply when this run adds a root reaction, or when a newer human
reporter message needs a direct answer. If the root asks a question, the reply answers it first. A reaction reply then uses one
short, plain-language sentence to explain only the reaction(s) added in this run. An
answer to a newer human message answers only that message. Do
not send progress, merge, or deployment updates. Never explain absent or
unchanged reactions or whether a tracker ticket exists. If reporter input is
needed, add `🎫` and ask one direct question in that reply. Read back each new
reaction and reply.

Keep prior replies as history. Do not edit or add a status reply merely to
describe changed evidence, an existing reaction, or completed follow-up work.
When a new reaction is added, use one short sentence plus the exact bot
disclosure.

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
report. Put new reactions for an ordinary report on its root; do not add another
`👀` to a reply just because it appears as a channel row. Preserve any legacy
reaction already on a reply, read it back, and reconcile the actual root
separately. A reply that raises a genuinely distinct issue stays in the source
manifest as a reply row, but scope, disposition, handoff, and checkoff evidence
belong to the actual root row. Record the distinct issue as a separate scope on
that root and verify it independently. Do not invent a second root or put a
root checkoff on the reply. Record both the source message timestamp and root
thread timestamp; if the connector hides `thread_ts`, resolve the permalink
before recording it.

The parent inventory must retain the reaction-owner IDs and the same-parent
reply timestamp, author ID, disposition, evidence, and read-back text for every
root this actor marks with `👀`, `✅`, or `🎫`. Record an explicit decision for
both `✅` and `🎫` on every such root: `present` with its scope, or `none` with
the reason no mark applies. Record verified fixed scopes with their proof and
each distinct human handoff with its scope, owner, and action. Before the recap, reconcile every owned root in the inventory by hand. Incomplete
source coverage or owned-root reconciliation means the sweep is not done. For
explicitly narrowed scope, keep the active user request as a separate record in
the inventory. This step does not authorize
changing another actor's reactions or replies.

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
processed messages. Read inherited threads carrying any of this actor's root marks (`👀`, `✅`,
or `🎫`): a checkmark closes only its verified scope, not a newer reporter
answer or another open scope. Do not reply or react on another actor's root
when work is handed off for investigation; that handoff permits local
investigation only. A separate explicit authorization is required to post a
reporter-facing reply or change that actor's reactions.

Count an answer only when a human posts after the question, without this
workflow's disclosure, and the reply addresses it. Read the full thread to
exclude partial, unrelated, or deferred answers; a newer human post reopens the
question. Attempt the fix with new evidence before asking again. Do not send a
progress reply when no reaction is added. Do not ask again while the question
is less than four days old. At four days, record **Abandoned - no answer in 4
days** internally without re-asking, then carry any remaining defect as
internal work. For legacy replies without disclosure or eyes, search once per
connected actor and verify the author and thread.

End every new or edited Slack reply with the exact sentence
`this was sent from a bot.`. A connector-added `Sent using ChatGPT` footer is
not a substitute.

Reactions are permanent history and do not replace the internal disposition.
At the root, `👀` records this workflow's claim, `✅` marks one or
more named scopes that passed direct post-change proof, and `🎫` tracks distinct
human/team actions, including actions with no named owner yet. The eye alone
does not mean work remains open. One root `✅` covers every verified scope
listed in `fixedScopes[]`; one root `🎫` covers every action listed in
`handoffs[]`, including unassigned, accepted, and completed actions. Completion
evidence changes its status, not the historical `🎫` reaction. Unclaimed items
and another actor's marks are not ours to reply to. Reconcile each report as
one unit: update and read back applicable root reactions before advancing to
the next report. Add `✅` once a reported scope passes the direct post-change proof bar on `main`.
An open PR never gets `✅`. Use
**Partially fixed** for the internal disposition when another scope remains.
Do not wait for an entire multi-symptom report to be resolved before checking
off its verified scope. Keep all existing reactions after scopes close. Read
back every reaction and any reply sent. Never remove or clean up any reaction.
While a fix PR is open, `👀` may remain; `✅` still waits for the merge to `main`.
The marks are independent. The current disposition says what remains.
For UI behavior, a focused
regression qualifies only if it exercises the changed component and asserts the
reported visible result or persisted state; callback-only assertions, mocked
children, class-name checks, and source inspection do not. For clipping,
wrapping, contrast, or alignment, inspect rendered geometry at the reported
viewport or replay the flow in the running app. Use an app/preview replay when
the regression does not meet that bar. For non-UI scopes, use the area-specific
action, query, or test proof. Record merge or rollout state in the internal
inventory; the checkmark records a verified scope and does not claim it is
shipped or live.
Before leaving each report, compare verified scopes and human/team handoffs
with a fresh root-reaction read. Ensure one `✅` is present when any scope is fixed on `main`, and one `🎫` whenever any distinct unfinished action requires another
person or team to act, even before ownership is assigned or accepted. Keep the
mark as history after completion; read back each changed root reaction and
verify its owner. Record whether each mark applies and any historical-reaction
details in the internal inventory only; never explain missing reactions in a
reporter reply. Emoji text in a reply is not a reaction. Preserve every
existing reaction. If later proof invalidates a prior checkmark, move that
scope out of active `fixedScopes[]` and add a `historicalReactionMarks[]` entry
with `emoji`, `scope`, `reason`, and the exact prior `previousStatus`. If the
owner withdraws an accepted action tracked by `🎫`, preserve the exact earlier
accepted `handoff` and owner `withdrawalReply`, then update the internal record.
Keep these records consistent with the captured thread; never remove
or clean up a reaction.
Add `🎫` for each distinct unfinished team or engineering action that another
person or team must perform outside this workflow, whether or not a named
person has accepted it or an external tracker ticket exists. Record each such
action in `handoffs[]`
with its exact scope, action, and responsible person/team; when no person owns it, use the team/role
or `unassigned` as `owner` and set `status: "unassigned"`. Do not invent a
person, Slack ID, request, or acceptance. If a named human later accepts,
record their Slack ID and exact acceptance reply and change the status to
`"accepted"`; when the accepted action is done, use `status: "completed"` with
completion evidence. The `🎫` reaction remains as history after completion and
no longer counts as an open blocker. Only a later owner withdrawal removes an
accepted action from current handoffs and uses the historical-mark record. An
unambiguous contextual “yes”/“sure” may accept a
preceding direct request when it names the human and exact action. That request
may ask whether the named person's TODO or PR already includes the action; a
clear “yes, it's on my PR” with a stated next step such as “taking a look now”
counts. Record both
the request and acceptance reply, including timestamps and actor IDs. The
human's explicit first-person commitment to the recorded action also counts,
even without a preceding request (for example, “I'll test this today” or “I'll
expand it to all apps”). Record that exact acceptance reply. Tentative language
such as “I might test this” is not acceptance. Keep acceptance and refusal verbs
consistent with the examples in this file.
The `🎫` reaction covers only that recorded action: do not infer a broader fix,
PR, or delivery promise. A role assignment, generic team ping, or ask without a reply
is not acceptance, but it still gets `🎫` when a distinct team action remains
unfinished. Ambiguous or hedged assent does not change `status: "unassigned"`.
A partial fix with a separately unfinished human/team action can have both
`✅` and `🎫`.
Work that remains with this workflow is active and needs no `🎫` by itself, but a fix
this workflow could not land gets `🎫` as a human handoff, matching the parent skill.
Requests for a reporter-provided URL, access, evidence, or clarification are
separate human actions, not team handoffs. Record them only in
`reporterRequests[]`; they still get `🎫` while outstanding, as described below.
Do not duplicate a reporter request in `handoffs[]`.
When this workflow asks a reporter for a URL, access, evidence, or clarification,
record the requested action in `reporterRequests[]` and add/read back `🎫` while
that request is open. This tracks a requested human action; it is not a team
handoff and does not claim accepted ownership. When the reporter answers, or
after four days with no later human reply, move it out of active
`reporterRequests[]` and preserve the root mark in `historicalReactionMarks[]`.
Keep its original `scope`, `action`, `requestReply`, and ticket-bearing
`previousStatus` under `closedReporterRequest`. For an answer, set
`resolution: "answered"` and include the exact human `closureReply` from the
same thread. For an unanswered request,
set `resolution: "abandoned_no_answer"` only after four days with no later human
reply, and omit `closureReply`. Keep the historical action and its evidence in
the internal inventory. Link an external tracker ticket only
if one already exists; do not create or promise one without authorization. If a
human later refuses the accepted action, preserve `🎫` as history and record
the refusal and blocker in the internal inventory.

Use the same connected Slack identity for reactions, replies, and read-back.
Compare exact actor IDs returned for the reaction and reply; do not describe a
separate “workflow identity” when the connector posts as the invoking user. An
explicit handoff from another eye owner permits investigation only; it does
not transfer the eye or authorize changing that actor's reactions. If the eye
owner differs from the connected actor, or an actor ID cannot be verified,
record the mismatch internally and leave the item unreconciled for its owner.
Do not claim that eye or create a duplicate reply under another actor.
Never remove or clean up another person's or this workflow's reaction. When
new evidence changes the meaning of an existing mark, preserve it and update
the internal disposition and inventory. Read back every new reaction and reply.

An unanswered request for a reporter-provided URL, access grant, evidence, or
clarification is **Asked** or **Clarification needed** and remains an open
requested human action: record it in `reporterRequests[]`, keep `👀`, and
add/read back `🎫`. Ask the direct question in the short reply that accompanies
the new `🎫`. It is not a team handoff, so it does not require or imply an
accepted owner in `handoffs[]`.
When no other person needs to act and only this workflow owns the next step, do
not add `🎫`.

Resolve duplicate clusters before claiming. Record non-owner duplicates by
permalink and **Clustered** in the internal inventory; do not send a status
reply solely to report clustering. For a late duplicate that already has `👀`,
recheck ownership. If this task still owns it, keep the eye and record its
owner permalink; do not send a second owner update. If another task owns it or
ownership is unclear, preserve the eye, record the source in your run notes, and
stop. Keep
distinct scopes and their status clear.

Compare each reported symptom with the evidence in the internal inventory.
Use one root `✅` when at least one fixed scope is merged to `main` and verified; it covers every
verified scope listed in `fixedScopes[]`, with proof recorded internally. Use
one root `🎫` whenever at least one distinct unfinished action
requires another person to act; it covers the actions listed in `handoffs[]`
and active requests in `reporterRequests[]`. Handoffs include unassigned
actions and completed actions whose evidence and `status: "completed"` remain
in your run notes; reporter requests stay active only while the requested input is
outstanding.
Do not add duplicate copies of either reaction for additional scopes. Link an
external tracker ticket if there is one. Record a person's Slack ID and exact reply
only after that person accepts; until then record the responsible team/role or
`unassigned` and set `status: "unassigned"`. Keep `👀` while work remains. An open reporter request gets `🎫` even though it is not a team handoff; a
team handoff also gets `🎫`. Do not create or promise an external tracker
ticket without authorization. Never imply a
partial fix resolved the whole report.

For beta and package fixes, verify publisher and release state and keep the
details in the internal recap. Do not send progress or deployment narration.
If this run adds a reaction, explain only that new reaction in the short reply.
Keep technical details, IDs, CI, workflow details, and run IDs out of reporter
replies.

For every reply in each final full-thread snapshot, record a read-back of the
workflow reactions on that reply. If the connector shows `👀`, `✅`, or `🎫`,
call `slack_get_reactions` for the reply's own timestamp and record exact owner
IDs for those workflow emoji; record `"none"` with `{}` when none appears and
omit unrelated emoji. These reads are separate from the root read-back. Do not
add new workflow reactions to replies. Preserve any legacy reply-level mark and
record its exact message timestamp and owner; then audit the report root
independently. A reply mark never checks off the root scope. Keep it attributed; never move
or remove it.

Read back the reaction and any reply through the same connector, and verify
their actor IDs match the recorded sweep identity before recording the item as
replied. Keep the full mark, scope, and action inventory internally. In the
user-facing recap, mention only reactions added in this run and explain them
briefly. Do not explain absent or unchanged reactions or whether a tracker
ticket exists. Keep any existing ticket link in the internal inventory. Do not
balance reactions for appearance. Treat
reaction text in a reply, another actor's mark, or a reply-row reaction as no
substitute for the required root read-back.
