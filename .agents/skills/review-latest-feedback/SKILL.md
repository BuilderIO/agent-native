---
name: review-latest-feedback
description: >-
  Review the newest unhandled Slack, GitHub issue, and Sentry feedback, fix
  clear verified repo bugs at the owning boundary, ship verified fixes, and
  recap every disposition. Use for scheduled or manual feedback sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Latest Feedback

Run a bounded, evidence-first, cross-app sweep across Agent-Native feedback
sources. Resolve repo-owned bugs at their seam; do not encode reports
globally or stop at triage. Every run leaves a disposition, including
why items remain open. Cluster symptoms under a Builder thread and cursor.

This is a reply-producing workflow, not a reaction-only workflow. Apply
`address-feedback-with-replies` to Slack items. Any own `👀` enters a ledger:
re-read it before finishing and verify the invoking identity posted **Fixed**,
**In progress**, or **Clarification needed**. **In progress** requires existing
ownership and must be revisited; an eye, bot forward, or other person's reply
alone is never enough.

## Scope: clear bugs only

This is a bug sweep, not a general UX review. “Comprehensive” means covering
every clear bug in the bounded window, not reacting to every message. A clear
bug has observable broken behavior: a click or submit does nothing, an action
errors, data is lost or reverted, the result is wrong, or a working flow
regressed. Treat a credible “nothing happens” report as valid evidence; do not
ask the reporter to prove the click before inspecting the owning path.

Do not add `👀`, ask a question, reply, or change code for a preference,
product idea, copy or layout suggestion, praise, status update, merge/review
request, bot forward, duplicate, or other random message. Do not turn a
subjective UX concern into a product decision by asking which option people
prefer. Design feedback, including Design clips and imported-design usability,
routes to Sid and is not addressed in this sweep. Content remains with Alice.

If an older run already added `👀` to an out-of-scope item, undo that reaction
with the connected Slack removal action when one is available. Do not reply,
ask a compensating question, investigate it as a bug, or add another reaction.
If a mistaken status reply from this workflow is already there, delete it when
that is safe; otherwise edit that existing reply to a brief `Skipped` note.
If the connector cannot remove reactions, record the exact parent for manual
cleanup and leave the thread otherwise untouched. New items must pass the
clear-bug gate before any external write.

## Start cursor

Use the product feedback Slack channel configured for the workspace. In this
repository that is currently `#product-agent-native-feedback` (`C0ATH3CCZT4`);
if the invocation names another channel, use that channel instead.

Scan the channel newest to oldest and choose the most recent clear-bug parent
without a verified disposition from the invoking Slack identity - **Fixed**, an
open **In progress** ownership reply, or an open **Clarification needed**
question. An `👀` reaction is only an investigation marker and never suppresses
the scan. A thread with only `👀`, or with **In progress**, remains open until
the invoking identity's disposition is verified. Do not treat an unrelated
reply, bot forward, or vague status update as terminal; prior replies count
only when their read-back matches the invoking identity.

That message is the start cursor. Classify it, record it if it is not
actionable, then continue toward older messages, processing each actionable
message that is still unhandled. Read the full parent, every reply and
reaction, and all linked issues, PRs, screenshots, runs, and commits before
deciding. The candidate worklist stays cross-app and cross-source: later scope
clarifications add eligible categories; they never remove identified clear-bug
Slack, GitHub, or Sentry candidates. Keep the worklist focused on objective
failures and carry every clear bug into the final disposition.

For GitHub issues and Sentry, use their native state and links as corroborating
cursor signals: prioritize recent open or unresolved items with no clear
maintainer disposition, then deduplicate them against the Slack set. If a
source cannot be read, record that source as unavailable; never report
“nothing matched” for an unavailable source.

Keep the cursor at the first unhandled parent, but fold older messages that are
clearly the same symptom into that cluster instead of reopening a new thread for
each duplicate. Continue to older messages only after the cluster is recorded
and every grouped report has an auditable disposition.

## Full-thread evidence gate

Before asking a reporter for anything, re-read the complete parent thread to
the end, including every reply, reaction, attachment, linked artifact, and
newer follow-up. Paginate until there are no more replies. Build a small
evidence ledger for the thread with the values already known - surface or app,
URL, account or session, repro steps, exact error, screenshot or file, run or
request ID, and the answer to each earlier question - and a separate list of
what is still missing. Keep a separate list of linked artifacts that are
present but inaccessible because of permissions, expiry, connector gaps, or
another read failure. Treat an attachment or an earlier reply as evidence to
inspect, not as a reason to ask for the same thing again; inaccessible evidence
is not the same as absent evidence.

