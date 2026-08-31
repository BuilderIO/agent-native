---
name: ship
description: >-
  Commit and push the complete current-branch snapshot, open a ready PR,
  babysit it, merge when clean, merge safe Dependabot updates encountered in
  the queue, then create a fresh branch. Use when the user asks to ship,
  publish, or hand off local changes. GitHub Actions auto-deploys beta and the
  docs site through the prebuilt publisher; other production promotion is
  manual.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship

Ship the complete nonignored current-branch snapshot end-to-end: commit and
push it, open or update a ready PR, run `/babysit-pr`, merge when its normal
gates are satisfied, then run `/new-branch` after the merge lands.

`/ship` means all nonignored local changes belonging to the requested work on
the current branch. The shared checkout is the source of truth, but unrelated
or incomplete concurrent work stays with its owner and is not part of this PR
snapshot. The checkpoint helper excludes `learnings.md`, `bridge/**`, and
`data/**`.

## Non-Negotiable Shipping Invariant

`/ship` ships the complete nonignored snapshot of the requested work, not a
hand-selected subset of that work. At the start of the flow, record the status
and every unpushed commit, then verify that every candidate path and commit
belongs to the requested fix before invoking the checkpoint helper. If the
checkout mixes unrelated or incomplete concurrent work, do not run the helper:
preserve those paths for their owner and report them instead. Apply the same
ownership check before every later actionable push. Never revert, stash, or
overwrite concurrent work.

Invoking `/ship` is explicit authorization to merge this PR once the merge gates
below pass, unless the user says not to merge. Do not ask again just to merge a
clean PR. Do not stop after creating the PR; the default `/ship` outcome is a
merged PR and a fresh post-merge branch.

## Merge policy

The purpose of `/ship` is to land the PR. A branch being behind `origin/main`
is observational only; it never triggers a merge, rebase, or maintenance
commit. Check GitHub's live `mergeable` state before updating from `main`, and
merge `origin/main` only when GitHub reports `CONFLICTING` or a local merge
proves a real conflict. After conflict recovery, wait for the new checks and
do not repeat the merge while the PR is conflict-free or checks are pending.
Never enable GitHub auto-merge; use the explicit admin merge below once the
gates pass.

When a ship run also reviews the open PR queue, it may merge a non-draft PR
authored by the exact Dependabot bot login when the `review-prs` Dependabot
merge exception passes. That exception is limited to patch/minor,
dependency-only manifest/lockfile updates with clean mergeability, all
required checks successful, no active review blocker, no ultra-scary security,
data, or deployment risk, and no minor update for a major-version-0
dependency. Satisfy any required approving review, then bind the normal
protected merge to the expected head SHA with `--match-head-commit <sha>`; do
not use an admin bypass. Any required approval must come from a verified
BuilderIO human member who is not the PR author or a bot. Verify the
approver's GitHub user type is `User` and
`gh api orgs/BuilderIO/members/<login>` succeeds. This queue exception may
skip the current branch's `/babysit-pr` soak, but it does not skip branch
protection. Do not auto-merge other external PRs.

## Branch-wide Push

A worktree is a valid publishing checkout. When `/ship` is authorized from a
worktree, use that worktree's current branch and cwd for validation, commit,
push, and PR creation or update. Do not copy its changes into the shared
checkout; update the existing PR and do not create a second one.

```bash
corepack pnpm ship:push
```

The helper stages and commits the complete nonignored snapshot, excluding
`learnings.md`, `bridge/**`, and `data/**`. Verify the push landed on the current
branch and read the remote sha back.

Treat these as an immediate call to it: `/ship`, "ship our latest local
changes", or "push up my local changes". Push the first coherent branch
snapshot before long validation so CI and review can start. After that first
handoff, publish a later snapshot only when it contains an actionable change
required by failing CI, PR feedback, a real merge conflict, or an explicit user
request. Do not run `ship:push` on a clean or merely behind branch, and do not
create a maintenance or `chore: publish branch work` commit just to refresh
`main`, restart checks, or satisfy a babysit tick.

## Deployment split

Merges to `main` trigger `.github/workflows/deploy-beta-sites-prebuilt.yml`,
which builds in GitHub Actions and uploads prebuilt artifacts to the independent
Netlify beta sites at `beta.*.agent-native.com`. Netlify Git-connected
auto-builds are disabled, so do not wait for Netlify build queues or
deploy-preview checks; verify the Actions run and its per-site smoke checks.
Production promotion is a separate manual operation for other production
sites. The normal `/ship` flow does not wait for or verify post-merge beta
deployment; use `/ship-and-monitor` to verify beta, the docs production lane,
and the release tail. The public docs site is the temporary exception:
matching `main` changes trigger `.github/workflows/deploy-docs-production.yml`,
which publishes `www.agent-native.com` from the exact commit and disables that
site's Git-connected Netlify builds. There is no beta docs site today. The
normal `/ship` flow must not imply an automatic production deploy for other
sites. Critical fixes that must reach other production sites need an explicit
manual promotion, followed by
`/ship-and-monitor` when the promotion and release tail need verification.

