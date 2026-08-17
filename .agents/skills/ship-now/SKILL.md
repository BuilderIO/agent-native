---
name: ship-now
description: >-
  Fast-path the current branch through local `pnpm prep:urgent`, targeted recovery,
  feedback resolution, owned-path push, immediate admin merge, and
  fresh-branch rotation. Use when the user explicitly wants to merge
  immediately after local prep recovery, then monitor the merged PR and
  release workflows.
---

# Ship Now

Use this only after the user explicitly requests the fast admin-merge path.
It is an intentional exception to `/ship`'s remote-CI wait and ten-minute
merge soak: local `pnpm prep:urgent`, or targeted recovery of its failed lanes, is the
pre-merge validation gate. The user has authorized `--admin` merging once
feedback is handled. Remote CI, release, and deploy results are monitored
after merge, not waited on before the admin merge.

## Fast-path contract

`/ship-now` never means “ship every dirty file in the checkout.” It publishes
only this agent's owned paths. A shared-checkout status line is not permission
to stage peer work: record the ownership baseline, and if a path is unfamiliar
or changes under another agent during the flow, leave it untouched and out of
the commit. Re-check ownership immediately before every stage, commit, and
push.

The fast gate is local `pnpm prep:urgent`, or the narrowest successful recovery check
for each failed prep lane. Once that gate and review resolution pass, admin
merge immediately. Do not wait for a full prep rerun, remote CI, release or
deploy checks, or the normal `/ship` soak; monitor those after the merge.

## Workflow

1. Inspect the current branch before writing or moving it:

   ```bash
   git status --short
   git log --oneline -5
   git branch --show-current
   gh pr list --head "$(git branch --show-current)" --state open --json number,title,url
   ls -la .claude/leases/ 2>/dev/null || true
   ls -la .claude/worktrees/ 2>/dev/null || true
   ```

   Stay on the current branch until its PR is merged. Do not reset, rebase,
   force-push, clean, or overwrite peer work. Record the current status as the
   ownership baseline. Only files you changed for this invocation are in scope
   for its commit and push. If another agent changes or adds a path during the
   flow, leave it untouched and uncommitted; do not absorb it into this PR.

2. Resolve review state before merging. Read every current human and bot
   review summary and every top-level inline comment across all pages. Fix
   real issues on the current branch and reply to each addressed or declined
   comment. Recheck reply coverage after every push; a new bot review is a new
   round. Do not merge with unaddressed feedback.

3. Run the local gate:

   ```bash
   pnpm prep:urgent
   ```

   `prep:urgent` uses `--kill-others-on-fail`; a lane killed because a sibling
   failed is unknown, never green. Treat a non-zero, skipped, killed, or inconclusive prep result as a failure
   to classify, not as a reason to repeat the entire suite automatically. Fix
   the root cause and rerun the narrowest meaningful check for the failed lane:

   - a package typecheck failure: that package's typecheck, for example
     `pnpm --filter @agent-native/desktop-app typecheck`;
   - a test failure: the specific Vitest file or test command;
   - a guard failure: the named guard command;
   - formatting: `pnpm exec oxfmt --check <changed-files>`.

   Keep only lanes that conclusively reported success, and rerun any lane whose
   result is unknown alongside the failure. Run a full `pnpm prep:urgent` again only
   when the fix crosses several validation boundaries or the failure cannot be
   isolated. For a file-scoped type failure, a green
   package typecheck is the recovery gate; for a test failure, a green targeted
   test is the recovery gate. Once the targeted recovery is green and no lane
   is left unknown, continue to the owned-path push - do not wait for a
   redundant full prep rerun. Record that prep recovered through targeted
   checks - do not claim the entire `pnpm prep:urgent` command itself exited 0 when it
   did not, and do not report an unknown lane as one that passed.
   Preserve exact unrelated peer-check or environment failures rather than
   calling them green.

4. Publish only the current agent's owned paths immediately after the local
   gate passes:

   ```bash
   git add -- <owned-paths>
   git commit -m "<message>"
   git push origin HEAD
   ```

   Re-check the ownership baseline immediately before staging. Use explicit
   owned paths only. Never use `pnpm ship:push`, `git add -A`, or another
   whole-worktree helper: those commands can publish other agents' local work.
   Verify the push landed on the current branch and update the existing ready
   PR. Do not create a second PR. Recheck the PR's mergeability and current
   review comment reply coverage after the push.

5. Admin-merge immediately when the explicit fast-path gates are true:

   - local `pnpm prep:urgent` passed, or every failed and unknown prep lane was fixed
     or rerun and its narrow recovery check passed as described above;
   - the current agent's owned commits are pushed; uncommitted peer paths may
     remain in the shared checkout and must not be staged or pushed;
   - every review item has a fix or an explicit reply;
   - the PR is not conflicting; and
   - the user has explicitly authorized this `/ship-now` invocation.

   Use the current PR number and no force push:

   ```bash
   gh pr merge <number> --squash --admin
   ```

   Do not wait for remote CI, release checks, or the normal `/ship` soak, and
   do not pretend that a queued merge is complete. Read the merge result,
   fetch `origin/main`, and verify the merge commit is present before rotating
   branches.

6. Run `/new-branch` after the merge lands. Follow its activation guard,
   origin/main freshness check, stash gate, branch naming, conflict handling,
   and post-flight stash report exactly. Before leaving the merged branch,
   ensure no fresh lease or worktree shows a peer still actively using it; if
   one does, preserve the work and get direction rather than stranding it.

7. Monitor the merged PR and release tail after rotation. Check the merged PR's
   merge commit, all workflows attached to that commit, deployment status, and
   package publication when applicable. Keep configured, source-tested,
   built-runtime, deployed, and observed-live claims separate. A merge is not
   proof that release or production is healthy.

8. If a post-merge CI, deploy, package-publish, or release issue appears:

   - reproduce or read the failing artifact;
   - fix it on the fresh branch, never on the merged branch;
   - run the smallest meaningful local check, then `pnpm prep` when the change
     warrants it;
   - invoke `/ship` for the follow-up so its normal review, merge, and
     post-release gates apply. Keep peer paths out of that follow-up too.

   If no post-merge issue appears, report the PR, merge commit, fresh branch,
   release checks, and the monitoring window honestly.

## Safety rules

- Never expose environment values, tokens, cookies, or private payloads in
  commits, PR text, logs, prompts, or status reports.
- Never stage or push a local path merely because it appeared during the ship
  flow. Peer work stays in the checkout for its owner to ship.
- Never silently skip a review comment, CI failure, package release failure,
  or production deploy failure.
- Never create a fresh branch before verifying that `origin/main` contains the
  merge commit.
- Never claim the fast path is complete from a successful merge command alone;
  verify the merge, branch rotation, and post-merge release state.

## Related skills

- `/ship` for the normal guarded ship flow and follow-up fixes.
- `/babysit-pr` for review/comment/CI coverage before a merge when the user did
  not explicitly choose this fast path.
- `/new-branch` for the only permitted branch-rotation procedure.