The clarification question must be derived from that missing-evidence list.
Never ask for a URL, screenshot, error, run ID, or repro detail that is already
in the parent or a reply. If any participant supplies it later, re-read the
whole thread before doing anything else, remove that field from the missing
list, and try the fix from the new evidence before asking another question. If
the answer only partially or incidentally fills the gap, keep the original
clarification pending rather than stacking a second question. Ask a new
question only after the exact earlier request is answered or resolved and one
specific, non-repeating detail still blocks the fix. If a needed linked artifact
is inaccessible, ask for access or a fresh/replacement link rather than asking
for the artifact's contents again. If the available evidence is enough without
it, continue and record the limitation instead of creating a reporter blocker.

There may be only one unanswered clarification request per thread. Before
posting, re-read the complete thread for an earlier question from this
workflow, the companion `address-feedback-with-replies` workflow, or the
`@agent-native` bot and determine whether its exact requested detail has been
semantically answered or explicitly resolved anywhere in the thread. A partial
or unrelated reply does not clear the pending request. If no answer or
resolution exists, leave that request as the sole pending handoff and record
its timestamp; do not stack another question in the same thread. After the
requested detail is answered or resolved, re-read the thread and attempt the
fix first. Ask a new question only when one specific, non-repeating detail
still blocks the fix.

## Answered clarifications come first

A clarification is a pending state, not a disposition. Before new-message
scanning, re-read every open question from this workflow, its companion, or
`@agent-native`, oldest first. If any participant answers or resolves the exact
request, rebuild the evidence and attempt the underlying clear-bug fix first;
then replace the question with **Fixed** when verified. A partial or unrelated
reply leaves the one request pending, with no duplicate question. Ask again
only for one specific, non-repeating blocker. An answered subjective product
question does not re-enter triage; leave it with its owner.

## Clarification follow-up aging

A clarification is a pending work item, not a reason to wait forever. When a
**Clarification needed** reply is posted, record its timestamp and schedule a
recurring recheck - every four hours is the default unless the invocation gives
another interval. Each recheck must re-read the complete thread, look for a new
reporter answer, and re-enter triage immediately if one arrived. Do not post a
duplicate reminder just because the scheduled check ran.

### Durable tracking and discovery

The Slack thread is the source of truth for the question and reporter answer;
the cross-run workflow state lives in the task-scoped JSON ledger at
`$XDG_STATE_HOME/review-latest-feedback/<codex_task_id>/clarification-ledger.json`
when `XDG_STATE_HOME` is set, otherwise
`~/.codex/state/review-latest-feedback/<codex_task_id>/clarification-ledger.json`
(or under the task-scoped directory supplied by
`REVIEW_LATEST_FEEDBACK_LEDGER_DIR`, with the same `<codex_task_id>` suffix).
Never accept one shared complete-path override for multiple tasks. For a
thread-target schedule, use its stable target thread id. For a global schedule
that starts a fresh run on every tick, use the persisted schedule id or another
persistent heartbeat target id that the scheduler passes into every run. Never
derive `<codex_task_id>` from a fresh per-tick run id. If the scheduler cannot
expose a stable id, require the external persistence mechanism to provide one
before claiming scheduled coverage. This is local Codex state, not a recap and
not a file committed to
a worktree. The ledger has `schema_version`, `codex_task_id`, `slack_identity`,
`owner_identities`, and an `items` map keyed by
`<slack_channel_id>:<parent_ts>`. Each item has
`parent_ts`, `clarification_ts`, `last_recheck_at`, `next_recheck_at`,
`reporter_reply_ts` (or `null`), `aging_audit_at` (or `null`),
`aging_outcome` (`not-due`, `candidate-fixed`, `clarification-remains`,
`external`, or `ambiguous`), and `owner_identity`. Acquire the ledger lock,
read it before scanning, upsert by that key after every disposition, and write
it through a temporary file plus rename so a killed heartbeat cannot leave a
partial cursor. The scheduled heartbeat must use the same path and protocol on
the next run, then append the loaded and updated rows to its recap.

