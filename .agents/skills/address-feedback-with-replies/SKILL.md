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
thread while replying in each in-scope report that needs a status.

This workflow is for clear bugs, not a general UX review. A clear bug has
observable broken behavior such as a click or submit doing nothing, an action
error, data loss or reversion, a wrong result, or a regression. Do not react,
ask questions, reply, or change code for preferences, product ideas, copy or
layout suggestions, praise, status updates, merge or review requests, bot
forwards, duplicates, or other random messages. Design feedback, including
Design clips and imported-design usability, routes to Sid and is not handled
here. Content remains with Alice.

One exception: an `:upvote:` from the invoking identity promotes an otherwise
out-of-scope UX or feature request into scope - that reaction is the product
decision, so build the smallest version rather than asking which variant is
wanted. The upvote is the authorization — do not wait for a second sign-off.
It does not transfer ownership: an upvoted Design or Content item still gets
built, with Sid or Alice named in the recap row so the mapped owner is not
surprised by a change in their area. Naming them is a courtesy, not a gate.
Either workflow may complete an upvoted improvement and record the terminal
**Shipped** disposition. Everything in this file about voice, evidence, and
verification applies to an upvoted item unchanged.
Even when invoked alone, this workflow asks at most three new clarification
questions per run across all threads, ranked by which answer would unblock a
safe fix.

If an earlier run already added `👀` to an out-of-scope item, remove that
reaction with the connected Slack removal action when available. Do not add
another reaction, investigate it as a bug, ask a compensating question, or post
a new reply. If this workflow already posted a mistaken reply, delete that
reply when safe; otherwise edit it to one brief `Skipped` disposition. If the
connector cannot remove reactions, record the exact parent for manual cleanup
and leave the thread otherwise untouched. New messages must pass the clear-bug
gate before any external write.

Every clear-bug parent or upvoted improvement that receives `👀`
enters the reply ledger. The reaction is not a reply or completion marker.
Before finishing, re-read each claimed item and verify the invoking identity
posted **Fixed**, **Shipped**, **In progress**, or **Clarification needed**, or
recorded **Open - no reply** or **Abandoned - no answer in 4 days** with a
concrete reason and the `👀` removed for any terminal no-reply disposition. An
expired question leaves the ledger with its `👀` removed and no reply owed.
**Clarification needed** may retain the eye only while the targeted question is
pending. **In progress** requires
concrete existing ownership or active fixing and must be revisited; a bot
forward, another person's reply, or `👀` alone does not qualify. Mistaken
out-of-scope eyes use the cleanup rule above, not a new reply.

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
- Re-read dirty files before changing them. Preserve the shared checkout and
  never move branches, reset, stash, or overwrite peer work.

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

Once classified as a clear bug or an upvoted improvement, add `👀`
before investigation or delegation. Leave subjective/product, policy,
informational, bot-forward, status-only, non-repo-owned, and Design items
without reaction, reply, or code unless the invoking identity's `:upvote:` put
them in scope; Design goes to Sid unless upvoted or explicitly assigned.

`👀` is a temporary exclusive-work lock, not a handled marker. Keep it while
actively investigating or fixing, or while waiting on one targeted reporter
clarification that could unblock the fix. Keep internal verification gaps
internal and do not claim **Fixed**.

If the investigation cannot produce a verified reproduction or safe fix,
remove the `👀` and record **Open - no reply** with the concrete evidence. Post
nothing: releasing the eye is the handoff, and a reply saying another owner
should act adds no value. Ask for reporter input only when a specific missing
detail, such as a browser-console screenshot, would let you reproduce and fix
the issue.

Never post the same sentence into several threads. When reports share one
cause, reply once and record the rest as clustered.

