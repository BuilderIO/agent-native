---
name: address-feedback-with-replies
description: >-
  Fix the feedback in specific Slack threads or a named Slack scope and answer
  each reporter in-thread. Use when the user points at particular Slack
  feedback and says "address this feedback", "fix these and reply", or links
  threads. For a full sweep of the feedback channels use review-latest-feedback.
scope: dev
metadata:
  internal: true
---

# Address Feedback With Replies

Triage, fix, ship, and answer the Slack threads the user pointed at, in one
pass. This is `review-latest-feedback` aimed at a specific set of threads
instead of the whole sweep. That skill owns the Slack contract: the 👀 / ✅ / 🎫
reactions, the one-sentence reply and its wording, which channels are fair
game, the "leave it alone" rules, and Steve's `:upvote:`. Read it first and
follow it. This file adds only what is specific to working a given thread.

Use the connected Slack integration for every read and write, and confirm the
profile is Steve before the first write. Never drive Slack through a browser or
computer use.

## 1. Read everything first

- Read the parent message and every reply. Open every screenshot, file, video,
  transcript, and linked recording; the error text there is often the whole
  diagnosis.
- Fetch linked artifacts through their own connector or public URL. If one is
  permission-gated or expired, say so separately from "absent": ask for access
  or a fresh link only if you truly need it, otherwise carry on and note the
  limit.
- If someone in the thread already named the cause, shared a repro, linked a
  fix, or said it's being handled, verify that and build on it. Never ask the
  reporter to repeat it.
- If the report has a run ID, inspect that persisted run, its events and tool
  cards first. Don't ask for the prompt or last tool card until that is
  exhausted.
- Search recent Slack, local Git history, and merged PRs for repeat reports and
  existing fixes before editing. A repeat of something already fixed is a
  regression: find why the earlier fix didn't hold.
- Read `address-feedback`, `concurrent-agents`, and `verifying-changes`. Re-read
  dirty files and keep peer work intact; never reset, stash, or overwrite it.

## 2. Decide: fix, build, or needs a person

Apply the decision gate before reacting or editing, using the buckets in
`review-latest-feedback`:

- **Objectively broken** (errors, dead clicks, lost or wrong data,
  regressions, slowness, clipping, overlap, broken layout): fix it.
- **Subjective UX asks** (add, move, hide, restyle a control; "hard to find"):
  don't auto-implement. These get 🎫 and a reply naming who should decide.
  Concrete critique of an existing surface that is clearly a defect is a bug,
  not a UX ask. An `:upvote:` from Steve on a feature request means build the
  smallest version that does what was asked; no second sign-off needed.
- **Not actionable** (praise, chatter, announcements, bot forwards, duplicates):
  no reaction, no reply.

Pick the fix altitude using `address-feedback`: smallest owning seam for one
report, the shared primitive for a repeated failure, and never a global agent
rule from one data point.

Once a thread is in scope, add 👀 before investigating, one thread at a time,
and only if you'll finish answering it in this run. If the reaction fails,
resolve that before going on.

## 3. Clusters and questions

- When several threads report the same underlying issue, drive one fix and one
  piece of work for the cluster. Reply in each reporter's own thread once, in
  the usual one-sentence style, rather than sending a pile of duplicates.
- Ask a reporter a question only when one specific missing detail blocks a safe
  fix to an otherwise clear bug, and only one question may be pending per
  thread. Before asking, re-read the whole thread, including earlier questions
  from this skill, `review-latest-feedback`, or `@agent-native`, and check it
  hasn't already been answered or resolved.
- Never ask for evidence that is already in the thread, for access you only
  lack internally, or for a subjective product choice.
- An answer from anyone in the thread counts. Re-read the full thread, then try
  the fix with the new detail before asking anything else. A partial answer
  keeps the existing question pending. Ask a new question only about a single,
  different, still-blocking detail.

## 4. Fix, verify, ship

Group independent fixes across subagents with disjoint files, reproduce where
you reasonably can, fix, and verify as `verifying-changes` describes (a test
that fails before and passes after, or the flow working in the running app).
Timebox one item to about 30 minutes; if it doesn't yield, it becomes 🎫 with a
line on what you learned. Put the fixes in one PR and run `/ship` through the
merge, with every fixed thread's Slack link in the PR body's `Reports`
section. Only Steve's own PRs get pushed, merged, or commented on.

## 5. Close the loop

Run `review-latest-feedback` step 5 for every thread you put 👀 on. That
step owns the replies and reactions. `/ship` has already run it for the
`Reports` threads it merged; the step's no-duplicate check covers those, and
any it skipped or couldn't merge still get their outcome here:

- Fix not merged yet: reply that a fix (PR linked) is ready.

- Needs a person: 🎫 and what's needed from whom, as a plain name.
- Couldn't reproduce: 🎫 and one specific question.

Re-read each thread you touched and confirm the reply landed under the right
parent, with no 👀 left without a ✅ or 🎫. If a participant replies after you
post, re-read the whole thread before deciding what to do next.

If Steve says earlier replies were too technical, edit every reply from this
run, not just the latest example.

## 6. Recap

Briefly: threads fixed (with links), threads needing a person and who,
questions asked, anything you couldn't verify, and the PR link.

## Related skills

`review-latest-feedback` (Slack contract), `address-feedback` (classification
and fix altitude), `concurrent-agents`, `verifying-changes`.
