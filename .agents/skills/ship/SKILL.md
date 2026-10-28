---
name: ship
description: >-
  Commit and push the current work, open a ready PR, babysit it through CI and
  review, and admin-merge it once it's green and clean, then rotate the
  worktree to a fresh branch. Use when the user asks to ship, publish, or hand
  off local changes. Merging to main deploys beta automatically; production
  promotion is manual.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship

`/ship` means: get the requested work merged to `main`. That covers
committing, pushing, opening a ready PR, fixing CI and review feedback,
merging, and leaving the worktree ready for the next task. Don't stop at
"PR opened" or "CI green", and don't ask for approval of routine steps along
the way. The request to ship already authorized them.

In a dry run (see `review-latest-feedback`'s "Dry run"), don't ship: no PR,
merge, or close-out.

## Ownership

- Resolve the active login once: `gh api user --jq .login`.
- **Your PRs** (author is that login, or a new PR you create): push, reply to
  every review thread, and admin-merge when the gate below passes. Replying on
  your own PR's review threads is always expected.
- **Anyone else's PR:** don't push, comment, or merge unless the user named
  that exact PR and that exact action. Permission to push is not permission to
  merge. Leave bot PRs (Dependabot and the like) alone.
- Never reset, stash, rebase, clean, or force-push work. Never add
  `Co-Authored-By`, "codex", or agent labels to commits, branches, or PRs.

## 1. Preflight

```bash
git fetch origin --quiet
git status --short
git rev-list --count HEAD..origin/main
```

- **Detached HEAD in a task-owned worktree:** create a branch without asking,
  using `/new-branch`'s naming. If HEAD is behind `origin/main` and has no
  commits of its own, branch from fresh `origin/main` and carry the dirty
  changes over. Otherwise branch at HEAD.
- **Shared checkout** whose branch isn't yours to publish: leave it as it is,
  make a task-owned worktree from fresh `origin/main` (or from the PR's live
  head when updating an existing PR), and carry only this task's changes.
- If a dirty path isn't part of this task, leave it untouched and say so in
  the report.
- Being behind `main` is fine. Merge `origin/main` only when GitHub reports
  `CONFLICTING` or a required check needs a fix that's already on `main`. Use
  a normal merge, never a rebase.

## 2. Validate and push

Run the focused checks for what changed (formatter, tests, typecheck, and the
guards `pnpm guards` selects). Batch every known fix into one push, because
each push restarts CI.

```bash
corepack pnpm ship:push -m "<subject naming the actual behavior change>"
```

The helper refuses vague subjects. For an existing PR whose head isn't this
branch on `origin`, push to the verified head repo and ref instead (see
`babysit-pr`).

## 3. Open the PR

Open one ready (not draft) PR right after the first push, with a factual title
and body: what changed, why, and how it was verified. Keep source checks, CI
state, merge, and deployment as separate claims. Don't add unrelated comments,
tags, assignees, or mentions.

## 4. Babysit to merge

Run `/babysit-pr <number>` in this same task. It's a step inside `/ship`, not
a handoff, so keep going until the merge. Every tick:

- Read **all** review comments and review bodies (bots re-review on every
  push). Fix real issues, reply to each thread with the fix or your reasoning,
  and push one batched update.
- Read failing CI logs and fix repo-owned causes. Classify provider outages,
  cancelled runs, and missing secrets before touching code.
- In Codex, set a goal (`create_goal`, or reuse one that covers this PR)
  whose endpoint is "merged, in `origin/main`, worktree rotated", plus one
  same-thread heartbeat (about every 5 minutes, backing off to 30 after three
  unchanged wakes) so CI waits resume on their own. The heartbeat stays silent
  unless something changed, and you delete it after the merge. In Claude Code,
  keep working in the foreground.

## 5. Merge gate

Merge when all of these have held on the unchanged head for 10 minutes:

- clean tree, nothing unpushed;
- required checks green;
- every review item fixed or answered;
- GitHub says `MERGEABLE`.

`REVIEW_REQUIRED` alone doesn't block your own PR. Re-check the gate right
before merging, then:

```bash
gh pr merge <number> --squash --admin --match-head-commit <head-oid-you-just-checked>
```

Write the checked OID into the transcript as `ship_merge_head_oid` before
running the merge. `/new-branch`'s post-merge rotation uses it. If the head
changed, restart the 10 minutes. Never enable auto-merge.

If the user said to leave the PR open, or you only have permission to push to
someone else's PR, stop at a green, review-clean, mergeable PR, and don't
rotate.

## 6. After merge

- Confirm `origin/main` contains the merge commit.
- Close GitHub issues the PR fixes with a short thank-you that links the PR.
- If the PR body has a `Reports` section, run `/review-latest-feedback` step
  5 ("Close the loop") for exactly those threads. That step owns the reply
  format, the skip rules, and the no-duplicate check. Never reply on threads
  that aren't listed.
- In a task-owned worktree, rotate to a fresh branch from the new
  `origin/main` (`/new-branch`), provided nothing is unpushed or dirty. Leave a
  shared checkout's branch alone.

Merging to `main` publishes beta automatically
(`deploy-beta-sites-prebuilt.yml`), so "it'll be on beta shortly" is accurate
after a merge. Docs on `main` publish to production automatically. All other
production promotion is manual. Don't claim beta or production is live
without checking; use `/ship-and-monitor` when the user wants that proof.

## Report

Give the PR link, the merge commit, the checks run, the branch disposition,
and anything left for a person, each in a line or two.
