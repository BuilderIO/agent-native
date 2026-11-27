---
name: babysit-pr
description: >-
  Watch an open PR and fix its CI failures and review feedback until it's
  clean. Use standalone for a PR you want monitored, or as the babysit step of
  /ship, which continues through the merge.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Babysit PR

Monitor PR `$ARGUMENTS`: fix CI failures and review feedback, one batched push
at a time, until the PR is clean. With no number, find it from the branch:

```bash
gh pr list --head "$(git branch --show-current)" --state open --json number --limit 1
```

Ownership, who may push or comment, the merge gate, cadence, and the Codex
goal and heartbeat all live in `ship`. Under `/ship` this is a step inside it:
keep going through the merge. Standalone, stop after 30 minutes of green
GitHub Actions and no new feedback, and merge only if the user asks. On a
factory PR, each watcher prompt is one tick, the watcher pushes and merges,
and the round skips the login check below:
see `factory-run/references/babysit-round.md`.

## Each tick

1. Refresh and read the live PR:

   ```bash
   git fetch origin --quiet
   gh api user --jq .login
   gh pr view $ARGUMENTS --json state,mergedAt,author,headRepository,headRefName,headRefOid,baseRefName,mergeable,mergeCommit
   ```

   If `author.login` isn't your login, don't push, comment, or merge unless
   the user named this PR and that action. Closed without a merge ends the
   work; report it as unsuccessful. Merged
   under `/ship` continues with its post-merge step. If the query fails, retry
   on the next tick instead of acting on old data.

2. Read all review comments, every tick, until the moment you merge. Review
   bots re-review on every push and post a new round each time. Never filter
   by a "since <timestamp>" window: it hides rounds posted before your last
   reply, and "0 new" reads as "all addressed" (this left two rounds
   unanswered on PR #1097). Use reply state instead. Run both queries below
   with `set -o pipefail`. If either fails, the PR is not clean: retry next
   tick, and never read empty output from a failed call as "no feedback". This
   lists every top-level comment with no reply:

   ```bash
   gh api --paginate repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --jq '.[]' \
     | jq -s '
       ([ .[] | .in_reply_to_id // empty ]) as $replied
       | .[]
       | select((.in_reply_to_id // null) == null)
       | select(.id as $id | ($replied | index($id)) | not)
       | {id, user: .user.login, path, line: (.line // .original_line), snippet: (.body[0:200])}'
   ```

   Bind `.id as $id` first. `index(.id)` would read `.id` from the `$replied`
   array and fail. Review bodies carry findings too:

   ```bash
   gh api --paginate repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews \
     --jq '.[] | select(.body != null and .body != "") | {user: .user.login, state, submitted_at, body: .body[0:1000]}'
   ```

3. Check CI with `gh pr checks $ARGUMENTS` and read the logs of failing jobs.
   Fix repo-owned causes. Provider outages, cancelled runs, and missing
   secrets are not code bugs. Failures from external checks only (Cloudflare,
   Netlify) while GitHub Actions is green don't block, and they don't reset
   any timer.

4. Fix, validate, push once. Collect everything actionable from steps 2 and 3
   first, run the focused checks for what you changed, then push a single
   update. Each push restarts CI, so don't push piecemeal.

5. Reply on your own PR. Answer every thread you fixed or declined with the
   fix or your reasoning, and post one short top-level recap for feedback that
   only appeared in a review body. On anyone else's PR, comment only if the
   user named that PR and the comment. Feedback that needs a reply you aren't
   allowed to post stays unresolved and blocks the merge.

## Judging feedback

- Follow a human reviewer over a bot. Treat a bot comment as a hypothesis and
  verify it before acting.
- In rounds 1-2, fix real bugs, security issues, data-loss risks, and
  repo-rule violations, even when this PR didn't introduce them. From round 3,
  see Review round cap.
- Skip, with a reply saying why: pre-existing issues the PR doesn't touch,
  false positives, nitpicks, and anything the linter or typechecker already
  covers.
- Never leave a comment without a disposition.
- A high or critical finding closes only with a commit that fixes it, or a
  reply that points at the code showing it can't happen. Replying
  "addressed" without either doesn't close it, and it blocks the merge.
- When a third round of findings lands on code this PR added, stop patching
  its edges: each patch is new code for the next round. Replace it with
  something simpler, often by fixing the boundary that made it necessary,
  or, in a sweep, revert that report's commit and leave it for a person.
  #8288 patched one resolver about 25 times in a day and never merged.

## Review round cap

Count a round as one batch of bot or AI review findings posted after a push
(Steve 11/20: "26 rounds of review is way too much"). Pattern key:
`review-round-churn`.

- Rounds 1-2: address every item.
- Round 3 and later: fix only critical and high items. A finding is critical
  because of what it does (data loss or corruption, a security issue, a crash
  or broken core flow, or a regression in tested behavior), not because of the
  label the bot gave it: those findings are fixed or disproven in any round,
  whatever their severity label. Only findings that are not critical in that
  sense and are labelled medium or low may be deferred.
- Reply to a deferred item in its thread with one line, "Deferred as
  non-critical after round 2; tracked in <follow-up>", resolve the thread, and
  append the item to one follow-up list (a single PR comment or issue).
  A deferral counts as answered only once its thread reply is posted; where a
  reply isn't permitted (factory rounds, others' PRs), the thread stays
  unanswered and the existing reply-state merge rule applies. Scope this to the existing rules: in
  factory rounds, don't resolve threads, only record the deferral in the
  follow-up list; on another person's PR, comment only with that PR's
  authorization, otherwise list the deferral in your report; when posting or
  resolving isn't permitted, use that instead of the reply.