Use `.github/workflows/deploy-production-sites-prebuilt.yml` or the targeted
`promote-netlify-deploy.yml` workflow to promote a critical fix and let it
manage Netlify lock transitions. Do not manually remove or clear a Netlify lock
as a deployment step; clearing one is not the production promotion.

## Latest-feedback handoff

When `/review-latest-feedback` has run before `/ship`, its sweep is a required
ship input. Carry the sweep's start cursor, grouped reports, evidence links, and
disposition table into the PR or ship recap. The handoff remains cross-app and
cross-source: adding Design UI bugs to the eligible set must not drop
Analytics, Dispatch, Calendar, Slides, Content, GitHub, Sentry, or any other
previously identified candidate. Every actionable item must have an owning
source seam and focused verification, with one explicit disposition: fixed,
awaiting reporter clarification, already owned or duplicate, deferred or
informational, external or non-repo-owned, or unavailable/unverified.

The handoff must preserve the feedback workflow's automation disclosure:
every Slack reply it posts ends with `sent from ChatGPT - automated review.`
After every Slack reply, re-read the complete thread through its current end
before continuing. If anyone replies to that message, treat it as new evidence,
re-investigate, make and verify any needed fix, post another disclosed update,
and repeat the read-back. Before treating the sweep as fully wrapped, audit
every replied-to thread until no unprocessed follow-up remains. Do not merge
while this reply follow-up pass is incomplete.

Honor the feedback ownership and reaction gates from `/review-latest-feedback`:

- Never add or duplicate `👀` on a Slack parent. If the latest readable parent
  already has an `👀` reaction from anyone, preserve that fact as an existing
  investigation marker, but do not treat it as a disposition or suppression
  signal. After classifying the parent, re-read the complete thread and, for
  an actionable in-scope item, require a verified disposition from the
  invoking Slack identity - **Fixed**, **In progress**, or **Clarification
  needed**; an eye-only or stale eye-only item remains actionable for that
  handoff check. For items
  routed to Sid or Alice, or classified as external, duplicate, deferred, or
  informational, honor that owning disposition and do not turn the eye into a
  merge blocker. If the reaction state is unavailable, record the item as
  unavailable/unverified and refresh the feedback thread instead of guessing.
- Design feedback, including small UI or interaction bugs, Design clips, and
  imported-design usability, routes to Sid unless the user separately assigns
  a concrete Design fix. Do not add eyes, investigate, reply, or include it as
  this workflow's work. All Content app feedback remains owned by Alice; keep
  those source links and ownership decisions in the ship ledger, but do not
  include them as this workflow's fixes, investigation, clarification
  requests, replies, dispatches, or merge blockers.

If a prior run mistakenly added an eye to an out-of-scope or already-owned
parent, remove it with the connected Slack action when available. Do not add a
new reply or reaction. If removal is unavailable, record the exact parent for
manual cleanup and keep it out of the ship ledger's actionable work.

When deciding whether an awaiting clarification is already answered, treat the
requested URL, error, screenshot, repro, run ID, or other evidence as present
only when it is readable in the parent, a reply, or an accessible linked
artifact. Keep a linked artifact that is present but inaccessible because of
permissions, expiry, connector gaps, or another read failure separate from
evidence that is absent. If that artifact is required to identify or verify
the change, route the item back through the feedback workflow for a targeted
request for access or a fresh/replacement link; do not suppress that request or
ask again for contents already known to be in the inaccessible artifact. If the
available evidence is enough without it, continue and record the limitation as
unavailable/unverified in the ship ledger.

Before carrying any item forward from a prior handoff - fixed, in progress,
awaiting clarification, already owned or duplicate, deferred or informational,
external, or unavailable/unverified - always re-read the complete source thread
and current handoff and reconcile them for new replies, reactions, linked
evidence, resolution, or ownership signals. The handoff is a prior record, not
the source of truth. After that refresh, if
the invoking Slack identity, a legacy `@agent-native` message, or another
participant already supplied the needed details,
identified the cause, linked a fix, or said the issue is fixed, landed, or being
fixed, do not reopen it as a clarification request or ask for duplicate
information. Carry it as fixed pending verification, already owned, or in
progress, and verify or follow up on that existing work. Only preserve an
awaiting-clarification disposition when one specific reporter or product input
is still missing after that check. Any eventual reporter-facing clarification
must thank the person first and ask the question second; `Clarification needed`
is an internal state, not an opening line.

