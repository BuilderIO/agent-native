# Slack Reaction Replies

Use the connected Slack integration for every Slack read and write. Never use a browser, screenshots, or UI automation to operate Slack.

At sweep exit, reconcile every unheld report root in the scoped inventory that
has this task's `👀`, `✅`, or `🎫`, including marks left by earlier runs. A
root is held when a direct reaction read shows another actor owns any workflow
mark or this actor owns `:mag:`. For held roots, record the root and safe-skip
reason, then stop: do not open the thread, inspect reply reactions, write any
reaction, or post a status. When this actor owns both `:mag:` and a workflow
mark, use `mag_opt_out` and preserve the exact direct root reaction-owner
record as history; the root remains held without a thread read or status reply.
Capture
the exact Slack actor ID used by the connected tool at sweep start. A mark is
owned by this task only when its reaction owner ID matches that actor ID. Each
unheld owned root needs a current same-actor status reply under the same parent.
Reuse it while the disposition remains current; send one short update when it
materially changes, including after a linked PR merges. Write one short sentence
in plain, non-technical language. Say what changed. Use `🎫` only for unresolved
work; when you use it, briefly say what still needs investigation or what action
is needed, and name its owner when known. Do not mention or explain absent
reactions. Keep scope, evidence, and handoff details in the internal ledger.

For a beta-eligible app PR, wait until the matching run selects the affected
site. Include the PR link and say: "[PR link] is merged and expected on beta
within 24 hours." This is an expectation, not a guarantee. Say it is on beta
only when `/ship-and-monitor` or an explicitly requested beta check verifies
the site is current. Normal feedback sweeps do not wait for publication, verify
the site, or keep checking it. If a later in-scope beta check finds a publish
failure or the site is still not current after 24 hours, the person running
that check owns the correction in the same thread. Do not assign a future check
to a sweep after it ends. Do not claim it is live until checked.

For a recent unanswered reporter question, reuse the existing same-actor
question/update as the status reply when it still reflects the disposition. If
it does not, post at most one concise update that points to the question
without asking it again; then wait silently. Do not send another question or
progress ping before the four-day rule below. An evidence-only addendum or
correction is not a current status; edit it into a concise disposition when
possible, or send one status after the latest human reply.

Keep full proof, scope, and handoff details in the internal ledger. When an
active `🎫` action remains, record its brief plain-language summary as
`statusReply.pendingActionSummary` and include that summary in the short reply.
Do not explain absent reactions or list every scope. End with the exact bot
disclosure and read the visible reply and root reactions back.

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
each distinct human handoff with its scope, owner, and action. In the framework
repository, run
`pnpm feedback:inventory-check -- .tmp/feedback-inventory.json .tmp/feedback-source-receipt.json .tmp/feedback-source-pages [.tmp/feedback-scope-confirmation.json]`
before the recap. The first three inputs are required; the fourth is required
for explicitly narrowed scope and must be a separate record of the active user
request. The checker validates that record against the inventory but cannot
authenticate the original request. A failed check means source coverage or
owned-root reconciliation is incomplete. The checker does not authorize
changing another actor's reactions or replies.

## Prior questions and reporter replies

At sweep start, search the exact bot disclosure in each scoped channel and
exhaust the pages to find prior questions and their context:

```text
slack_search: "this was sent from a bot." in:<#CHANNEL>
  sort=timestamp sort_dir=asc include_context=true max_context_length=300
```

Also scan channel messages from the saved reply cursor within the current
invocation's fixed window; on the first run, use the default five-day window,
not all available history. Since `after:` is date-only, start one day before
the later of the saved cursor and window start, exhaust pages, resolve hits to
their root, and advance the cursor only through processed messages. An older
root is eligible only when an in-window reply links to it. Read inherited
threads carrying any of this actor's root marks (`👀`, `✅`,
or `🎫`): a checkmark closes only its verified scope, not a newer reporter
answer or another open scope. Do not reply or react on another actor's root when work is handed off for investigation; that handoff permits local investigation only. A separate explicit authorization is required to post a status or reporter reply there.

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

