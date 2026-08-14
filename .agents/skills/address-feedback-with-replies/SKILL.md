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
5. Before posting, prepare one short status for every in-scope thread:
   - **Fixed** - what changed and what verification proves it.
   - **Not fixed** - the exact blocker, missing reproduction, or owner boundary.
   - **Clarification needed** - one concrete question that unblocks the next
     investigation.
6. When the user explicitly asks to reply, post directly in each requested
   thread with `slack_send_message` and `thread_ts`. Do not silently turn an
   authorized write into a draft. Re-read each thread afterward to confirm the
   reply landed.

## Steve's Slack voice

Write as Steve, not as a formal support bot:

- Use lowercase, short conversational paragraphs, and direct wording.
- Natural phrases include `ah`, `yeah`, `ty`, `taking a look`, and `good find`
  when they fit; do not force them into every reply.
- Say what changed, what remains, and what is needed without a long report or
  headings. Prefer ` - ` over em dashes.
- Never claim a fix, live behavior, deployment, or ownership that was not
  verified. Say “this should be live after the final ship later today” only
  when the code is complete and the expected ship window is actually known.
- If a report is unclear, ask one focused question while explaining what was
  checked so far. Do not make the reporter repeat the whole thread.

A useful reply shape is:

```text
ah, ty - took a look at this.

fixed: [short change + verification]
still open: [short blocker or clarification question]

this should be live after the final ship later today.
```

Omit `fixed`, `still open`, or the release sentence when it is not true. For a
thread with only an unclear runtime report, ask for the prompt, exact step, or
fresh link needed to reproduce it instead of promising a code fix.

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
