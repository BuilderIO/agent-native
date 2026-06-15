---
name: ship
description: Commit and push all local current-branch work, open a ready PR, babysit it, merge when clean, then create a fresh branch
user-invocable: true
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

## Steps

1. **Stay on the current branch**: never create, switch, rebase, reset, or stash
   before opening the PR. This repo uses shared/platform-managed branches; ship
   the branch you are already on.

2. **Check local changes**: run `git status --short` and `git diff --stat` to
   understand all modified/untracked files. Multiple agents may have added work;
   include all non-gitignored local files in shipment instead of stashing,
   skipping, or reverting them.

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

9. **Create the next branch after merge**: after the PR is merged and `origin/main`
   contains the merge commit, run `/new-branch`. Follow that skill’s preflight,
   stash gate, branch naming, and stash-reporting rules. This is the only branch
   movement in the ship flow.

10. **Report**: summarize the PR URL, merge result, new branch name, validation,
    and any feedback/CI fixes handled.

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
- Treat `/new-branch` as mandatory after a successful merge so the workspace is
  ready for the next task on fresh `main`.
