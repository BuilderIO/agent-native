---
name: ship
description: >-
  Commit and push all local current-branch work, open a ready PR, babysit it,
  merge when clean, then create a fresh branch. Use when the user asks to ship,
  publish, or hand off the current branch's local changes.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship

Ship the current branch end-to-end: commit and push all local work, open a
ready PR, run `/babysit-pr`, merge when the babysit merge gates are satisfied,
then run `/new-branch` after the merge lands.

## Non-Negotiable Shipping Invariant

`/ship` ships the **branch**, not just the agent's own edits. Commit and push
all non-gitignored local changes that are present on the current branch,
including work created by the user or other concurrent agents. Do not leave
local changes behind because you did not author them. The only routine
exceptions are `learnings.md` and ignored/personal files.

Invoking `/ship` is explicit authorization to merge this PR once the merge gates
below pass, unless the user says not to merge. Do not ask again just to merge a
clean PR. Do not stop after creating the PR; the default `/ship` outcome is a
merged PR and a fresh post-merge branch.

## Push-All Default

Treat these requests as an immediate full-tree publish command: `/ship`,
"ship our latest local changes", "push up the local changes", or "push all
local changed files". Start with `git status --short`, then stage the complete
current non-ignored worktree and commit/push it before any long test, prep run,
review wait, or cleanup. Do not make the user ask twice. The first remote
checkpoint is the priority because local files cannot receive CI or AI review.

Use leases to avoid editing over a peer, not to hold the branch back. A live
lease is not a reason to omit its current file from an explicitly requested
push-all pass: re-read the file, stage its whole current contents, and publish
that snapshot. Never stage partial hunks. If the file-lease hook rejects a
specific path, or the path changes during the snapshot, unstage only that path,
push every other non-ignored path immediately, and report the exact blocker.
Do not hold generated mirrors, reference files, docs, or unrelated stable paths
because one peer-owned file is active. `learnings.md`, ignored/personal files,
private/generated `bridge/**`, and local `data/**` artifacts remain the only
routine exclusions.

When concurrent work is active, `/ship` is incremental. Once the ready PR
exists, do not wait for full prep, every peer to finish, or the final merge
soak before publishing the next complete safe slice. Review availability is a
first-class shipping goal: a complete remote checkpoint is more useful than a
locally complete branch that no reviewer or review agent can see. Batch changes
for at most two minutes or one focused slice, then inspect the worktree and
immediately commit and push every branch-owned path. A live lease does not
change that default; it only means do not edit the file while preparing the
snapshot. Open or update the same PR so CI and review agents see each slice in
parallel. Never stage a partial hunk or private/generated `bridge/**` or local
`data/**` artifact. A dirty worktree is expected during this phase and is not a
reason to hold a push - clean working tree is a merge gate, not a push gate.
If the hook blocks one path, state that exact path and push the rest; do not
wait for the whole branch to settle.
This cadence does not relax the final `pnpm run prep`, review, or clean
merge-soak gates.

## Review-First Push Bias

Push the first complete safe slice before starting any validation that may take
more than a minute. Then keep pushing stable slices while long tests, CI, and
AI review run in parallel. Do not hold unrelated local work for a peer's active
file, a generated mirror whose source is still in flight, a failing local prep,
or a desire to make one large polished commit. If a non-leased file looks
uncertain, inspect its diff and run a focused check; if it is coherent, commit
it separately and push it. The default response to "there are local changes"
is to find the next reviewable slice and publish it, not to wait for a clean
worktree.

If the branch updates templates or publishable packages, shipping does not stop
at merge. Treat the work as shipped only after the affected templates are live in
production and affected packages have successfully published/released. If a
production template deploy or package publish fails, retrigger the failed job
when the existing code already contains the fix; otherwise make the necessary
code/config fix and ship that follow-up until production is live.

## Steps

1. **Stay on the current branch**: never create, switch, rebase, reset, or stash
   before opening the PR. This repo uses shared/platform-managed branches; ship
   the branch you are already on.

2. **Check local changes**: run `git status --short` and `git diff --stat` to
   understand all modified/untracked files. Multiple agents may have added work;
   include all non-gitignored local files in shipment instead of stashing,
   skipping, or reverting them.

