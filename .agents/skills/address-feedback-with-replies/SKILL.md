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

## Prerequisites

- Read `address-feedback`, `concurrent-agents`, and `verifying-changes` first.
- Read the linked Slack parent and every reply. If a message points to a Clips
  link, transcript, video, screenshot, file, or newer follow-up, inspect it too.
- If the report includes a run ID, use that ID first to inspect the persisted
  run, events, tool cards, and linked app state. Do not ask for the prompt or
  last tool card until the run ID and available observability paths have been
  exhausted; do not ask for evidence already present in Slack or the app.
- Search recent Slack history, local Git history, and merged PRs for repeat
  reports and existing fixes before editing.
- Re-read dirty files before changing them. Preserve the shared checkout and
  never move branches, reset, stash, or overwrite peer work.

## Workflow

1. Build a per-thread checklist with the symptom, expected behavior, evidence,
   owner, and disposition: bug, UX suggestion, unclear, policy, or out of
   scope.
2. Add `👀` only to actionable feedback that did not already have it. Do not
   react to bot forwards, status-only updates, or unresolved policy questions.
3. Parallelize independent investigations and narrow fixes with disjoint write
   sets. Fix only verified repo-owned bugs; add focused regression coverage
   when the report is a repeat or the failure can be reproduced.
4. Verify each fix with the smallest relevant test, typecheck, action read-back,
   or browser path. Keep source-tested, built, installed, deployed, and live
   observations separate.
5. Before posting, prepare one short status for every in-scope feedback item
   or thread that was addressed - not only the newest report:
   - **Fixed** - what changed and what verification proves it.
   - **Not fixed** - the exact blocker, missing reproduction, or owner boundary.
   - **Clarification needed** - one concrete question that unblocks the next
     investigation, only when the available run, app, Slack, and linked-file
     evidence is insufficient.
   Keep the posted reply shorter than the investigation: say only whether it
   was fixed, what remains open in plain language, when it should be live, and
   any truly required clarification. Omit implementation details, run IDs,
   session IDs, tool names, database/history details, and internal ownership
   boundaries from the posted reply. Those belong in the investigation, not in
   the reporter's thread.
6. When the user explicitly asks to reply, post directly in each requested
   thread with `slack_send_message` and `thread_ts`. Do not silently turn an
   authorized write into a draft. Re-read each thread afterward to confirm the
   reply landed.
7. If the user says earlier replies were too technical, harsh, or incomplete,
   search for every reply authored in this sweep and edit the bad replies in
   place. Do not fix only the newest example or leave the other addressed
   threads with the old wording.

## Steve's Slack voice

Write as Steve, not as a formal support bot:

- Use lowercase, short conversational paragraphs, and direct wording.
- Every feedback reply starts by thanking the reporter. Use the natural short
  form `ty for the feedback -` (or `thanks for the feedback -`) before the
  status. Do not open with `agreed`, `valid request`, `ah`, or a diagnosis.
- Use lowercase, a short conversational paragraph, and direct wording. Natural
  phrases such as `ah`, `yeah`, and `good find` can follow the thank-you when
  they fit; do not force them into every reply. Prefer ` - ` over em dashes.
- The audience is product/design/feedback reporters, not developers. Never
  post technical explanations such as shared paths, transports, sessions,
  repro levels, payloads, schemas, CORS, auth domains, action names, or
  implementation details. Translate the result to: fixed, not fixed and why,
  or one essential missing detail.
- A clear, valid, repo-owned request is an instruction to fix it. Do not reply
  `valid request` and stop, and do not say `no ship timing yet` as a dead end.
  Implement the fix first; when code is complete, say it should be live after
  the final ship later today (roughly end of day).
- Never claim a fix, live behavior, deployment, or ownership that was not
  verified. Say “this should be live after the final ship later today” only
  when the code is complete and the expected ship window is actually known.
- If it is not fixed, give the plain-language reason and what happens next. Ask
  a question only for information that is genuinely missing after exhausting
  the Slack thread, linked files/transcript/video, app state, run ID, sessions,
  and history. Never ask for a prompt, run ID, session, or file already present
  or available through those sources.

A useful reply shape is:

```text
ty for the feedback - [short plain-language status].

[if fixed: this should be live after the final ship later today.]
[if not fixed: plain-language reason and only an essential question, if any.]
```

Keep it to one short paragraph whenever possible. Omit the release sentence
only when the change is not complete; do not invent a ship date for an open
item. For an unclear runtime report, inspect its run ID and linked app evidence
first; ask for one missing detail only when those sources cannot adequately
identify the failure.

## Release follow-up

After the final ship, return to the same threads and post a brief follow-up
with the shipped commit/release and live-path evidence. If the ship has not
happened yet, say that plainly and do not imply that the fix is already live.

## Verification

- Run focused checks for every changed surface and `git diff --check`.
- Re-read the Slack threads after posting and confirm each requested reply is
  present under the intended parent.
- Report repeat reports, fixed items, flagged items, clarification questions,
  verification gaps, and the exact release state.

## Related Skills

- `address-feedback` - classification and fix boundaries.
- `concurrent-agents` - shared-checkout coordination.
- `verifying-changes` - proof before claiming done.
- `writing-agent-instructions` - guidance quality and scope.
