---
name: ship
description: >-
  Commit and push all nonignored current-branch work, open a ready PR, babysit
  it, merge when clean, then create a fresh branch. Use when the user asks to
  ship, publish, or hand off local changes.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship

Ship all nonignored work on the current branch end-to-end: commit and push the
branch snapshot, open or update a ready PR, run `/babysit-pr`, merge when its
normal gates are satisfied, then run `/new-branch` after the merge lands.

`/ship` includes all nonignored local changes on the current branch. Keep the
routine exclusions out of the shipment: `learnings.md`, `bridge/**`, and
`data/**`. Re-check the branch snapshot before every commit and push.

## Non-Negotiable Shipping Invariant

`/ship` ships the complete nonignored **current-branch snapshot**. At the start
of the flow, record the status and diff baseline. If the branch changes while
the flow is running, publish the new snapshot to the same PR rather than
creating a second PR. Never reset, rebase, force-push, or silently discard
local work.

Invoking `/ship` is explicit authorization to merge this PR once the merge gates
below pass, unless the user says not to merge. Do not ask again just to merge a
clean PR. Do not stop after creating the PR; the default `/ship` outcome is a
merged PR and a fresh post-merge branch.

## Whole-Branch Push

Use the repository checkpoint for the complete current-branch snapshot:

```bash
corepack pnpm ship:push
```

It stages all nonignored paths, excludes `learnings.md`, `bridge/**`, and
`data/**`, commits without agent attribution, pushes the current branch, and
verifies the remote SHA. Push the first snapshot before long validation, then
push later branch snapshots to the same PR as they become coherent.

If the branch updates templates or publishable packages, shipping does not stop
at merge. Treat the work as shipped only after the affected templates are live in
production and affected packages have successfully published/released. If a
production template deploy or package publish fails, retrigger the failed job
when the existing code already contains the fix; otherwise make the necessary
code/config fix and ship that follow-up until production is live.

## Worktree and branch setup

A detached HEAD is a valid shipping context. Codex and platform-managed
worktrees may intentionally start detached, and `/ship` explicitly authorizes
creating a shipping branch in that worktree before committing or pushing. Do
not stop or ask for confirmation just because `git branch --show-current` is
empty.

If this worktree is detached:

1. Inspect `git worktree list --porcelain` and existing `changes-*` refs.
2. Create an unused `changes-N` branch (N at least 50) at the current HEAD in
   this worktree, for example `git switch -c changes-N`. Never attach or switch
   a branch that is checked out by another worktree, use `main`, overwrite an
   existing ref, or move another worktree.
3. Continue the normal ship flow on that new branch.

This is the one pre-PR branch operation that `/ship` authorizes for a detached
worktree. Do not reset, rebase, stash, or force-push. If already on a named
branch, stay on it.

## Steps

1. **Stay in the current worktree and branch**: if already on a named branch,
   never create, switch, rebase, reset, or stash before opening the PR. If the
   worktree is detached, follow the Worktree and branch setup section and
   create the shipping branch before opening the PR. This repo uses
   shared/platform-managed worktrees; ship the branch belonging to this
   worktree.

2. **Check local changes**: run `git status --short` and `git diff --stat` to
   establish the owned-path baseline. Multiple agents may have added work;
   preserve those paths, but do not stage or push them automatically. If you
   cannot establish ownership, leave the path out of this ship.

   Then confirm the base is current, before validating or pushing anything. A
   worktree can be created from a stale ref, and its local `main` ref is stale
   too, so `git log main..HEAD` comes back empty and the branch reports itself
   current while being weeks behind. The fetch is required: without it the
   count reads a stale remote ref and returns 0, which is the same
   confidently-wrong clean answer this check exists to catch.

   ```bash
   git fetch origin main --quiet
   git rev-list --count HEAD..origin/main
   ```

   Non-zero means reapply the work onto current `origin/main` before pushing —
   shipping from a stale base conflicts with or reverts whatever landed in the
   gap. Measured 2026-08-18: four live Codex worktrees sat 1,144 commits behind
   `origin/main` while reporting themselves clean from the inside.

3. **Validate enough to avoid obvious breakage**: run focused tests for the
   changed area. Push the first safe slice before running `pnpm run prep` or
   another long validation. Run prep when it is practical, but if prep is slow,
   flaky, or contaminated by concurrent in-flight edits, do not stall shipment:
   record the exact failure, keep pushing stable slices, and let GitHub Actions
   be the validation gate that `/babysit-pr` monitors.

4. **Publish the owned snapshot**: stage only the paths owned by this agent,
   commit, and push the current branch. Never add `Co-Authored-By` or other
   agent attribution.

   The first successful push is the review handoff point: open or update the
   ready PR immediately, before waiting on `pnpm prep`, a stability window, or
   additional concurrent work. Later commits update that same PR and let CI
   and review run in parallel with the rest of the ship workflow. Push each
   later owned slice as soon as it is coherent; do not wait for peer files to
   become commit-ready, and do not include them in an owned slice.

5. **Open or update a ready PR immediately after the first push**: use the
   current branch. PRs are ready for review by default, not drafts. Do not put
   `codex`, `[codex]`, or similar agent labels in the title/body.

   For every later safe slice, update this same PR immediately after pushing;
   do not create a second PR or wait for prep to finish before handing the
   slice to CI and review.

6. **Babysit immediately**: run `/babysit-pr <number>` and follow that skill’s
   tick loop exactly. Treat `babysit-pr` as the source of truth for how to watch
   the PR. Its Step 0 checks ownership first, pushes only owned paths and
   already-created owned commits, then checks mergeability, every unaddressed
   review comment by reply state, and CI. Keep going until the PR is either
   merged/closed or the user explicitly tells you to stop.

7. **Merge when allowed**: because `/ship` includes merge authorization, merge
   with `gh pr merge <number> --squash --admin` only after `/babysit-pr`’s merge
   requirements are simultaneously true for 10 consecutive minutes:
   clean working tree, no unpushed commits, GitHub Actions green, all review
   comments addressed/replied, and mergeable.

8. **Verify production is live when needed**: if the branch changed
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

9. **Create the next branch after merge**: after the PR is merged and `origin/main`
   contains the merge commit, run `/new-branch`. Follow that skill’s preflight,
   stash gate, branch naming, and stash-reporting rules. This is the only branch
   movement in the ship flow.

10. **Report**: summarize the PR URL, merge result, new branch name, validation,
    production deploy/publish verification when applicable, and any feedback/CI
    fixes handled.

## Important

- **Multiple agents run concurrently.** There will often be locally changed
  files you didn't generate. This is normal. Preserve those paths and move
  forward with explicit owned-path commits. Don't revert other agents' work or
  publish it as part of this ship; fix real bugs if CI or review feedback flags
  them.
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
