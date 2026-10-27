---
name: ship-now
description: >-
  Fast-path the current branch to main: local `pnpm prep:urgent`, push, and an
  immediate admin merge without waiting for remote CI or the 10-minute gate.
  Use only when the user explicitly asks to merge immediately.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship Now

The fast version of `/ship`. Local `pnpm prep:urgent` replaces the remote CI
wait and the 10-minute unchanged-head gate, then you admin-merge right away.
Everything else comes from `ship`: ownership, preflight, the ready PR, and
`--match-head-commit`. The explicit `/ship-now` request authorizes the merge
for your own PR. For anyone else's PR, `ship`'s ownership rules apply.

## Steps

1. Preflight as in `ship`. Find the PR:

   ```bash
   gh pr list --head "$(git branch --show-current)" --state open --json number,url,author
   ```

2. Read every review summary and top-level inline comment (use
   `babysit-pr`'s two queries). Fix real issues, reply on each thread you
   fixed or declined, and rerun the queries after every push, since a new bot
   review is a new round.

3. Run the local gate:

   ```bash
   pnpm prep:urgent
   ```

   It uses `--kill-others-on-fail`, so a lane killed by a sibling's failure is
   unknown, not green. Fix the failure and rerun only the narrow check for each
   failed or unknown lane: that package's typecheck, the specific Vitest file,
   the named guard, or `pnpm exec oxfmt --check <files>`. Rerun the full
   command only when the fix crosses several lanes. When you report, say prep
   recovered through targeted checks if it did. Don't say the whole command
   passed when it didn't.

4. Push everything in one update. `ship:push` stages every publishable path,
   so first check `git status`: if a dirty path isn't part of this task, stop
   and leave it alone.

   ```bash
   corepack pnpm ship:push -m "<subject naming the actual change>"
   ```

   For an existing PR whose head isn't this branch on `origin`, push to the
   verified head repo and ref as `babysit-pr` describes. Don't open a second
   PR.

5. Merge immediately when the tree is clean and pushed, every review item is
   fixed or answered with a reply that was actually posted, and the PR isn't
   `CONFLICTING`. A reply you could only draft (someone else's PR, no comment
   permission) blocks the merge. Re-read the live PR as in `babysit-pr` step 1
   (open, base `main`, author is you) and its `headRefOid`. It must equal
   `git rev-parse HEAD`, the head you validated and pushed. If it doesn't,
   someone pushed: redo steps 2-4. When they match, write it as
   `ship_merge_head_oid` and run:

   ```bash
   gh pr merge <number> --squash --admin --match-head-commit <head-oid>
   ```

   If the head moved, someone pushed. Redo steps 2-4 for the new head before
   you merge it. Don't wait for remote CI or release checks.

6. Fetch `origin/main` and confirm the merge commit is in it, then rotate with
   `/new-branch`'s post-merge step.

## After the merge

If the PR body has a `Reports` section, run `/review-latest-feedback` step 5
for those threads. Beta, docs, and release checks happen only when the user
asks or a concrete risk calls for them, as `ship-and-monitor` describes.
Merging publishes beta automatically. Fix any later CI or deploy failure on
the fresh branch and send it through `/ship`.