There may be only one unanswered clarification request per feedback thread. If
the existing handoff or complete source thread contains a question from this
workflow or `@agent-native`, re-read both and determine whether the exact
requested detail has been semantically answered or explicitly resolved anywhere
in the thread. A partial or unrelated reply does not clear the request. If it
remains unresolved, carry its timestamp forward as the sole pending request and
do not add another question. Once it is answered or resolved, re-read the
thread and try the fix first; ask one new question only for one specific,
non-repeating detail that still blocks the fix.

Do not ship a feedback fix that is only a wording-specific rule or that lacks
the evidence needed to identify its owner. Re-run or refresh the feedback sweep
when the branch changes after triage or when new comments, Slack replies,
GitHub review comments, or Sentry findings arrive. Treat an unavailable
connector as unavailable - never as “nothing matched” - and preserve that gap
in the recap.

The ship report and PR description must keep source-tested, built, and merged
claims separate. A green test or PR does not prove that beta or production is
live; deployment monitoring belongs to `/ship-now` or `/ship-and-monitor`.
Before merging, `/babysit-pr` must re-check that every actionable feedback or
review item has a fix or a concise reply and that no new evidence has been left
without a disposition. Items routed to Sid or Alice remain outside this
workflow's ownership. External, duplicate, deferred, and informational items
also follow their recorded disposition rather than blocking this workflow. A
parent marked with `👀` is not thereby complete or non-actionable: preserve the
reaction without duplicating it, and for actionable in-scope items do not merge
while an eye-only or stale eye-only item lacks a verified disposition from the
invoking Slack identity.

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

2. **Check local changes**: run `git status --short` and `git diff --stat`,
   then inspect the current branch's unpublished commits. Use the
   branch-specific remote ref when it exists; otherwise use the first-push
   fallback:

   ```bash
   if ! git fetch origin --quiet; then
     echo "Cannot refresh origin refs; stop before checking unpublished commits." >&2
     exit 1
   fi
   if git show-ref --verify --quiet "refs/remotes/origin/$(git branch --show-current)"; then
     git log --oneline --decorate "origin/$(git branch --show-current)"..HEAD -- . ':(exclude)learnings.md' ':(exclude)bridge/**' ':(exclude)data/**'
   else
     git log --oneline --decorate HEAD --not --remotes=origin -- . ':(exclude)learnings.md' ':(exclude)bridge/**' ':(exclude)data/**'
   fi
   ```

   This works even before the first push, when `origin/<branch>` does not
   exist. Multiple agents may have added work; include a path or unpushed
   commit only after confirming it belongs to this requested fix.

   Then confirm the base is current, before validating or pushing anything. A
   worktree can be created from a stale ref, and its local `main` ref is stale
   too, so `git log main..HEAD` comes back empty and the branch reports itself
   current while being weeks behind. The fetch is required: without it the
   count reads a stale remote ref and returns 0, which is the same
   confidently-wrong clean answer this check exists to catch.

   ```bash
   if ! git fetch origin main --quiet; then
     echo "Cannot refresh origin/main; stop before checking branch freshness." >&2
     exit 1
   fi
   git rev-list --count HEAD..origin/main
   ```

   A non-zero count is a freshness signal, not a problem by itself. Do not
   merge, rebase, or otherwise update the branch merely because `origin/main`
   advanced; a PR may be behind `main` while remaining valid and mergeable.
   Keep the branch head stable so its checks remain meaningful. Update from
   current `origin/main` only when GitHub reports `CONFLICTING` (or a local
   merge proves a real conflict blocks shipment). In that case, merge
   `origin/main` once, resolve it, push, and wait for the new checks. Before
   that merge, both `git status --short -- . ':(exclude)learnings.md'
   ':(exclude)bridge/**' ':(exclude)data/**'` and the branch-specific
   unpublished-commit check above must be empty. The check is also scoped to
   publishable paths, so a commit containing only an excluded path does not
   block recovery. The excluded paths remain
   preserved and reported, but do not block conflict recovery unless the
   merge itself touches them. If either publishable-path check is not empty,
   inspect every dirty path and unpushed commit; publish them first only when
   all of them belong to the same
   actionable fix. If any unrelated or incomplete concurrent work overlaps the
   checkout, preserve it and wait for its owner rather than stashing, restoring,
   or forcing the merge. Do not repeat the merge while the PR is mergeable or
   checks are merely pending. A behind count alone never justifies a merge
   commit.

