---
name: address-feedback-with-replies
description: >-
  Complete the Slack feedback cycle: read every thread and linked evidence,
  fix verified repo-owned issues, and reply in-thread with honest status,
  clarification questions, and release follow-up. Use when the user asks to
  address feedback and respond in the requested voice through the invoking
  user's connected Slack identity.
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
new capability requests still require the invoking identity's `:upvote:`.
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
Even when invoked alone, this workflow asks at most three new clarification
questions per run across all threads, ranked by which answer would unblock a
safe fix.

If this workflow earlier added `👀` before recognizing an item was out of
scope, keep our eye and add no other reaction. Record **Skipped** with one
brief status reply if the thread lacks it, not a question. If this workflow
already posted a mistaken reply, edit it to that disposition.
New messages must pass the clear-bug gate before any external write.

Use the disposition-specific reaction contract from `review-latest-feedback`:
add `👀` when claiming and `✅` only after a verified fix. Reactions are never
removed; newer thread evidence determines the current disposition.

Every claimed report keeps its `👀`. Follow `review-latest-feedback` for
ownership and cluster status; add `✅` to each report a verified fix resolves.
Never remove reactions. An eye without a terminal status is unresolved, not
available to another workflow; check its thread and linked work before taking
it over.

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
- Re-read dirty files before edits. In task-owned worktrees, make safe task
  branch changes without asking; preserve peer changes and never move peer
  branches. Do not reset, stash, or overwrite peer work. Ask before branch
  changes in shared checkouts.

## Slack identity

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

## Decision Gate

Apply the shared `address-feedback` **Choose the fix altitude** gate before
reacting, editing code, or replying. It selects the smallest owning seam and
prevents one subjective report from becoming a global instruction.

For Slack sweeps, `review-latest-feedback` owns scope and reaction eligibility.
Honor its inclusion of concrete Design/UX feedback about existing surfaces and
the invoking user's assignment; do not override it with a generic UX exclusion.
New-capability requests still need the invoking identity's `:upvote:`. Once an
item is in scope, add `👀` before investigation or delegation.

Never post the same sentence into several threads. For shared causes, follow
the single-owner reply rule in `review-latest-feedback`; answer non-owning
reports only for a distinct question or update.

A tracked clear bug or authorized upvoted improvement receives at most one
disposition per run. **Verified locally**, **Built - live unverified**,
**Deployed - live unverified**, **Not reproducible - attempted**, and **In
progress** retain `👀` after the report has been claimed.
**Asked**, **Clarification needed**, and **Blocked on reporter** retain `👀`
after the report has been claimed.
Terminal dispositions: **Fixed**, **Shipped**,
**Live verified**, **Open - no question**, **Resolved elsewhere**, **Skipped**,
**Clustered**, and **Abandoned - no answer in 4 days**, each with required
evidence and `👀`; add `✅` only for verified fixes. An already-eyed
out-of-scope item keeps its eye and gets one concise **Skipped** reply if the
thread lacks that status.
**Fixed** closes the issue after a verified
source fix merges; publication, beta, and live verification follow separately.
**In progress** is an open ownership state. Do not send an interim progress
reply for work fixed in the same run. If work continues beyond this run, follow
`review-latest-feedback` and post one concrete status before the next sweep.
Continue or coordinate existing work instead of starting a duplicate. Never
use a vague update or replace verification. The next run must revisit this
state and resolve it to **Fixed**, **Clarification needed**, or evidence-backed
**Open - no question** when no safe fix or reproduction remains. `Blocked`,
`not fixed yet`, `still needs a fix`, and similar phrases are internal notes,
never a complete Slack reply. **Open - no question** is terminal with our eye
retained and no checkmark. A reply must state a verified resolution, concrete
active work, a needed question, or one terminal disposition with its reason;
never send a vague status alone. These are ledger states, not mandatory
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

That obligation expires after four days, standalone runs included: keep our
`👀`, add no reaction, and post **Abandoned - no answer in 4 days** once if the
thread lacks that status. Ask nothing further; carry any active bug forward.

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

### The standalone question budget

This workflow inherits the hard cap from `review-latest-feedback`: at most
three new clarification questions per invocation across all threads. When run
alone, rank candidates by whether the answer would unblock a safe fix, handle
existing clarification requests first, and leave candidates below the cut
open without asking. Never turn the per-item question rule into an unbounded
batch.

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
5. Prepare one short status for each unclustered clear bug and owning parent
   marked `👀`. Record clustered source links and disposition in the owner
   thread or linked work; do not send duplicate replies:
   - **Fixed** - say that the verified code change is complete and when it
     should be live. For today's beta-bound fixes, say explicitly that it will
     be on beta later today; never send a bare “Fixed”.
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
   audit the reply ledger: for each claimed parent, record its reply timestamp
   or owner-thread link, disposition, and eye state. A terminal state in the
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