For a fresh manual run, verify and persist the invoking Slack profile as
`slack_identity`. A scheduled run must load that stable `{ team_id, user_id }`
identity from the ledger and require the current connected profile to match it
before reading or writing. If it is missing or mismatched, record Slack as
unavailable and do not claim scheduled coverage or initialize a new owner.
Initialize `owner_identities` from the persisted identity. During the required
full-thread read, inspect **Fixed** and **Clarification needed** replies from
every author. Scheduled discovery first queries all exact terminal replies,
joins them to eye-marked parents, and reads each candidate thread without an
author filter. If the full thread or assignment establishes a new investigator
or owner, add that identity and persist it before applying the owner filter on
later scans. A known-owner filter may optimize subsequent reads, but it must
never gate this bootstrap query. If no recurring automation is available, say
that the follow-up is manual and do not claim scheduled coverage exists.

If there is still no reporter answer after the aging threshold, make one bounded
source investigation before leaving the item pending. The threshold is exactly
24 weekday wall-clock hours in the task timezone - here, America/Los_Angeles -
counting elapsed hours on local Monday through Friday and pausing during local
Saturday and Sunday. For example, Wednesday at 10:00 reaches the threshold
Thursday at 10:00, while Friday at 10:00 reaches it Monday at 10:00. Record
`aging_audit_at` and the `aging_outcome` after that one audit. On later scheduled
rechecks, skip the aging path when that field is set unless a reporter reply or
new code, deployment, or runtime evidence changes the case; still re-read the
thread every time.

Inspect the parent evidence, linked artifacts, the likely owning code path,
existing regressions, recent fixes, and available runtime or deployment
evidence. An educated guess is useful only when the evidence points to a narrow
repo-owned culprit and the fix can be tested at the owning boundary. In that
case, fix it, add focused coverage, run verification, and use `/ship` when
publishing is authorized. Do not invent a global rule, patch every plausible
call site, or call **Fixed** from a hunch. If the audit cannot establish a
likely culprit, keep one precise **Clarification needed** question open, set
`aging_outcome` to `clarification-remains`, and record why the source evidence
was insufficient.

Weekend aging pauses the threshold, not the reply obligation: every scheduled
recheck still reads for a reporter response, and an answer at any time always
preempts the aging path and gets the full answered-clarification treatment.

Before choosing a new start cursor, re-read every thread that this workflow
left in **In progress**, oldest open ownership first. Verify the claimed fix or
continue the handoff; do not ask the reporter to repeat details. Keep doing
this until each open ownership item is **Fixed** or has a genuinely new,
specific missing reporter or product input.

## Resolution and ownership gate

Do not infer missing reporter evidence merely because a thread lacks a
terminal reply from the invoking identity. After reading the full thread,
treat a substantive reply from a legacy `@agent-native` message or any
participant that identifies the cause,
provides the repro, links a fix, or says the issue is fixed, landed, or being
fixed as resolution or ownership evidence. It suppresses a duplicate
clarification request. Verify a claimed fix before recording **Fixed**; if the
work is in progress, record it as already owned or in progress and continue the
handoff without asking the reporter to restate the issue. A resolution reply
from another author may still need an invoking-identity ledger reply, but it
is not missing evidence.

Only ask for clarification when the evidence ledger still contains one
specific reporter detail that blocks a safe fix to an otherwise clear bug and
no resolution or ownership signal answers it. Never ask a subjective product
question merely to choose among plausible UX options. Every clarification
reply starts with a brief thank-you, then asks that one question.
**Clarification needed** is an internal disposition, not reporter-facing prose.

## Required reading and tools

Before changing code, read `address-feedback`,
`address-feedback-with-replies`, `concurrent-agents`, and
`verifying-changes`. Read `ship` when a verified fix is ready to publish.

Use the Slack connector under the invoking-identity contract above. Use the configured
GitHub and Sentry connectors when available:

 - Slack: channel history, reactions, full thread replies, permalinks, and
   Slack message/user/file metadata. Fetch linked external evidence through
   its owning connector or public URL, not with the Slack bearer token.
 - GitHub: the newest relevant open issues in `BuilderIO/agent-native`, all
   comments and linked PRs, labels, current state, and duplicate searches.
 - Sentry: newest unresolved errors for the repository's projects, stack
   traces, route or component, frequency, affected release, and event links.

For every Slack read or write, follow the `## Slack identity` contract in
`address-feedback-with-replies`: verify the connected Slack profile matches the
invoking user, then use that same identity for history, reactions, replies, and
read-backs. Never switch identities during the sweep.

If a connector or permission is missing, continue with the other sources and
name the exact gap in the final recap. Treat that as unavailable evidence, not
as “nothing matched.” If the unavailable source is required to identify or
verify a safe fix, ask for access or a fresh/replacement artifact; do not ask
again for details that the inaccessible source was already known to contain.
Do not infer a Sentry “no results” state from an unavailable API.

