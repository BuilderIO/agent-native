---
name: ship-now
description: >-
  Fast-path the current branch through local `pnpm prep:urgent`, targeted recovery,
  feedback resolution, whole-branch push, immediate admin merge, and
  fresh-branch rotation. Use when the user explicitly wants to merge
  immediately after local prep recovery, then monitor beta and release
  workflows. Main auto-deploys beta; production promotion is manual.
---

# Ship Now

Use this only after the user explicitly requests the fast admin-merge path.
It is an intentional exception to `/ship`'s remote-CI wait and ten-minute
merge soak: local `pnpm prep:urgent`, or targeted recovery of its failed lanes, is the
pre-merge validation gate. The user has authorized `--admin` merging once
feedback is handled. Remote CI, release, and beta deploy results are monitored
after merge, not waited on before the admin merge.

## Deployment split

Merges to `main` auto-deploy only beta sites at `beta.*.agent-native.com`.
Production promotion is manual. `/ship-now` monitors beta and any release tail
after the fast merge; it does not imply that production was promoted. If a
critical fix needs production, explicitly run the manual promotion and monitor
that result separately.

Use `.github/workflows/deploy-production-sites-prebuilt.yml` or the targeted
`promote-netlify-deploy.yml` workflow to promote a critical fix and let it
manage Netlify lock transitions. Do not manually remove or clear a Netlify lock
as a deployment step; clearing one is not the production promotion.

## Fast-path contract

`/ship-now` publishes the complete nonignored current-branch snapshot. Use
`corepack pnpm ship:push` for every checkpoint; it excludes
`learnings.md`, `bridge/**`, and `data/**`.

The fast gate is local `pnpm prep:urgent`, or the narrowest successful recovery check
for each failed prep lane. Once that gate and review resolution pass, admin
merge immediately. Do not wait for a full prep rerun, remote CI, release or
beta deploy checks, or the normal `/ship` soak; monitor those after the merge.

A worktree is a valid publishing checkout. When `/ship-now` is authorized from
a worktree, keep validation, commit, push, PR lookup, and admin merge in that
worktree's current branch and cwd. Do not copy changes into the shared
checkout, and update the existing PR rather than creating a second one.

## Workflow

1. Inspect the current branch before writing or moving it:

   ```bash
   git status --short
   git log --oneline -5
   git branch --show-current
   gh pr list --head "$(git branch --show-current)" --state open --json number,title,url
   ```

   Stay on the current branch until its PR is merged. Do not reset, rebase,
   force-push, clean, or silently discard local work. Record the current status
   as the branch snapshot.

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
   is left unknown, continue to the branch-wide push - do not wait for a
   redundant full prep rerun. Record that prep recovered through targeted
   checks - do not claim the entire `pnpm prep:urgent` command itself exited 0 when it
   did not, and do not report an unknown lane as one that passed.
   Preserve exact unrelated check or environment failures rather than
   calling them green.

4. Publish the complete current-branch snapshot immediately after the local
   gate passes:

   ```bash
   corepack pnpm ship:push
   ```

   Verify the push landed on the current branch and update the existing ready
   PR. Do not create a second PR. Recheck the PR's mergeability and current
   review comment reply coverage after the push.

5. Admin-merge immediately when the explicit fast-path gates are true:

   - local `pnpm prep:urgent` passed, or every failed and unknown prep lane was fixed
     or rerun and its narrow recovery check passed as described above;
   - all nonignored local changes are pushed, with only the routine exclusions
     remaining;
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
   and post-flight stash report exactly.

7. Monitor the merged PR and release tail after rotation. Check the merged PR's
   merge commit, all workflows attached to that commit, beta deployment status,
   and package publication when applicable. Keep configured, source-tested,
   built-runtime, deployed, and observed-live claims separate. A merge is not
   proof that beta is healthy, and beta is not proof that production was
   manually promoted. Include production only when that manual promotion was
   explicitly started. Re-read the merged PR for new review or bot feedback;
   fix actionable post-merge feedback on the fresh branch and invoke `/ship`
   for the follow-up.

8. If a post-merge CI, beta deploy, package-publish, release, or explicitly
   promoted production issue appears:

   - reproduce or read the failing artifact;
   - fix it on the fresh branch, never on the merged branch;
   - run the smallest meaningful local check, then `pnpm prep` when the change
     warrants it;
   - invoke `/ship` for the follow-up so its normal review, merge, and
     post-release gates apply.

   If no post-merge issue appears, report the PR, merge commit, fresh branch,
   release checks, and the monitoring window honestly.

## Safety rules

- Never expose environment values, tokens, cookies, or private payloads in
  commits, PR text, logs, prompts, or status reports.
- Publish all nonignored local paths through `corepack pnpm ship:push`.
- Never silently skip a review comment, CI failure, package release failure,
  or production deploy failure.
- Never treat a Netlify lock as the production promotion mechanism or remove it
  manually to force a promotion.
- Never create a fresh branch before verifying that `origin/main` contains the
  merge commit.
- Never claim the fast path is complete from a successful merge command alone;
  verify the merge, branch rotation, and post-merge release state.

## Related skills

- `/ship` for the normal guarded ship flow and follow-up fixes.
- `/ship-and-monitor` for the normal guarded ship flow plus this post-merge
  monitoring behavior without the fast admin-merge exception.
- `/babysit-pr` for review/comment/CI coverage before a merge when the user did
  not explicitly choose this fast path.
- `/new-branch` for the only permitted branch-rotation procedure.