Write in the invoking user's voice and send from that same connected Slack
identity:

- Use lowercase, short conversational paragraphs, and clear, conversational
  wording. Keep the tone casual and collaborative - warm without being corny,
  and specific without sounding terse or demanding.
- Every feedback reply starts by thanking the reporter. Use the natural short
  form `ty for the feedback -` (or `thanks for the feedback -`) before the
  status. Do not open with `agreed`, `valid request`, `ah`, or a diagnosis.
- Every reply from this workflow also ends with `this was sent from a bot.` so
  future sweeps can rediscover it; historical replies may not contain the
  marker and must still be found by the companion clarification search.
- An **In progress** reply starts with that thank-you and names the active
  work. Do not use it to ask for clarification the thread already answered.
- Use lowercase and a short conversational paragraph. Natural phrases such as
  `ah`, `yeah`, and `good find` can follow the thank-you when they fit; do not
  force them into every reply. Prefer ` - ` over em dashes.
- Thank the reporter by name when it is available, for example, “thanks
  Alexander -”. Ask for help rather than issuing a demand: prefer “if you can
  share ...” or “a deck URL or request ID would help us dig into this” over
  “send ...” or “provide ...”. Avoid canned enthusiasm, scolding, and robotic
  labels such as “Clarification needed” in the reporter-facing prose.
- For a clarification reply, the order is mandatory: thank the reporter first,
  then ask the one essential question. A resolution or ownership statement
  already present in the thread is not a reason to ask that question.
- The audience is product/design/feedback reporters, not developers. Never
  post technical explanations such as shared paths, transports, sessions,
  repro levels, payloads, schemas, CORS, auth domains, action names, or
  implementation details. Translate the result to: fixed, or one essential
  missing detail that is required to fix and verify it.
- A clear, valid, repo-owned request is an instruction to fix it. Do not reply
  `valid request` and stop, and do not say `no ship timing yet` as a dead end.
  Implement the fix first; when code is complete, say it is fixed and should be
  live after the final ship later today (roughly end of day) only when it is
  confirmed to be included in that ship.
- Never claim a fix, live behavior, deployment, or ownership that was not
  verified. Say “this should be live after the final ship later today” only
  when the code is complete, included in that ship, and the expected ship
  window is actually known.
- If it is not fixed, continue the work or post a concrete **In progress**
  status when it continues beyond this run. Ask one concrete question only when
  reporter or product information is
  genuinely missing, or a needed linked artifact is inaccessible, after
  exhausting the Slack thread, linked files/transcript/video, app state, run
  ID, sessions, and history. Internal
  verification blockers do not justify a reporter question. When an artifact
  is linked but inaccessible, ask for access or a fresh/replacement artifact,
  not for its contents as though the evidence were absent. Never ask for a
  prompt, run ID, session, or file already present or available through an
  accessible source, and never write “not fixed yet” without a real question
  that unblocks the fix. If a linked source is inaccessible, ask for access or
  a fresh/replacement link instead of requesting its contents again. If no
  reporter detail would unblock the work, keep our `👀`, add no reaction,
  record **Open - no question**, and post that status once if the thread lacks
  it.
- When a request ID would help, make the path easy and optional: “at the end of
  the chat, hit the three dots and share the request ID if that option is
  available.” Pair it with the useful surface link when one exists, such as a
  deck URL; do not ask for a prompt or run ID when the source fix is already
  established.
- Before finishing the sweep, search every reply authored in that sweep for
  vague unresolved wording and edit or remove it. Re-read the affected threads
  after each edit. Unclaimed subjective/product/policy items get no reply. If
  an item was claimed before being skipped, preserve its eye and ensure one
  concise **Skipped** status reply. Add `✅` only for a verified fix.

A useful reply shape is:

```text
ty for the feedback - [short plain-language status].

  [if fixed: this should be live after the final ship later today.]
  [if in progress: we're already looking into this and will follow up once the
  fix is verified.]
  [if clarification is needed: if you can share the one missing detail, that
  would help us investigate, such as a deck URL and/or request ID.]
```

Keep it to one short paragraph whenever possible. Omit the release sentence
only when the change is not complete; do not invent a ship date for an open
item. For an unclear runtime report, inspect its run ID and linked app evidence
first; ask for one missing detail only when those sources cannot adequately
identify the failure.

## Release follow-up

After the final ship, return to the same threads and post a brief follow-up
saying the fix is live only after verifying the live path internally. If the
ship has not happened yet or live verification is unavailable, do not imply
that the fix is already live. Omit commit, release, and live-path details from
the posted follow-up unless the reporter asks for them.

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