## Triage and fix-altitude gate

Build one checklist per item with its source link, symptom, expected behavior,
evidence, likely owner, and disposition. Use this order:

1. **Classify before marking** - after the bounded newest-message search,
   filter for a clear, observable bug. Verify the invoking identity and
   reaction state only for that bug. If it has no own `👀`, add it as the first
   external write and read it back before the full thread, linked evidence,
   delegation, code, or clarification. Another identity's eye does not satisfy
   this run. If reaction state or the write is unavailable, record unavailable
   or unverified and stop that item. GitHub and Sentry items have no Slack
   parent, so use the same evidence-first triage without a reaction.
   - Design feedback is routed to Sid. Do not react, investigate, fix,
     clarify, or reply to Design feedback in this sweep; keep its source link
     in the internal recap only. If another agent or owner is already handling
     it, treat that ownership as final for this sweep too.
   - All Content app feedback is owned by Alice. Leave those items for Alice;
     do not automatically react, investigate, fix, clarify, reply, or dispatch
     them. Record the source and ownership in the disposition.
2. **Concrete repo-owned bug** - after the `👀` marker or existing-marker
   check, reproduce or establish it from source, tests, logs, a stack trace, or
   a linked run. Fix it and keep working until the smallest meaningful
   verification is green.
3. **Missing reporter evidence with no resolution signal** - after the `👀`
   marker and full-thread review, ask one specific question naming the exact
   reproduction, input, or surface needed to choose and verify a safe fix to an
   otherwise clear bug. If a
   participant or `@agent-native` already identified, fixed, or is fixing the
   issue, use that evidence and do not ask a duplicate question. If a needed
   linked artifact is inaccessible, ask for access or a fresh/replacement link
   instead of treating its contents as absent. If only internal test,
   deployment, or tooling verification is unavailable, keep that blocker
   internal and do not ask the reporter for it.
4. **Subjective UX or product suggestion** - do not turn a preference into a
   code or prompt rule. Act only when the report identifies a concrete broken
   behavior, an existing product invariant, or repeated independent evidence;
   otherwise record it as deferred or informational.
5. **Policy, bot-forward, status-only, duplicate, external, or non-repo-owned
   item** - do not react, reply, or edit code unless the user explicitly
   assigns a concrete repo action.

For a report that is actionable, choose the narrowest seam supported by the
evidence:

 - One isolated symptom -> fix the owning local seam and add a regression check.
 - Repeated or cross-surface symptoms -> inspect the shared primitive,
   contract, or boundary before touching a leaf.
 - Missing capability or wrong tool -> fix discovery, registry, or action
   contract wiring rather than adding a workaround in one chat.
 - Source-versus-live mismatch -> diagnose build, deployment, release, or
   environment state before changing source.

Never hard-code a rule for the wording or situation in one chat report. A
single data point can justify a local regression test or a contained product
fix, but it cannot by itself justify a global agent instruction, prompt rule,
or behavior exception. Broaden guidance only when repeated evidence names an
invariant and the shared owner is clear. For repeated feedback that is the same
underlying issue, handle it as one cluster with one Builder thread, not one
thread per report; use separate threads only when the evidence shows different
failure modes, surfaces, or owners.

## Investigation workflow

1. Record the start cursor with `git status --short`, the current branch, and
   worktrees. Read existing local changes before editing. Never reset, clean,
   stash, switch, rebase, or overwrite them without explicit authorization.
2. Read Slack threads, GitHub issues, and Sentry evidence in parallel when
   their write sets are independent. Search recent Slack, Git history, merged
   PRs, GitHub issues, and Sentry fingerprints for repeats or an existing fix
   before opening a new path.
3. For each concrete bug or similar-feedback cluster, establish the failing
   behavior first. Read every grouped Slack thread and linked evidence before
   dispatching. Prefer a focused regression test or a deterministic
   reproduction over a prose-only diagnosis. Keep source, test, built,
   deployed, and observed-live claims separate.
4. Fix the owning boundary at the altitude selected above. Do not add a
   feedback-specific branch when a shared contract, action, registry, or
   deployment boundary explains the reports.
5. Verify each fix with the narrowest relevant test, typecheck, guard,
   action read-back, browser path, or live check. For UI changes, exercise the
   running surface. For Sentry reports, confirm the affected release and
   distinguish a source fix from deployed and observed-live recovery.
