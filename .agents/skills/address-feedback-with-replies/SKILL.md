---
name: address-feedback-with-replies
description: >-
  Address repo-owned feedback in Slack: inspect evidence, fix and verify
  accepted issues, and send concise in-thread status through the invoking
  user's connected Slack identity. Use when the user asks to address feedback.
scope: dev
metadata:
  internal: true
---

# Address Feedback With Replies

Use this workflow when the user wants feedback triaged, fixed, and answered in
Slack in one pass. Reply only in the requested scope and keep replies as
evidence-based as the code. Cluster identical symptoms under one Builder
thread and follow `review-latest-feedback`'s single-owner reply rule.

This workflow handles clear bugs and concrete design/UX feedback about existing
repo-owned surfaces. In Slack sweeps, follow `review-latest-feedback` for
eligibility: do not exclude Design feedback because it is visual or subjective;
new capability requests still require the invoking identity's `:upvote:`. For
every report root this actor owns with `👀`, `✅`, or `🎫`, keep one concise,
current same-actor status reply after the latest human message. Reconcile root
marks with every directly verified scope (`✅`) and every distinct unfinished
human/team action (`🎫`), including actions that are unassigned or unaccepted.
Record `owner: unassigned` and `status: unassigned` until a named person
explicitly accepts the action; record the exact acceptance only after their
reply. A Slack `🎫` is a workflow reaction, not proof that an external tracker
ticket exists. Read back the reply and reactions. Reuse the status while
evidence, disposition, and next action remain current; update it when one
changes. The linked `review-latest-feedback` reaction reference owns the exact
proof, acceptance, and inventory rules.
Praise, status updates, merge or review requests, bot forwards, duplicates, and
other unrelated messages stay out of scope. Content remains with Alice unless
the user explicitly assigns it.

An `:upvote:` from the invoking identity promotes a new-capability request into
scope - that reaction is the product decision, so build the smallest version
rather than asking which variant is wanted. The upvote is the authorization —
do not wait for a second sign-off.
It does not transfer ownership: an upvoted Design or Content item still gets
built, with Sid or Alice named in the recap row so the mapped owner is not
surprised by a change in their area. Naming them is a courtesy, not a gate.
Either workflow may complete an upvoted improvement and record the terminal
**Shipped** disposition. Everything in this file about voice, evidence, and
verification applies to an upvoted item unchanged.
For each distinct defect, ask one direct question when reporter input changes
reproduction or unblocks a safe fix. There is no per-run question cap; keep one
pending question per thread.

If this workflow eyed an out-of-scope item, keep the eye and post one concise
**Skipped** reply if needed. Apply `review-latest-feedback`'s Reaction gate
before `🎫`. Correct any mistaken reply to **Skipped**.
New messages must pass the clear-bug gate before any external write.

Follow `review-latest-feedback` for status reactions; never remove reactions.

Follow `review-latest-feedback` for ownership and cluster status; a claimed
report keeps its `👀`, and an unresolved eye cannot be taken over.

## Prerequisites

- Read `address-feedback`, `concurrent-agents`, and `verifying-changes` first.
- Read the linked Slack parent and every reply. If a message points to a Clips
  link, transcript, video, screenshot, file, or newer follow-up, inspect it too.
- Inspect every linked artifact that is accessible, but track an artifact that
  is permission-gated, expired, or otherwise unreadable separately from
  evidence that is absent. Do not treat an inaccessible artifact as proof that
  its contents are missing. If that artifact is actually needed to identify or
  verify the fix, ask for access or a fresh/replacement link; if it is not
  needed, continue with the available evidence and record the limitation.
- Before asking, build a known/missing-evidence ledger from the complete thread
  and linked artifacts: surface, repro, exact error, files, run IDs, and answers.
  Never request evidence already present or accessible. If a needed artifact is
  inaccessible, request access or a replacement link, not its contents again.
- Scan for a substantive cause, repro, fix, or ownership signal first. Verify it
  or continue the handoff; never ask the reporter to repeat it.
- If the report includes a run ID, use that ID first to inspect the persisted
  run, events, tool cards, and linked app state. Do not ask for the prompt or
  last tool card until the run ID and available observability paths have been
  exhausted; do not ask for evidence already present in Slack or the app.
- Search recent Slack history, local Git history, and merged PRs for repeat
  reports and existing fixes before editing.