A tracked clear-bug or authorized upvoted improvement receives at most one
external disposition per run: **Fixed**, **Shipped**, **In progress**,
**Clarification needed**, or **Open - no reply** with a reason. An already-eyed
item later found to be out of scope gets reaction cleanup and no new reply; if
this workflow already replied, delete that reply when safe or edit it to one
concise **Skipped** disposition. **Fixed** closes the current issue. **In progress** is
an open ownership state for a thread
where `@agent-native` or another participant already found the cause, linked a
fix, or said the work is being fixed; use it to acknowledge the existing work,
never to replace verification or to create a vague status update. The next run
must revisit **In progress** and resolve it to **Fixed** or
**Clarification needed**. `Blocked`, `not fixed yet`, `still needs a fix`, and
similar phrases are internal notes, never a complete Slack reply. **Open - no
reply** is terminal only after removing the eye. If a reply
does not say the fix is complete, acknowledge concrete existing ownership, or
ask what is needed to fix it, do not post it. These are ledger states, not
mandatory headings: keep the reporter-facing wording natural instead of
opening with the robotic phrase “Clarification needed”. A substantive
diagnosis, fix, or in-progress ownership statement from someone in the thread
is not a reason to ask for clarification; verify it or continue the existing
handoff first.

**Clarification needed** is an open state, not a completed product fix. Asking
the question creates a standing obligation to come back for the answer. It is
the invoking identity's terminal disposition for the current cursor, but the next
`review-latest-feedback` run must re-read every thread it previously asked in
before scanning newer messages; when this workflow runs on its own, do the same
and act on the replies first.

That obligation expires after four days, standalone runs included: remove the
`👀`, post nothing, and record the terminal **Abandoned - no answer in 4 days**.
An expired thread keeps no eye and owes no reply. Carry the underlying bug
forward with no reporter dependency.

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
   each clear bug immediately, one thread at a time as it enters scope. Do not
   batch reactions until after investigation, implementation, testing, or the
   final Slack pass. If the reaction fails, stop and retry or report the
   concrete Slack permission/API blocker before continuing the investigation.
   Do not react to subjective/product, policy, informational, bot-forward,
   status-only, Design, or non-repo-owned items.
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
5. Before posting, prepare one short status for every clear-bug item and every
   Slack parent marked `👀`:
   - **Fixed** - say that the verified code change is complete and when it
     should be live. For today's beta-bound fixes, say explicitly that it will
     be on beta later today; never send a bare “Fixed”.
   - **Shipped** - use for an authorized upvoted improvement after its requested
     behavior and verification check are complete.
   - **In progress** - only when the thread already contains a substantive
     ownership or active-fix signal; thank the reporter, acknowledge that the
     team is already working on it, and do not ask a duplicate question. This
     is an open handoff, not a terminal fix.
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
   audit the reply ledger: for every `👀` parent, record the invoking user's
   reply timestamp and whether it is **Fixed**, **Shipped**, **In progress**, or
   **Clarification needed**, or **Open - no reply** with the reason. For a
   mistakenly eyed out-of-scope item, record reaction removal and no new reply
   instead. Keep an eye-only clear bug while actively working it; if the
   investigation cannot reproduce or fix it, remove the eye and record
   **Open - no reply** without posting a status message. Do not create new
   reactions or questions for out-of-scope items.
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
- An **In progress** reply must still start with that thank-you and then say
  that the team is already looking into or fixing the issue. Do not use that
  state to ask for clarification that the thread already answered.
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
- If it is not fixed, do not post a status-only update. Continue the fix, or
  ask one concrete question only when reporter or product information is
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
  reporter detail would unblock the work, remove the `👀`, record **Open - no
  reply**, and post nothing.
- When a request ID would help, make the path easy and optional: “at the end of
  the chat, hit the three dots and share the request ID if that option is
  available.” Pair it with the useful surface link when one exists, such as a
  deck URL; do not ask for a prompt or run ID when the source fix is already
  established.
- Before finishing the sweep, search every reply authored in that sweep for
  vague unresolved wording and edit or remove it. Re-read the affected threads
  after each edit. Check that skipped subjective/product/policy items still
  have neither an eye reaction nor a reply from the invoking identity.

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
