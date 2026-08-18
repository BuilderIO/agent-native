---
name: address-feedback-with-replies
description: >-
  Complete the Slack feedback cycle: read every thread and linked evidence,
  fix verified repo-owned issues, and reply in-thread with honest status,
  clarification questions, and release follow-up. Use when the user asks to
  address feedback and respond as themselves.
scope: dev
metadata:
  internal: true
---

# Address Feedback With Replies

Use this workflow when the user wants feedback triaged, fixed, and answered in
Slack in one pass. Compose and post replies only for the threads the user put
in scope. Keep the code change and the external reply equally evidence-based.
When several Slack threads clearly describe the same underlying issue, group
them into one similar-feedback cluster and use one Builder thread for the
cluster, while still replying in every in-scope Slack thread that needs a
status.

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
- Before asking for clarification, build a known-evidence / missing-evidence
  ledger from the entire current thread and its linked artifacts. Record the
  app or surface, URL, repro, exact error, screenshots or files, run or request
  IDs, and answers already given. Never request a value that is already in the
  parent, a reply, or an accessible attachment or linked run. If a required
  artifact is present but inaccessible, request access or a fresh/replacement
  link instead of requesting its contents again.
- If the report includes a run ID, use that ID first to inspect the persisted
  run, events, tool cards, and linked app state. Do not ask for the prompt or
  last tool card until the run ID and available observability paths have been
  exhausted; do not ask for evidence already present in Slack or the app.
- Search recent Slack history, local Git history, and merged PRs for repeat
  reports and existing fixes before editing.
- Re-read dirty files before changing them. Preserve the shared checkout and
  never move branches, reset, stash, or overwrite peer work.

## Decision Gate

Apply the shared `address-feedback` **Choose the fix altitude** gate before
reacting, editing code, or posting a reply. It applies to the whole sweep, not
only the newest thread, and decides whether the smallest owning seam, a shared
contract, discovery/registry, or build/deploy diagnosis is appropriate. It
also prevents one subjective report from becoming a global instruction.

Once a report is classified as a concrete bug or missing evidence, add `👀`
immediately, before investigation or delegation. This is the first external
action for that thread. Use the shared skill's classification for
subjective/product, policy, informational, bot-forward, status-only, and
non-repo-owned items; leave those without a reaction, reply, or code change
unless the user explicitly assigns a concrete repo action.

`👀` is an investigation marker, not a handled marker. A thread with only that
reaction must remain eligible for the next cursor scan. If a fix is complete
but internal verification is unavailable, leave the reaction in place, post no
external status, and let the next run re-read the thread before scanning newer
feedback. Remove the pending state only after verification and the final
user-facing status are complete.

Every actionable thread must end in exactly one external state: **Fixed** or
**Clarification needed**. `Blocked`, `not fixed yet`, `still needs a fix`, and
similar phrases are internal notes, never a complete Slack reply. If a reply
does not say the fix is complete and when it should be live, or ask what is
needed to fix it, do not post it. These are ledger states, not mandatory
headings: keep the reporter-facing wording natural instead of opening with the
robotic phrase “Clarification needed”.

**Clarification needed** is an open state, not a finished one. Asking the
question creates a standing obligation to come back for the answer: the thread
now looks owned to any cursor that scans for unhandled reports, so nothing will
resurface it on its own. `review-latest-feedback` owns that re-check and runs
it before it scans for new messages; when this workflow runs on its own, re-read
every thread it previously asked in and act on the replies first.

Treat a clarification reply as new evidence, not as a fresh blank report.
Re-read the whole thread after the reply, update the ledger, and try the fix
before posting another question. If the reply answers the earlier question,
do not repeat it. If it only answers part of it, ask only for the one remaining
missing value. A `Clarification needed` reply is invalid when the requested
 information is already present anywhere in the thread or accessible linked
 evidence. If the information is only known to be inside an inaccessible
 artifact, request access or a fresh/replacement link when that artifact is
 the blocker instead of asking for the information again.

## Workflow

1. Build a per-thread checklist with the symptom, expected behavior, evidence,
   owner, and disposition: bug, UX suggestion, unclear, policy, or out of
   scope. Use the shared `address-feedback` categorization and Fix-altitude
   gate when choosing the disposition and owning seam. When the same underlying
   issue appears in multiple threads, build one cluster checklist and drive one
   Builder thread for that cluster; do not create separate Builder threads
   unless the reports diverge in symptom, surface, or owner.
2. The reaction is the first external action after classification. Add `👀` to
   each concrete bug or clarification-needed thread immediately, one thread at
   a time as it enters scope. Do not batch reactions until after investigation,
   implementation, testing, or the final Slack pass. If the reaction fails,
   stop and retry or report the concrete Slack permission/API blocker before
   continuing the investigation. Do not react to subjective/product, policy,
   informational, bot-forward, status-only, or non-repo-owned items.