- Re-read dirty files. In task worktrees, make needed branch changes without
  asking; preserve peer work and branches. Keep shared checkouts on their
  current branch. Explicit ship/PR requests authorize a managed task worktree
  from the base selected by `new-branch` when needed; carry only this task's
  changes there.
  Never reset, stash, or overwrite peer work.

## Slack identity

Use the connected Slack integration for every Slack read and write. Never
operate Slack through computer use, a browser, screenshots, or UI automation.
Every Slack interaction in this workflow - channel history, reactions, thread
replies and read-backs, permalinks, and Slack message/user/file metadata - uses
the connected Slack identity of the user who invoked the workflow. Verify that
identity before the first write and keep its stable `{ team_id, user_id }`
tuple for all read-backs. Do not silently switch to a bot, another user's
connector, or a different workspace. Do not load or use `SLACK_BOT_TOKEN`.

Linked external artifacts are not Slack interactions. After extracting their
reference from Slack, fetch them through the artifact's owning connector or
public URL.

- Read the current Slack profile and confirm its user ID and display name
  match the invoking user. If identity or workspace verification fails, record
  Slack as unavailable and do not write.
- Use that same connected identity for channel history, thread replies,
  reactions, and Slack metadata. Use cursors until the requested history or
  thread is complete. A reply read-back must include author metadata matching
  the invoking `user_id`; missing author data is unverified and cannot satisfy
  the reply ledger. It must also match the target channel, timestamp, thread
  parent, and workspace. A reaction read-back must include the invoking user
  in the reaction's user list.
- After every reaction or reply, re-read through the same connected identity
  and verify the reaction or reply exists before continuing.
- Never remove or clean up reactions on a feedback item, including `👀`,
  `✅`, `🎫`, or another person's reaction.

## Decision Gate

Apply the shared `address-feedback` **Choose the fix altitude** gate before
reacting, editing code, or replying. It selects the smallest owning seam and
prevents one subjective report from becoming a global instruction.

For Slack sweeps, `review-latest-feedback` owns scope and reaction eligibility.
Honor its inclusion of concrete Design/UX feedback about existing surfaces and
the invoking user's assignment; do not override it with a generic UX exclusion.
New-capability requests still need the invoking identity's `:upvote:`. Once an
item is in scope, add `👀` before investigation or delegation.

During triage and replies, follow `review-latest-feedback`'s single-owner
rule: use one owner-thread reply for a cluster and list duplicate source
permalinks there unless a distinct question or update needs a separate reply.
For a linked beta app PR, follow `review-latest-feedback`'s post-merge beta
rule. Send the PR link and 24-hour expectation after the matching run selects
the site; correct the same thread if publishing fails or misses it.

A tracked clear bug or authorized upvoted improvement receives at most one
disposition per run. **Verified locally**, **Built - live unverified**,
**Deployed - live unverified**, **Not reproducible - attempted**, and **In
progress** retain `👀` after the report has been claimed.
**Asked**, **Clarification needed**, and **Blocked on reporter** retain `👀`
after the report has been claimed.
Terminal dispositions: **Fixed**, **Shipped**, **Live verified**,
**Open - no question**, **Resolved elsewhere**, **Skipped**, **Clustered**, and
**Abandoned - no answer in 4 days**, each with required evidence and `👀`. Follow
`review-latest-feedback` for `✅`/`🎫`. An already-eyed skipped item gets one
concise **Skipped** reply if absent.
**Fixed** closes the issue after a verified source fix merges; publication,
beta, and live verification follow separately. Use **In progress** while the
source PR is open. Link the PR and say merge is pending. Give beta timing only
after the merge reaches `origin/main` and the matching run selects the affected
site. Follow `review-latest-feedback`'s reply reference for the short
post-merge update and any correction.
**In progress** is an open ownership state. Do not send an interim progress
reply for work fixed in the same run. If work continues beyond this run, follow
`review-latest-feedback` and post one brief update only when the next step
changes.
Continue or coordinate existing work instead of starting a duplicate. Never
use a vague update or replace verification. The next run must revisit this
state and resolve it to **Fixed**, **Clarification needed**, or evidence-backed
**Open - no question** when no safe fix or reproduction remains. `Blocked`,
`not fixed yet`, `still needs a fix`, and similar phrases are internal notes,
never a complete Slack reply. **Open - no question** is terminal with our eye
retained and no checkmark. Keep each Slack reply to one short, plain-language
paragraph: say what changed or what is still needed, without repeating proof,
scope lists, or absent reactions. These are ledger states, not mandatory
headings: keep the reporter-facing wording natural instead of opening with the
robotic phrase “Clarification needed”. A substantive diagnosis, fix, or
in-progress ownership statement from someone in the thread is not a reason to
ask for clarification; verify it or continue the existing handoff first.