3. **Validate enough to avoid obvious breakage**: run focused tests for the
   changed area. Push the first safe slice before running `pnpm run prep` or
   another long validation. Run prep when it is practical, but if prep is slow,
   flaky, or contaminated by concurrent in-flight edits, do not stall shipment:
   record the exact failure, keep pushing stable slices, and let GitHub Actions
   be the validation gate that `/babysit-pr` monitors.

4. **Publish the branch snapshot**: for the requested initial handoff, run
   `corepack pnpm ship:push` to stage, commit, and push all nonignored
   current-branch work. For later snapshots, run it only for an actionable fix
   required by failing CI, PR feedback, a real merge conflict, or an explicit
   user request, after verifying that all dirty paths belong to that fix.
   Never add `Co-Authored-By` or other agent attribution.

   The first successful push is the review handoff point: open or update the
   ready PR immediately, before waiting on `pnpm prep`, a stability window, or
   additional concurrent work. An actionable later commit updates that same PR
   and lets CI and review run in parallel with the rest of the ship workflow.
   Do not create or push a later snapshot for a clean tree, `origin/main` drift,
   queued checks, or a babysit timer tick.

5. **Open or update a ready PR immediately after the first push**: use the
   current branch. PRs are ready for review by default, not drafts. Do not put
   `codex`, `[codex]`, or similar agent labels in the title/body.

   For every later safe slice that fixes failing CI, addresses PR feedback,
   resolves a real merge conflict, or implements an explicit user request,
   update this same PR immediately after pushing. Do not create a second PR or
   wait for prep to finish before handing the slice to CI and review. A clean
   tree, `origin/main` drift, queued checks, or a timer tick is not a safe
   slice and must not produce a commit or push.

6. **Babysit immediately**: run `/babysit-pr <number>` and follow that skill’s
   tick loop exactly. Treat `babysit-pr` as the source of truth for how to watch
   the PR. Its Step 0 checks the current nonignored branch snapshot and
   publishes only actionable work, then checks mergeability, every unaddressed
   review comment by reply state, and CI.
   Keep going until the PR is either merged/closed or the user explicitly tells
   you to stop.

7. **Merge when allowed**: because `/ship` includes merge authorization, merge
   with `gh pr merge <number> --squash --admin` only after `/babysit-pr`’s merge
   requirements are simultaneously true for 10 consecutive minutes:
   clean working tree, no unpushed commits, GitHub Actions green, all review
   comments addressed/replied, and mergeable.

   If conflict recovery was required, compare the local checkout with the
   live PR head before merging `origin/main`; do not update or merge an
   obsolete local head while another session has advanced the PR branch.
   `/babysit-pr` provides the exact `headRefOid` check for this gate.

   If this invocation also found a Dependabot PR, apply the dedicated
   `review-prs` exception above and merge each qualifying update with its
   expected head SHA. Immediately before each merge, re-read the current head,
   review state, mergeability, and checks; obtain any required approval from a
   verified BuilderIO human member other than the PR author or a bot, after
   verifying the GitHub user type is `User` and organization membership with
   `gh api orgs/BuilderIO/members/<login>`. Then run:
   `gh pr merge <number> --squash --match-head-commit <sha>` without `--admin`.
   Re-read each PR after merging and record its result; never use this path to
   bypass a failed or unavailable check.

8. **Create the next branch after merge**: after the PR is merged and `origin/main`
   contains the merge commit, run `/new-branch`. Follow that skill’s preflight,
   stash gate, branch naming, and stash-reporting rules. This is the only branch
   movement in the ship flow.

9. **Report**: summarize the PR URL, merge result, new branch name, validation,
   and any feedback/CI fixes handled. Do not claim post-merge beta or production
   monitoring unless you ran `/ship-now` or `/ship-and-monitor`.

## Important

- **Multiple agents run concurrently.** There will often be locally changed
  files you didn't generate. This is normal. Include a path in a later branch
  snapshot only when it belongs to the same actionable fix; otherwise preserve
  it for its owner and report it. Don't revert or overwrite other agents' work;
  fix real bugs if CI or review feedback flags them.
- Never commit `learnings.md` or files in `.gitignore`.
- If feedback appears in inline comments or review bodies, every item needs a
  fix or a reply before merge.
- Treat `/babysit-pr` as the source of truth for CI/review monitoring cadence,
  comment handling, local-file push discipline, and merge gates. Update
  `babysit-pr` first if the watcher behavior changes.
- Treat `/ship` as complete after its merge and branch-rotation steps. Use
  `/ship-now` or `/ship-and-monitor` for post-merge beta/release monitoring and
  explicit manual production-promotion verification.
- Treat `/new-branch` as mandatory after a successful merge so the workspace is
  ready for the next task on fresh `main`.