- Merge authorization and `ship`'s merge gate (stable head, mergeability)
  apply unchanged: standalone, merge only if the user asks.
- Human reviewer comments are always addressed, in any round.

## Pushing to an existing PR

`pnpm ship:push -m "<specific subject>"` stages every publishable dirty path,
so check `git status` first and stop if a path isn't part of this fix. It
pushes `origin/<local branch>`. Use it
when `origin` is the PR's head repository and the local branch name equals
`headRefName`. Otherwise commit your paths, find the remote whose URL matches
`headRepository.nameWithOwner` (add one if needed), recheck the live head OID,
confirm `git log <live headRefOid>..HEAD` lists only this fix's commits, and
push `HEAD:refs/heads/$headRefName` to it.

If the push is rejected or the head moved, fetch that head, merge it into the
branch (never rebase or force-push), re-run the focused checks, and push again.
If another worktree has unpublished commits on that branch, leave them alone
and say so in your report.

## Missing changeset

If `Lint & format` fails at `Require changeset for publishable package
changes`, it's not a code bug. The step log has a line
`MISSING_CHANGESET_PACKAGES: pkg1,pkg2`. Write `.changeset/<short-slug>.md`
directly (the interactive `pnpm changeset add` hangs):

```md
---
"@agent-native/<pkg>": patch
---

<one line from the PR title>
```

Use `patch` for fixes, docs, and refactors, and `minor` for additive or
breaking changes (`major` bumps are blocked by `guard-no-major-changeset`).
Commit as `chore: add changeset for <packages>` and push with the next batch.

## Syncing main

Run `node scripts/merge-main-into-pr.ts $ARGUMENTS`. It merges `origin/main`
only when GitHub reports the PR `CONFLICTING`/`DIRTY` and refuses otherwise
(exit 3): a behind count, pending checks, or a failing check whose fix exists
only on `main` are no reason to sync (in the last case, stop and report
blocked with what `main` has). It is a normal merge, never a rebase, and
requires a clean tree and HEAD equal to the live PR head (`learnings.md`,
`bridge/**` and `data/**` don't count as dirty). Exit codes: 0 merged; 1
unresolved conflicts (resolve, `git commit --no-edit`, push); 2 precondition
failed (dirty tree, HEAD not the live head, fetch failed); 3 refused, no
conflict; 4 merge failed with no conflicts (inspect `git status`, don't
resolve); 5 GitHub query failed (retry).

For a `pnpm-lock.yaml` conflict, take one side with
`git checkout --theirs -- pnpm-lock.yaml`, then
`pnpm install --lockfile-only`. Complete the merge and push normally.

## Local changes you don't recognize

If the tree has changes this PR didn't make, leave them alone: no stash, no
commit, no revert. Publish only the paths that belong to the fix.

## Merging

Under `/ship`, or standalone when the user asks you to merge, merge only once
`ship`'s gate holds, using its exact command. Just
before merging, rerun the unreplied-comments query and the review-bodies call
above so no new bot round slips in, and confirm
`git rev-parse HEAD` equals the live `headRefOid` (nothing local left
unpushed, nothing remote you haven't seen). Record `ship_merge_head_oid` as `ship`
describes. Under `/ship`, follow its post-merge step. Standalone, leave the
branch where it is unless the user also asked to rotate.
