---
name: ship-now
description: >-
  Fast-path the current branch through local prep, feedback resolution,
  whole-branch push, admin merge, and fresh-branch rotation. Use when the user
  explicitly wants to merge immediately after pnpm prep passes, then monitor
  the merged PR and release workflows and ship any follow-up fixes normally.
---

# Ship Now

Use this only after the user explicitly requests the fast admin-merge path.
It is an intentional exception to `/ship`'s ten-minute merge soak: local
`pnpm prep` is the required validation gate, and the user has authorized
`--admin` merging once feedback is handled.

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
   force-push, clean, or overwrite peer work. Treat every non-ignored local
   change as part of the branch shipment, as `/ship` requires.

2. Resolve review state before merging. Read every current human and bot
   review summary and every top-level inline comment across all pages. Fix
   real issues on the current branch and reply to each addressed or declined
   comment. Recheck reply coverage after every push; a new bot review is a new
   round. Do not merge with unaddressed feedback.

3. Run the local gate:

   ```bash
   pnpm prep
   ```

   Treat a non-zero, skipped, or inconclusive prep result as a failure to
   classify, not as a reason to repeat the entire suite automatically. Fix the
   root cause and rerun the narrowest meaningful check for the failed lane:

   - a package typecheck failure: that package's typecheck, for example
     `pnpm --filter @agent-native/desktop-app typecheck`;
   - a test failure: the specific Vitest file or test command;
   - a guard failure: the named guard command;
   - formatting: `pnpm exec oxfmt --check <changed-files>`.

   Keep the successful lanes from the original prep run, and run a full
   `pnpm prep` again only when the fix crosses several validation boundaries or
   the failure cannot be isolated. For a file-scoped type failure, a green
   package typecheck is the recovery gate; for a test failure, a green targeted
   test is the recovery gate. Record that prep recovered through targeted
   checks - do not claim the entire `pnpm prep` command itself exited 0 when it
   did not. Preserve exact unrelated peer-check or environment failures rather
   than calling them green.

4. Publish the whole current branch immediately after prep passes:

   ```bash
   pnpm ship:push
   ```

   Verify the push landed on the current branch and update the existing ready
   PR. Do not create a second PR. Recheck the PR's mergeability, current review
   comment reply coverage, and the latest prep result after the push.

5. Admin-merge immediately when the explicit fast-path gates are true:

   - local `pnpm prep` passed, or every failed prep lane was fixed and its
     narrow recovery check passed as described above;
   - the current branch has no unpushed commits;
   - every review item has a fix or an explicit reply;
   - the PR is not conflicting; and
   - the user has explicitly authorized this `/ship-now` invocation.

   Use the current PR number and no force push:

   ```bash
   gh pr merge <number> --squash --admin
   ```

   Do not wait for the normal `/ship` soak or pretend that a queued merge is
   complete. Read the merge result, fetch `origin/main`, and verify the merge
   commit is present before rotating branches.

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
   - invoke `/ship` for the follow-up so its normal babysit, review, merge, and
     post-release gates apply.

   If no post-merge issue appears, report the PR, merge commit, fresh branch,
   release checks, and the monitoring window honestly.

## Safety rules

- Never expose environment values, tokens, cookies, or private payloads in
  commits, PR text, logs, prompts, or status reports.
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
