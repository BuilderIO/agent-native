---
name: address-feedback-with-replies
description: >-
  Triage and fix repo-owned feedback in Slack. Reply only when adding a root
  reaction, using the invoking user's connected Slack identity. Use when the
  user asks to address feedback.
scope: dev
metadata:
  internal: true
---

# Address Feedback With Replies

Use this workflow when the user wants feedback triaged or fixed in Slack. Reply
only when this run adds a root reaction, and explain only that reaction in one
plain-language sentence. Cluster identical symptoms under one Builder thread
and follow `review-latest-feedback`'s single-owner reply rule.

This workflow handles clear bugs and concrete design/UX feedback about existing
repo-owned surfaces. In Slack sweeps, follow `review-latest-feedback` for
eligibility: do not exclude Design feedback because it is visual or subjective;
new capability requests still require the invoking identity's `:upvote:`. Do
not send progress updates or status replies just because a root already has a
reaction. When this run adds a root reaction, send one short, plain-language
sentence explaining only the reaction(s) added. Never explain absent or
unchanged reactions or mention a missing tracker ticket. Keep evidence,
disposition, and reaction inventory in the internal ledger; follow
`review-latest-feedback` for reaction rules.
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

If this workflow eyed an out-of-scope item, keep the eye and record **Skipped**
internally. Do not send a reporter reply unless this run adds a root reaction.
Apply `review-latest-feedback`'s reaction rules before adding `🎫`.
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
rule. Keep duplicate source permalinks in the internal ledger. Do not send a
reply for a cluster or a merge/deployment update unless this run adds a root
reaction.

A tracked clear bug or authorized upvoted improvement receives at most one
disposition per run. **Verified locally**, **Built - live unverified**,
**Deployed - live unverified**, **Not reproducible - attempted**, and **In
progress** retain `👀` after the report has been claimed.
**Asked**, **Clarification needed**, and **Blocked on reporter** retain `👀`
after the report has been claimed.
Terminal dispositions: **Fixed**, **Shipped**, **Live verified**,
**Open - no question**, **Resolved elsewhere**, **Skipped**, **Clustered**, and
**Abandoned - no answer in 4 days**, each with required evidence and `👀`. Follow
`review-latest-feedback` for reaction use. Do not send a reply for an existing
mark or disposition unless this run adds a reaction.
**Fixed** closes the issue after a verified source fix merges; publication,
beta, and live verification follow separately. **In progress** is an internal
ownership state. Do not send an interim progress reply; keep working and post
only when this run adds a reaction with a meaningful update.
Continue or coordinate existing work instead of starting a duplicate. Never
use a vague update or replace verification. The next run must revisit this
state and resolve it to **Fixed**, **Clarification needed**, or evidence-backed
**Open - no question** when no safe fix or reproduction remains. `Blocked`,
`not fixed yet`, `still needs a fix`, and similar phrases are internal notes,
never a complete Slack reply. **Open - no question** is terminal with our eye
retained and no checkmark. A reporter-facing reply is only for a reaction added
this run; explain that reaction briefly, or ask the direct question paired with
a new `🎫`. Never narrate active work or explain reactions that were not added.
These are ledger states, not mandatory
headings: keep the reporter-facing wording natural instead of opening with the
robotic phrase “Clarification needed”. A
substantive diagnosis, fix, or in-progress ownership statement from someone in
the thread is not a reason to ask for clarification; verify it or continue the
existing handoff first.

**Clarification needed** is an open state, not a completed product fix. Asking
the question creates a standing obligation to come back for the answer. It is
the invoking identity's open disposition for the current cursor, not a terminal
closure; keep the eye while waiting. The next
`review-latest-feedback` run must re-read every thread it previously asked in
before scanning newer messages; when this workflow runs on its own, do the same
and act on the replies first.

After four days, keep `👀` and record **Abandoned - no answer in 4 days** in
the internal ledger. Send no status reply unless this run adds a root reaction;
carry active bugs forward.

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
attempting reproduction, ask a reporter question only when this run adds a
root `🎫`. Keep it to one specific detail that changes the next step. Do not
leave a useful question unasked because other threads also need questions.

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
   fix. If reporter input is missing, add `🎫` and ask one direct question.
   Keep internal test, deployment, and tooling gaps in the ledger.
4. Verify each fix with the smallest relevant test, typecheck, action read-back,
   or browser path. Keep source-tested, built, installed, deployed, and live
   observations separate.
5. Keep the full status and evidence in the internal ledger. Do not send a
   reporter message for existing reactions, active work, or routine merge and
   deployment updates. If this run adds a root reaction, send one short,
   plain-language sentence explaining only the reaction(s) added. Record
   clustered source links and disposition in the internal ledger; do not send
   duplicate replies:
   - **Fixed** - give the brief verified outcome and explain the `✅` added.
     Keep PR, merge, and deployment details in the internal recap.
   - **Shipped** - use for an authorized upvoted improvement after its requested
     behavior and verification check are complete.
   - **In progress** - keep this as an internal disposition; do not send a
     reporter-facing progress message.
   - **Clustered** - record source permalinks in the internal ledger. Reply only
     when this run adds a root reaction.
   - **Clarification needed** - when this run adds `🎫`, ask one concrete,
     plain-language question only if missing reporter input blocks a safe fix.
     Re-read immediately before posting. Do not expose internal test or
     deployment gaps.
   6. When the user explicitly authorizes a Slack reply, post it in the requested
   thread through the same connected identity, but only if this run also adds a
   root reaction. Keep it to the sentence above, then read it back. Record
   ownership, disposition, and marks in the internal ledger; do not send a
   duplicate or status-only reply.
7. If any participant supplies the requested detail or an explicit resolution,
   re-read the full thread and use that new evidence in the same follow-up pass.
   Attempt the fix now; do not repeat the question. If the reply is partial or
   unrelated, keep the existing clarification pending instead of asking a
   second question. Record a verified fix internally; reply only if this run
   adds a root reaction.
8. When the user explicitly asks to revise posted replies, review every reply
   authored in this sweep and edit each one that misses the requested voice.
   Do not edit Slack messages merely because this skill is being updated.

## Slack reply voice

Write as the invoking user from the same connected Slack identity. Reply only
when this run adds a root reaction. Use one short, plain-language sentence to
explain only the reaction(s) added; if the new `🎫` asks the reporter for
input, include one direct question. End with `this was sent from a bot.`.

Do not report progress, repeat known evidence, explain absent or unchanged
reactions, or discuss whether a tracker ticket exists.

Keep implementation details, IDs, tools, CI, publisher state, and run details
out of reporter replies. Use plain language; do not send a bare `Open`,
`pending`, or symptom recap. Follow `review-latest-feedback` for ownership,
dispositions, and reaction use.

## Beta availability

Keep merge, publisher, and live verification details in the internal recap. Do
not send progress or routine follow-up replies when no reaction is added.
Correct the stated availability in the internal ledger if a material publisher
issue changes it.

## Verification

- Run focused checks for every changed surface and `git diff --check`.
- Re-read the Slack threads after posting and confirm each requested reply is
  present under the intended parent.
- Keep the full eye-to-reply ledger in the internal handoff or PR so no marked
  thread disappears. Do not paste it into the final chat answer.
- Keep repeat reports, clusters, dispositions, open questions, verification
  gaps, and release state in the internal ledger. When the task is done, give
  the user one short, non-technical sentence about completed work.

## Related Skills

- `address-feedback` - classification and fix boundaries.
- `concurrent-agents` - shared-checkout coordination.
- `verifying-changes` - proof before claiming done.
- `writing-agent-instructions` - guidance quality and scope.