Reactions are permanent history and do not replace the current disposition or
status reply. At the root, `👀` records this workflow's claim, `✅` marks one or
more named scopes that passed direct post-change proof, and `🎫` tracks distinct
human/team actions, including actions with no named owner yet. The eye alone
does not mean work remains open. One root `✅` covers every verified scope
listed in `fixedScopes[]`; one root `🎫` covers every action listed in
`handoffs[]`, including unassigned, accepted, and completed actions. Completion
evidence changes its status, not the historical `🎫` reaction. For every
unheld root carrying any of this actor's marks, post or reuse a current status
in that root's thread; unclaimed items, held roots, and another actor's marks
are not ours to reply to. Reconcile
each report as one unit: send or verify its current same-thread status reply,
then immediately update and read back each applicable root reaction before
advancing to the next report. Add `✅` as soon as any reported scope passes the
direct post-change proof bar, including before merge; use
**Partially fixed** for the overall disposition when another scope remains,
and record both scopes in the internal ledger. Keep the reply short; do not
wait for an entire
multi-symptom report to be resolved before checking off its verified scope.
Keep all existing reactions after scopes close. Post the final disposition and
read back the final reply and reactions; the status shows closure while the
eye remains as history. Never remove or clean up any reaction. An open PR can
earn `✅` as soon as the relevant
`verifying-changes` proof bar passes. During that period, `✅` marks the
verified scope and `👀` may remain whether or not another scope or merge is
open; the marks are independent. The internal ledger records what remains.
For UI behavior, a focused
regression qualifies only if it exercises the changed component and asserts the
reported visible result or persisted state; callback-only assertions, mocked
children, class-name checks, and source inspection do not. For clipping,
wrapping, contrast, or alignment, inspect rendered geometry at the reported
viewport or replay the flow in the running app. Use an app/preview replay when
the regression does not meet that bar. For non-UI scopes, use the area-specific
action, query, or test proof. Record merge or rollout state in the internal
ledger; the checkmark records verified scope and does not claim it is shipped
or live.
Before leaving each report, compare verified scopes and human/team handoffs
with a fresh root-reaction read. Ensure one `✅` is present when any scope passed the
proof bar and one `🎫` whenever any distinct unfinished action requires another
person or team to act, even before ownership is assigned or accepted. Keep the
mark as history after completion; read back each changed root reaction and
verify its owner. Record why a mark is absent in the internal ledger. Never
explain absent `👀` or `✅` in a Slack reply. Emoji text in a reply is not a
reaction. Preserve every existing reaction. If later proof invalidates a prior
checkmark, move that scope out of active `fixedScopes[]` and add a
`historicalReactionMarks[]` entry with `emoji`, `scope`, `reason`, and the exact
prior `previousStatus`; keep the explanation in the internal ledger rather
than the Slack reply. If the owner withdraws an accepted action
tracked by `🎫`, also preserve the exact earlier accepted `handoff` and owner
`withdrawalReply`, and move it out of current `handoffs[]`. Keep that history
in the internal ledger. Preserve the recorded evidence and historical action in
the ledger; do not repeat a closed handoff in Slack unless a current action
remains. When a recorded action has a validated `publicActionSummary`, it may
be used for a current `🎫` summary. The checker validates it against the
recorded action and captured thread; never remove or clean up a reaction.
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
covered by the inventory checker's self-tests.
The `🎫` reaction covers only that recorded action: do not infer a broader fix,
PR, or delivery promise. A role assignment, generic team ping, or ask without a reply
is not acceptance, but it still gets `🎫` when a distinct team action remains
unfinished. Ambiguous or hedged assent does not change `status: "unassigned"`.
A partial fix with a separately unfinished human/team action can have both
`✅` and `🎫`.
Work that remains with this workflow is active and needs no `🎫` by itself.
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
reply, and omit `closureReply`. The internal ledger must identify the
historical action and explain why its mark remains; do not explain it in the
Slack reply unless a current follow-up remains. Link an external tracker ticket only
if one already exists; do not create or promise one without authorization. If a
human later refuses the accepted action, preserve `🎫` as history and update
the status with the refusal and blocker.

Use the same connected Slack identity for reactions, replies, and read-back.
Compare exact actor IDs returned for the reaction and reply; do not describe a
separate “workflow identity” when the connector posts as the invoking user. An
explicit handoff from another eye owner permits investigation and a status
reply only; it does not transfer the eye or authorize changing that actor's
reactions. If the eye owner differs from the connected actor, or an actor ID
cannot be verified, record the mismatch and leave the item visibly
unreconciled for its owner. Do not claim that eye or create a duplicate reply
under another actor.
Never remove or clean up another person's or this workflow's reaction. When
new evidence changes the meaning of an existing mark, preserve it and update
the current disposition, status reply, and inventory. Read back every new
reaction and status update.

