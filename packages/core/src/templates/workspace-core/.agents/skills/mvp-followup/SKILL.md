---
name: mvp-followup
description: >-
  Use when asking what to do next after a feature pass while avoiding bloat and
  checking for unfinished MVP work.
scope: dev
metadata:
  internal: true
---

# MVP Follow-Up

## Rule

Recommend or execute only closeout work that makes the current MVP more real,
verified, documented, or shippable. Do not propose new product scope unless
there is a clear blocker to the MVP working for real users.

## Workflow

1. Identify the current feature or thread outcome.
2. Check for unfinished work in this order:
   - failing or skipped verification
   - unreviewed real-data pilot results
   - pending review/proposals/approval queues
   - docs that no longer match behavior
   - unrelated dirty files that block full prep/ship hygiene
3. Recommend the smallest next batch that closes those gaps.
4. Explicitly skip tempting bloat: new integrations, dashboards, settings,
   abstractions, or extra UI unless they directly unblock real use.
5. If the user says "do it", run the closeout work in parallel where safe and
   keep edits minimal.

## Output Shape

Lead with the concrete next step. Keep the list short. Separate:

- **Do now**: validation, real pilot, docs, or bug fixes.
- **Defer**: useful ideas that should wait for real user feedback.
- **Blocker**: any specific user/manual action needed.

## Verification Bias

Prefer non-mutating checks when the worktree has unrelated dirty files. Use full
`pnpm prep` only when it will not rewrite someone else's concurrent work.

## Related Skills

- `qa`
- `ship`
- `adding-a-feature`
- `capture-learnings`
