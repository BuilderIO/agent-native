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
GitHub Actions and no new feedback, and merge only if the user asks.

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
- Fix real bugs, security issues, data-loss risks, and repo-rule violations,
  even when this PR didn't introduce them.
- Skip, with a reply saying why: pre-existing issues the PR doesn't touch,
  false positives, nitpicks, and anything the linter or typechecker already
  covers.
- Never leave a comment without a disposition.

## Pushing to an existing PR

`pnpm ship:push -m "<specific subject>"` stages every publishable dirty path,
so check `git status` first and stop if a path isn't part of this fix. It
pushes `origin/<local branch>`. Use it
when `origin` is the PR's head repository and the local branch name equals
`headRefName`. Otherwise commit your paths, find the remote whose URL matches
`headRepository.nameWithOwner` (add one if needed), recheck the live head OID,
and push `HEAD:refs/heads/$headRefName` to it.

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

Use `patch` for fixes, docs, and refactors, `minor` for additive features, and
`major` only if the PR says it's breaking. Commit as
`chore: add changeset for <packages>` and push with the next batch.

## Syncing main

Merge `origin/main` only when GitHub reports `CONFLICTING`, or a failing
required check is already fixed on `main`. A behind count or pending checks
are no reason to sync. Use a normal merge, never a rebase, with the tree clean
and HEAD equal to the live PR head:

```bash
dirty=$(git status --porcelain -- ':/' ':(top,exclude)learnings.md' ':(top,exclude)bridge/**' ':(top,exclude)data/**') \
  && test -z "$dirty" \
  && [ "$(git rev-parse HEAD)" = "$(gh pr view $ARGUMENTS --json headRefOid --jq .headRefOid)" ] \
  && git fetch origin main && git merge --no-edit origin/main
```

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
describes, then follow its post-merge step.