An unanswered request for a reporter-provided URL, access grant, evidence, or
clarification is **Asked** or **Clarification needed** and remains an open
requested human action: record it in `reporterRequests[]`, keep `👀`, and
add/read back `🎫`. State the exact question in the current status. It is not a
team handoff, so it does not require or imply an accepted owner in `handoffs[]`.
When no other person needs to act and only this workflow owns the next step, do
not add `🎫`.

Resolve duplicate clusters before claiming. Represent non-owner duplicates
by permalink and **Clustered** in one owner-thread status; do not react or reply
separately unless a distinct question needs its own disposition. For a late
duplicate that already has `👀`, recheck ownership. If this task still owns it,
keep the eye and post one concise **Clustered** reply with the owner permalink;
do not send a second owner update. If another task owns it or ownership is
unclear, preserve the eye, record the source in the ledger, and stop. Keep
distinct scopes and their status clear.

Compare each reported symptom with the evidence. If the report is only partly
fixed, say so briefly and keep the scope details in the ledger. Use one root
`✅` when at least one fixed scope is verified; it covers every
verified scope listed in `fixedScopes[]`, which the internal ledger must name
with its proof. Use one root `🎫` whenever at least one distinct unfinished action
requires another person to act; it covers the actions listed in `handoffs[]`
and active requests in `reporterRequests[]`. Handoffs include unassigned
actions and completed actions whose evidence and `status: "completed"` remain
in the ledger; reporter requests stay active only while the requested input is
outstanding.
Do not add duplicate copies of either reaction for additional scopes. Link an
external tracker ticket if there is one. Record a person's Slack ID and exact reply
only after that person accepts; until then record the responsible team/role or
`unassigned` and set `status: "unassigned"`. Keep `👀` while work remains. An open reporter request gets `🎫` even though it is not a team handoff; a
team handoff also gets `🎫`. Do not create or promise an external tracker
ticket without authorization. Never imply a
partial fix resolved the whole report.

For beta app fixes, keep publisher details in the recap. After a linked
beta-eligible app PR merges and is confirmed in `origin/main`, wait for the
matching run to select the affected site. Then reply once in its owned thread
with the PR link and say it is expected on beta within 24 hours. This is an
expectation, not a guarantee. Say it is on beta only when `/ship-and-monitor`
or an explicitly requested beta check verifies the site is current. Normal
feedback sweeps do not wait for publication, verify the site, or keep checking
it. If a later in-scope beta check finds a publish failure or the site is still
not current after 24 hours, the person running that check owns the correction
in the same thread. Do not assign a future check to a sweep after it ends. Use
`🎫` only when another person or team must act. Keep hashes, branch names, CI,
workflow details, and run IDs out of reporter replies. For package work,
distinguish the source PR from any release PR and registry proof; source merge
alone does not establish publication. Give no ETA for a pending package
release.

For every reply in each final full-thread snapshot, record a read-back of the
workflow reactions on that reply. If the connector shows `👀`, `✅`, or `🎫`,
call `slack_get_reactions` for the reply's own timestamp and record exact owner
IDs for those workflow emoji; record `"none"` with `{}` when none appears and
omit unrelated emoji. These reads are separate from the root read-back. Do not
add new workflow reactions to replies. Preserve any legacy reply-level mark and
record its exact message timestamp and owner; then audit the report root
independently. A reply mark never checks off the root scope, and the inventory
checker requires the reply mark to be attributed without requiring it to be
moved or removed.

Read back the reaction and reply through the same connector, and verify their
actor IDs match the recorded sweep identity before recording the item as
replied. In the final recap, count marks by distinct report root and this
actor's reaction-owner IDs: historical `👀` marks, verified `✅` scopes, and
unfinished human/team actions tracked by `🎫`; report accepted and unassigned
actions and reporter requests separately. Count active/open dispositions
from the latest status separately; an eye does not say whether work remains
open. Explain why an open scope has no `✅` and why `🎫` is absent when no
other person needs to act. Do not omit a ticket because a reporter request is
not a team handoff. Do not balance reactions for appearance. Treat
reaction text in a reply, another actor's mark, or a reply-row reaction as no
substitute for the required root read-back.