3. Parallelize independent investigations and narrow fixes with disjoint write
   sets. For every actionable repo-owned bug, keep working toward a verified
   fix. If reporter or product input is missing, ask one concrete question for
   it; do not settle for a vague unresolved status. If only internal test,
   deployment, or tooling verification is unavailable, keep that blocker
   internal and do not turn it into a reporter question.
4. Verify each fix with the smallest relevant test, typecheck, action read-back,
   or browser path. Keep source-tested, built, installed, deployed, and live
   observations separate.
5. Before posting, prepare one short status for every in-scope feedback item
   or thread that was addressed - not only the newest report:
   - **Fixed** - say only that it is fixed and when it should be live.
   - **Clarification needed** - ask one concrete, plain-language question that
     unblocks the next investigation, only when reporter or product input is
     missing, or a needed linked artifact is inaccessible, after checking the
     available run, app, Slack, and linked-file evidence.
     Re-read the full thread immediately before posting and verify the exact
     requested detail is absent or the exact access/replacement blocker still
     exists; do not ask again for evidence already supplied in the parent, a
     reply, an accessible file, or an accessible linked run. If the evidence is
     in a linked but inaccessible artifact, ask for access or a
     fresh/replacement link instead.
   Apply a reply gate before every external post: a reply must either say the
   fix is complete and give its expected live timing, or ask the one essential
   missing question. Never post a blocked/unresolved status without a question
   that tells the reporter exactly what is needed. Never post a bare “not fixed
   yet,” “still needs a fix,” or equivalent status-only reply. If the
   investigation cannot yet produce a fix or concrete question, keep
   investigating instead of posting a vague update. “I confirmed the bug” is
   not a fix; either implement the change or ask for the exact information that
   prevents implementation.
   Keep the posted reply shorter than the investigation: say only that it was
   fixed and when it should be live, or ask the one truly required
   clarification. Omit what changed, verification details, implementation
   details, run IDs, session IDs, tool names, database/history details, and
   internal ownership boundaries from the posted reply. Those belong in the
   investigation, not in the reporter's thread. If the fix is complete but
   internal verification is unavailable, post nothing yet; keep only the
   investigation marker and resume from that thread on the next pass after
   verification is available.
6. When the user explicitly asks to reply, post directly in each requested
   thread with `slack_send_message` and `thread_ts`. Do not silently turn an
   authorized write into a draft. Re-read each thread afterward to confirm the
   reply landed. If a reporter replies after the post, re-read the entire
   thread again before deciding whether to fix, close, or ask anything else.
7. If the user says earlier replies were too technical, harsh, or incomplete,
   search for every reply authored in this sweep and edit the bad replies in
   place. Do not fix only the newest example or leave the other addressed
   threads with the old wording.

## Steve's Slack voice

Write as Steve, not as a formal support bot:

- Use lowercase, short conversational paragraphs, and clear, conversational
  wording. Keep the tone casual and collaborative - warm without being corny,
  and specific without sounding terse or demanding.
- Every feedback reply starts by thanking the reporter. Use the natural short
  form `ty for the feedback -` (or `thanks for the feedback -`) before the
  status. Do not open with `agreed`, `valid request`, `ah`, or a diagnosis.
- Use lowercase and a short conversational paragraph. Natural phrases such as
  `ah`, `yeah`, and `good find` can follow the thank-you when they fit; do not
  force them into every reply. Prefer ` - ` over em dashes.
- Thank the reporter by name when it is available, for example, “thanks
  Alexander -”. Ask for help rather than issuing a demand: prefer “if you can
  share ...” or “a deck URL or request ID would help us dig into this” over
  “send ...” or “provide ...”. Avoid canned enthusiasm, scolding, and robotic
  labels such as “Clarification needed” in the reporter-facing prose.
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
  a fresh/replacement link instead of requesting its contents again.
- When a request ID would help, make the path easy and optional: “at the end of
  the chat, hit the three dots and share the request ID if that option is
  available.” Pair it with the useful surface link when one exists, such as a
  deck URL; do not ask for a prompt or run ID when the source fix is already
  established.
- Before finishing the sweep, search every reply authored in that sweep for
  vague unresolved wording and edit or remove it. Re-read the affected threads
  after each edit. Check that skipped subjective/product/policy items still
  have neither an eye reaction nor an agent-authored reply.

A useful reply shape is:

```text
ty for the feedback - [short plain-language status].

  [if fixed: this should be live after the final ship later today.]
  [if clarification is needed: a casual request for the one detail that would
  help investigate, such as a deck URL and/or request ID.]
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
- Report repeat reports and any similar-feedback cluster handled as one Builder
  thread, along with the fixed items, flagged items, clarification questions,
  verification gaps, and the exact release state.

## Related Skills

- `address-feedback` - classification and fix boundaries.
- `concurrent-agents` - shared-checkout coordination.
- `verifying-changes` - proof before claiming done.
- `writing-agent-instructions` - guidance quality and scope.