**Clarification needed** is an open state, not a completed product fix. Asking
the question creates a standing obligation to come back for the answer. It is
the invoking identity's open disposition for the current cursor, not a terminal
closure; keep the eye while waiting. The next
`review-latest-feedback` run must re-read every thread it previously asked in
before scanning newer messages; when this workflow runs on its own, do the same
and act on the replies first.

After four days, keep `👀` and post **Abandoned - no answer in 4 days** once.
Apply `review-latest-feedback`'s Reaction gate; carry active bugs forward.

**In progress** is also an open state. It records that the thread already has
real ownership or an active fix, so the invoking identity must not ask the
reporter to repeat the issue. Re-read it on the next run, verify the work, and replace the open
state with **Fixed** when complete or **Clarification needed** only if a
specific reporter or product input is still missing.

Treat a clarification reply as new evidence, not a new report. Re-read the
thread and try the fix before asking anything else. An answer or explicit
resolution from any participant is sufficient when it supplies the requested
detail. A partial reply leaves the one existing request pending. Ask again only
for one specific, non-repeating detail that still blocks a clear-bug fix; never
ask for a subjective product choice or evidence already present. For an
inaccessible artifact, request access or a replacement link.

### One pending question per thread

There is no per-run question cap. After inspecting supplied evidence and
attempting reproduction, ask for each specific reporter detail or action that
would change the next step. Do not leave a useful question unasked because
other threads also need questions.

There may be only one unanswered clarification request per thread. Before
posting, re-read the complete thread for an earlier question from this
workflow, the companion `review-latest-feedback` workflow, or `@agent-native`,
and check whether its exact requested detail has been semantically answered or
explicitly resolved anywhere in the thread. If it is still unresolved,
including after a partial or unrelated reply, keep that request as the sole
pending handoff and do not post another question. Once it is answered or
resolved, attempt the fix from the new evidence first; ask at most one new,
non-repeating question only if one specific required detail still blocks it.

## Workflow

1. Build a per-thread checklist with the symptom, expected behavior, evidence,
   owner, and disposition: bug, UX suggestion, unclear, policy, or out of
   scope. Use the shared `address-feedback` categorization and Fix-altitude
   gate when choosing the disposition and owning seam. When the same underlying
   issue appears in multiple threads, build one cluster checklist and drive one
   Builder thread for that cluster; do not create separate Builder threads
   unless the reports diverge in symptom, surface, or owner.
2. The reaction is the first external action after classification. Add `👀` to
   each clear bug and every actionable Design/UX item already classified in
   scope, one thread at a time as it enters scope. Do not
   batch reactions until after investigation, implementation, testing, or the
   final Slack pass. If the reaction fails, stop and retry or report the
   concrete Slack permission/API blocker before continuing the investigation.
   Do not react to out-of-scope product requests, policy or informational
   messages, bot forwards, status-only items, or non-repo-owned reports.
   For an authorized upvoted improvement, perform and read back that same eye
   reaction before investigation or delegation, then include it in the ledger.
3. Parallelize independent investigations and narrow fixes with disjoint write
   sets. For every actionable repo-owned bug, keep working toward a verified
   fix. If reporter or product input is missing, ask one concrete question for
   it; do not settle for a vague unresolved status. If only internal test,
   deployment, or tooling verification is unavailable, keep that blocker
   internal and do not turn it into a reporter question.
4. Verify each fix with the smallest relevant test, typecheck, action read-back,
   or browser path. Keep source-tested, built, installed, deployed, and live
   observations separate.