3. **Validate enough to avoid obvious breakage**: run focused tests for the
   changed area. Push the first safe slice before running `pnpm run prep` or
   another long validation. Run prep when it is practical, but if prep is slow,
   flaky, or contaminated by concurrent in-flight edits, do not stall shipment:
   record the exact failure, keep pushing stable slices, and let GitHub Actions
   be the validation gate that `/babysit-pr` monitors.

4. **Stage and commit the complete current snapshot**: stage every current
   non-ignored, branch-owned changed/untracked path, including generated
   mirrors and files with live leases. Exclude only `learnings.md`, ignored or
   personal files, private/generated `bridge/**`, and local `data/**` database
   or asset artifacts. A lease does not authorize leaving a path behind. Use
   the lease only to avoid making edits; stage the whole current file, never a
   partial hunk. If the hook rejects one path or it changes during staging,
   unstage only that path, commit/push every other path, and name the exact
   blocker. Write a concise, descriptive commit message based on the actual
   diff. Never add `Co-Authored-By` or other agent attribution.

5. **Push**: push the current branch. If the branch has no upstream, set it with
   `git push -u origin <branch>`.

   The first successful push is the review handoff point: open or update the
   ready PR immediately, before waiting on `pnpm prep`, a stability window, or
   additional concurrent work. Later commits update that same PR and let CI
   and review run in parallel with the rest of the ship workflow. Push every
   later safe slice as soon as it is coherent; do not wait for all local files
   to become commit-ready at once.

6. **Open or update a ready PR immediately after the first push**: use the
   current branch. PRs are ready for review by default, not drafts. Do not put
   `codex`, `[codex]`, or similar agent labels in the title/body.

   For every later safe slice, update this same PR immediately after pushing;
   do not create a second PR or wait for prep to finish before handing the
   slice to CI and review.

7. **Babysit immediately**: run `/babysit-pr <number>` and follow that skill’s
   tick loop exactly. Treat `babysit-pr` as the source of truth for how to watch
   the PR; do not duplicate, shorten, or invent a lighter monitoring loop. Its
   Step 0 is authoritative: every tick starts by committing and pushing all local
   files and any unpushed commits, then checking mergeability, every unaddressed
   review comment by reply state, and CI. Keep going until the PR is either
   merged/closed or the user explicitly tells you to stop.

8. **Merge when allowed**: because `/ship` includes merge authorization, merge
   with `gh pr merge <number> --squash --admin` only after `/babysit-pr`’s merge
   requirements are simultaneously true for 10 consecutive minutes:
   clean working tree, no unpushed commits, GitHub Actions green, all review
   comments addressed/replied, and mergeable.

9. **Verify production is live when needed**: if the branch changed
   `templates/*`, docs/sites that publish templates, or any deployment config
   that affects templates, verify the affected template production deploys finish
   successfully and the live site is serving the new build. If a deploy fails
   because of a transient infra/build pickup issue, retrigger it; if it fails
   because of code, config, dependency, or generated-file problems, fix the
   issue and ship the follow-up. If the branch changed publishable packages such
   as `packages/core`, `packages/dispatch`, `packages/scheduling`,
   `packages/pinpoint`, or `packages/skills`, verify the release/publish
   workflow completes and the package version is available from the registry or
   package host. Retrigger transient publish failures; fix and ship code/config
   failures.

10. **Create the next branch after merge**: after the PR is merged and `origin/main`
   contains the merge commit, run `/new-branch`. Follow that skill’s preflight,
   stash gate, branch naming, and stash-reporting rules. This is the only branch
   movement in the ship flow.

11. **Report**: summarize the PR URL, merge result, new branch name, validation,
    production deploy/publish verification when applicable, and any feedback/CI
    fixes handled.

## Important

- **Multiple agents run concurrently.** There will often be locally changed
  files you didn't generate. This is normal. Include everything and move
  forward. Don't revert other agents' work; fix real bugs if CI or review
  feedback flags them.
- Never commit `learnings.md` or files in `.gitignore`.
- If feedback appears in inline comments or review bodies, every item needs a
  fix or a reply before merge.
- Treat `/babysit-pr` as the source of truth for CI/review monitoring cadence,
  comment handling, local-file push discipline, and merge gates. Update
  `babysit-pr` first if the watcher behavior changes.
- Treat production deploy/publish verification as part of `/ship` whenever
  templates or publishable packages changed. A green PR is not enough if the
  affected template build or package publish later fails.
- Treat `/new-branch` as mandatory after a successful merge so the workspace is
  ready for the next task on fresh `main`.
