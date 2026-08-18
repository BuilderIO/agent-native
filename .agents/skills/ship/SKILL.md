---
name: ship
description: Commit and push all local current-branch work, open a ready PR, babysit it, merge when clean, then create a fresh branch
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

If the branch updates templates or publishable packages, shipping does not stop
at merge. Treat the work as shipped only after the affected templates are live in
production and affected packages have successfully published/released. If a
production template deploy or package publish fails, retrigger the failed job
when the existing code already contains the fix; otherwise make the necessary
code/config fix and ship that follow-up until production is live.

## Latest-feedback handoff

When `/review-latest-feedback` has run before `/ship`, its sweep is a required
ship input. Carry the sweep's start cursor, grouped reports, evidence links, and
disposition table into the PR or ship recap. Every actionable item must have an
owning source seam and focused verification, with one explicit disposition:
fixed, awaiting reporter clarification, already owned or duplicate, deferred or
informational, external or non-repo-owned, or unavailable/unverified.

Do not ship a feedback fix that is only a wording-specific rule or that lacks
the evidence needed to identify its owner. Re-run or refresh the feedback sweep
when the branch changes after triage or when new comments, Slack replies,
GitHub review comments, or Sentry findings arrive. Treat an unavailable
connector as unavailable - never as “nothing matched” - and preserve that gap
in the recap.

The ship report and PR description must keep source-tested, built, published or
deployed, and observed-live claims separate. A green test or PR does not prove
that a feedback fix is live; verify the affected production surface after merge.
Before merging, `/babysit-pr` must re-check that every actionable feedback or
review item has a fix or a concise reply and that no new evidence has been left
without a disposition.

## Worktree and base setup

A detached HEAD is a valid shipping context. Codex and platform-managed
worktrees may intentionally start detached, and `/ship` authorizes creating a
shipping branch in that worktree before committing or pushing. Do not stop or
ask for confirmation just because `git branch --show-current` is empty.

If this worktree is detached:

1. Inspect `git worktree list --porcelain` and existing `changes-*` refs.
2. Create an unused `changes-N` branch (N at least 50) at the current HEAD in
   this worktree. Never attach or switch a branch checked out by another
   worktree, use `main`, overwrite an existing ref, or move another worktree.
3. Continue the normal ship flow on that new branch.

Before committing or pushing, fetch `origin/main` and check that the shipping
base is current. If the worktree is behind, reapply the logical local changes
onto current `origin/main`; do not ship a stale snapshot that can revert work
landed since this worktree was created. Never reset, rebase, stash, or
force-push to accomplish this.

## Steps

1. **Stay in the current worktree and branch**: if already on a named branch,
   never create, switch, rebase, reset, or stash before opening the PR. If the
   worktree is detached, follow the Worktree and base setup section and create
   the shipping branch before opening the PR. This repo uses
   shared/platform-managed worktrees; ship the branch belonging to this
   worktree.

2. **Check local changes**: run `git status --short` and `git diff --stat` to
   understand all modified/untracked files. Multiple agents may have added work;
   include all non-gitignored local files in shipment instead of stashing,
   skipping, or reverting them. Then run `git fetch origin main --quiet` and
   `git rev-list --count HEAD..origin/main`; a non-zero result requires
   reapplying the logical work onto current `origin/main` before pushing.

3. **Validate enough to avoid obvious breakage**: run focused tests for the
   changed area. Run `pnpm run prep` when it is practical. If prep is slow,
   flaky, or contaminated by concurrent in-flight edits, do not stall shipment:
   push and let GitHub Actions be the validation gate that `/babysit-pr`
   monitors.

4. **Stage and commit**: stage all changed/untracked files except `learnings.md`
   or gitignored personal files. Write a concise, descriptive commit message
   based on the actual diff. Never add `Co-Authored-By` or other agent
   attribution.

5. **Push**: push the current branch. If the branch has no upstream, set it with
   `git push -u origin <branch>`.

6. **Open or update a ready PR**: use the current branch. PRs are ready for
   review by default, not drafts. Do not put `codex`, `[codex]`, or similar
   agent labels in the title/body.

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