5. Prepare or reuse one short current status for each report root this actor
   owns with `👀`, `✅`, or `🎫`. Record clustered source links and disposition
   in the owner thread or linked work; do not send duplicate replies:
   - **Fixed** - name the fix in plain language and link the PR. For an open
     beta app PR, say merge is pending. After merge, wait for the matching run
     to select the site, then share the PR link. If the site is current, verify
     it and say it is on beta. Otherwise, give the 24-hour expectation and
     correct the same thread if the publisher fails or misses it.
   - **Shipped** - use for an authorized upvoted improvement after its requested
     behavior and verification check are complete.
   - **In progress** - only when work continues beyond this run; thank the
     reporter and name the active work. A same-run fix needs only its final
     verified status. This is an open handoff, not a fix.
   - **Clustered** - list source permalinks and state in owner-thread status or
     linked work. Reply once; answer a distinct question in its own thread.
   - **Clarification needed** - ask one concrete plain-language question only
     when missing reporter input or an inaccessible needed artifact blocks a
     safe clear-bug fix. Re-read immediately before posting and confirm the
     detail is absent and no one already owns or resolved the issue. Never post
     a vague or bare unresolved status, repeat a question, or expose internal
     test/deployment gaps. Keep replies shorter than the investigation and omit
     implementation details, IDs, tools, and internal ownership.
   6. When the user explicitly asks to reply, post directly in each requested
   thread with `thread_ts` through the same connected Slack identity. Do not
   silently turn an authorized write into a draft. Re-read each thread
   afterward to confirm the reply landed under the intended parent. Use the
   exact parent timestamp as `thread_ts`; never reply to a search-result
   timestamp or an adjacent thread. Before ending the run, mechanically
   audit the reply ledger: for every owned report root, record its current
   same-actor reply timestamp or owner-thread link, disposition, and root marks. A terminal state in the
   thread or linked work needs no duplicate reply. Record **Owned elsewhere**
   only when the latest update confirms another active owner; preserve foreign
   eyes. Record non-owning **Clustered** rows in the owner thread or linked
   work, and send no duplicate reply unless a distinct question or update needs
   an answer. Record out-of-scope items with one **Skipped** status if missing.
   If any participant replies after the post, re-read the entire thread again
   before deciding whether to fix, close, or ask anything else.
7. If any participant supplies the requested detail or an explicit resolution,
   re-read the full thread and use that new evidence in the same follow-up pass.
   Attempt the fix now; do not repeat the question. If the reply is partial or
   unrelated, keep the existing clarification pending instead of asking a
   second question. Replace an open clarification with a **Fixed** reply once
   the fix is verified.
8. If the user says earlier replies were too technical, harsh, or incomplete,
   search for every reply authored in this sweep and edit the bad replies in
   place. Do not fix only the newest example or leave the other addressed
   threads with the old wording.

## Slack reply voice

Write as the invoking user from the same connected Slack identity. Keep each
reporter reply to one short, plain-language paragraph. Start with
`ty for the feedback -` or `thanks for the feedback -`; end with
`this was sent from a bot.`.

Say what changed in plain language. Do not explain why `👀` or `✅` is absent.
If `🎫` is used, briefly name what still needs checking and who should handle
it, when known. The Slack `🎫` reaction does not mean an external tracker ticket
was created or assigned. For a beta app fix in an open PR, link it and say
merge is pending. Give beta timing only after the matching run selects the site.
If work continues beyond this run, name the next
action only when a reporter needs to know it.
For a clarification, ask one direct question only when reporter input changes
the next step. Never ask for supplied evidence or internal access gaps.

Keep implementation details, IDs, tools, CI, publisher state, and run details
out of reporter replies. Use plain language; do not send a bare `Open`,
`pending`, or symptom recap. Follow `review-latest-feedback` for ownership,
dispositions, and reaction use. A generic earlier “looking into this” does not
count as the status reply.

## Beta availability

Keep merge, publisher, and live verification details in the recap. After a
linked beta-eligible app PR merges and is confirmed in `origin/main`, wait for
the matching run to select the affected site. Reply once in its owned thread
with the PR link and say it is expected on beta within 24 hours. This is an
expectation, not a guarantee. If the site is current, verify it and say it is
on beta. If publishing fails, is blocked, or misses that timing, correct the
update in the same thread. Use `🎫` only when another person or team must act.
Do not say it is live until checked. Answer direct
reporter follow-ups.

## Verification

- Run focused checks for every changed surface and `git diff --check`.
- Re-read the Slack threads after posting and confirm each requested reply is
  present under the intended parent.
- Include the eye-to-reply ledger in the recap so no marked thread silently
  disappears from the handoff.
- Report repeat reports and any similar-feedback cluster handled as one Builder
  thread, along with the fixed items, flagged items, clarification questions,
  verification gaps, and the exact release state.

## Related Skills

- `address-feedback` - classification and fix boundaries.
- `concurrent-agents` - shared-checkout coordination.
- `verifying-changes` - proof before claiming done.
- `writing-agent-instructions` - guidance quality and scope.