6. For every clear-bug parent marked `👀`, post one concise in-thread update
   after the fix or clarification is ready. **Fixed** must say the verified
   change will be on beta later today. **In progress** requires concrete
   existing ownership, thanks the reporter, and asks no duplicate question.
   **Clarification needed** asks one specific missing reporter question only
   after the full-thread evidence and ownership gates. Keep internal blockers
   internal and omit implementation details from the reply.
   For any Slack write, verify the exact parent from a full-thread read, use its
   `thread_ts`, and re-read afterward. Never reply to a search-result or
   adjacent timestamp. If later classification finds an already-eyed item is
   out of scope or owned by another agent, remove the reaction when possible,
   delete a mistaken own reply when safe, and otherwise leave a concise
   **Skipped** edit. If reaction removal is unavailable, record the exact
   parent for manual cleanup and add no new Slack message or reaction.
   Answered clarifications re-enter only when the underlying item is a clear
   bug; use the new evidence and attempt the fix before asking anything else.
7. Do not close, label, assign, or comment on GitHub issues or Sentry unless
   the invocation explicitly authorizes those mutations. Link the issue or
   event in the recap instead.

## Worktrees and publishing

A worktree is a valid PR source. When this skill is run in an authorized
worktree, use that worktree's current branch and cwd for its tests, commit,
push, and PR creation or update. Do not copy changes into the shared checkout.
When publishing is authorized, use `corepack pnpm ship:push` for the complete
nonignored snapshot and update an existing PR rather than opening a second one.

## Completion and shipping

A verified repo-owned fix is not complete at the handoff. When the current
invocation has shipping authority - including an explicit user request to ship
or a caller that has already granted that authority - continue directly into
the `ship` workflow in the same worktree: publish the complete snapshot, open
or update the ready PR, babysit it, merge when its gates pass, verify the
affected production surface, and leave the worktree on the fresh post-merge
branch. Do not stop to ask for a second shipping confirmation once that
authority exists. Carry this skill's start cursor, grouped reports, evidence
links, owning seam, focused verification, and dispositions into the PR and
ship recap.

An ordinary or scheduled feedback sweep does not grant publish or merge
authority by itself. Without shipping authority, automatically prepare the
complete ready-to-ship handoff in the current worktree and state that shipping
is pending authorization; do not publish, merge, or imply that the fix shipped.

Only enter shipping when the fix is verified and in scope. If the sweep finds
no verified repo-owned fix, finish with the disposition recap and state why no
ship was started. Unavailable evidence, clarification-needed items, external
failures, and informational reports do not become code or shipping blockers.

## Ship handoff

When a verified fix is ready for `/ship`, make the handoff explicit instead of
leaving the shipping workflow to reconstruct the sweep. Include the exact
start cursor, grouped source reports, evidence links, owning seam, focused
verification, and one disposition for every item in the PR body or ship recap.
Keep source-tested, built, published or deployed, and observed-live claims
separate. If the branch changes or new Slack, GitHub, or Sentry evidence
arrives, tell `/ship` to refresh the sweep before merging. An unavailable
connector remains unavailable in that handoff and must never be summarized as
“nothing matched.”

## End-of-run recap

Every run ends with a compact recap for every item inspected, including items
skipped, duplicated, already owned, blocked by missing evidence, or blocked by
an unavailable connector. Include direct links to the Slack message or thread,
GitHub issue, Sentry event, PR, commit, and verification result when present.
For Slack, include the reply-ledger result for every parent this run marked
`👀`: invoking-user reply timestamp and disposition, or the exact reason the
item was not marked. Never call a sweep complete while an actionable Slack
parent in the ledger has no reply from the invoking identity.

Use this shape:

```md
## Feedback sweep
Start cursor: [Slack message](...)

| Source / item | Disposition | Action | Why and evidence |
| --- | --- | --- | --- |
| [Slack thread](...) | Fixed / Awaiting reply / Clarification needed / Skipped / In progress | ... | ... |
| [GitHub issue](...) | ... | ... | ... |
| [Sentry event](...) | ... | ... | ... |

Awaiting reply: [thread](...) - asked YYYY-MM-DD, still unanswered
Unavailable or unverified: ...
```

Keep each row succinct, but do not omit an item merely because no code
changed. “Nothing matched” is valid only after each source was successfully
queried and the cursor and filters are stated.

When multiple source items were grouped into one similar-feedback cluster, name
the representative item and list the grouped source links in that row. Record
one Builder dispatch for the cluster, while preserving the disposition of every
individual report.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `concurrent-agents`,
`verifying-changes`, `ship`
