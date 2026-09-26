---
name: ship
description: >-
  Commit and push the complete current-branch snapshot, open a ready PR,
  babysit it, and merge when clean unless the user asks to leave it open. Keep
  shared and peer checkouts on their current branches; Steve has authorized
  task-owned worktree branches and rotation without per-task permission. Use
  when the user asks to ship, publish, or hand off local changes.
  Matching beta and docs paths publish automatically after merge; other
  production promotion is manual.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship

Use /ship only when the user asks to ship, publish, or hand off the current
work. It means: publish the requested current-branch snapshot, open a ready
PR, and monitor it through merge unless the user explicitly asks to leave the
PR open. A merged shipment also leaves the worktree ready for the next task.

## Contract

- Ship all nonignored changes belonging to the requested work on the current
  branch. The checkpoint helper excludes learnings.md, bridge/**, and data/**.
- Preserve unrelated or incomplete concurrent work. Never reset, clean, stash,
  overwrite, rebase, or force-push it.
- `/ship` starts in `ship_mode=merge-authorized`: merge once the gates below
  pass unless the user explicitly says to leave the PR open. If they opt out,
  switch to `ship_mode=ready-only`; keep fixing CI and review feedback until the
  PR is ready, then leave it open and do not rotate the branch.
- Before the guarded merge, persist its exact verified PR head OID as
  `ship_merge_head_oid` in the active goal or task transcript. Continue in the
  foreground through post-merge disposition. Carry the immutable value through
  verification; never replace it with a live PR head read after merge, because
  the source branch may advance or be deleted.
- `/ship` publishes and merges the current branch by default. If task isolation
  helps, Steve's standing authorization permits a new task-owned worktree branch
  without another ask; leave the existing checkout untouched. After `origin/main`
  ancestry is verified, rotate a successfully merged, user-owned worktree to a
  fresh branch through `/new-branch`. Preserve platform-assigned branches. If
  unpublished commits or dirty publishable paths remain, retain the source
  branch and report them; do not strand commits excluded from `ship:push`.
- In Codex, inspect the task goal with `get_goal` at the start. If none exists,
  create one with `create_goal` whose objective, under normal `/ship`
  authorization, says to continue until the PR is merged, `origin/main` ancestry
  is verified, and branch disposition is complete: rotate a clean user-owned
  worktree to a fresh branch through `/new-branch`; standing branch authorization
  covers creating/switching without another ask. If unpushed commits or dirty
  publishable paths remain, retain the source branch and report their hashes.
  Preserve platform-assigned branches while checking and fixing CI/review feedback and
  using the guarded squash-admin merge. If the user explicitly opts out of
  merging, make the goal match that endpoint. Reuse an existing goal only when
  it covers this shipment; never replace an unrelated goal. For
  `ship_mode=ready-only`, set the endpoint to an open PR with green required
  checks, addressed review feedback with no new actionable item at final
  revalidation, `MERGEABLE`, a clean worktree, and no unpushed commits.
  Complete the ship goal only after its stated endpoint is reached.
  The goal records the objective; `/babysit-pr` owns the checks. `/ship` stays
  foreground-only and creates no watcher or lease.
- In Claude Code, use its native session goal for the same endpoint. `/goal` is
  a session command, not an agent tool, so the user must submit it as a separate
  message before invoking `/ship`; loading the skill cannot set it. Submit this
  condition in a standalone `/goal` message: `Run /ship through the guarded admin merge, verify
  origin/main contains the merge commit, then finish branch disposition. Rotate
  a clean user-owned worktree to a fresh branch through `/new-branch` under the
  standing branch authorization; if unpushed commits or dirty publishable paths
  remain, retain the source branch and report their
  hashes. Keep platform-assigned Builder.io and Fusion branches unchanged. Keep
  checking and fixing CI and review feedback until then.` Do not replace an
  unrelated active goal; Claude Code permits one per session. If `/ship` was
  already invoked without one, keep shipping in the
  foreground; the missing native goal does not block the authorized merge or
  completion. Do not claim that a native goal is active.
  If the user explicitly opts out of merge, replace that goal with the
  `ready-only` endpoint above; leave the PR open and do not rotate.
  The goal evaluator reads the transcript, so report the live PR state, merge
  SHA, ancestry proof, and branch disposition as they happen. If Claude clears,
  pauses, or completes the goal before the actual endpoint, state that it is
  inactive and continue the shipment in the foreground. If the session ends
  first, give the user the same condition to submit as `/goal` in the next
  session; do not claim the goal is active or ask the user to interrupt an
  in-progress shipment to restore it.
- If the user asks not to create scheduled tasks, keep ship and babysitting in
  the foreground; do not create a separate recurring automation.
- For a linked GitHub issue, a verified source fix in the merged shipping
  snapshot is enough to close it. Thank the reporter, link the fix, and close
  immediately; do not leave it open waiting for publication, beta, or live
  proof, and never say "leaving open until published." Keep it open only while
  accepted scope is still unfixed, the source fix is not merged, or reporter
  information is required.
- Use the current task-owned worktree. When it is detached and needs a branch,
  follow the preflight branch gate below under Steve's standing task-owned
  branch authorization; never create an unused branch or attach or move another
  task's worktree.
- Never add Co-Authored-By, codex, [codex], or agent labels to commits, branch
  names, PR titles, or PR bodies.

## Flow

1. Preflight the worktree and ownership.
2. Run focused validation and publish the first coherent snapshot.
3. Open or update the ready PR immediately.
4. Run `/babysit-pr <number>` in this foreground task with the inherited
   `ship_mode`. The standalone 30-minute stop never ends a `/ship` lifecycle.
5. In `merge-authorized` mode, merge only after the live gates hold for 10
   minutes. In `ready-only` mode, stop at the verified ready-PR gate and leave
   the PR open.
6. After a merge, verify it reached `origin/main`, then rotate a clean
   user-owned worktree to a fresh branch through `/new-branch`. Retain the source
   branch and report unpublished work if rotation gates fail. `ready-only`
   shipments do not rotate.
7. Report source checks, PR, merge or intentional open state, branch
   disposition, and deployment boundaries separately.

## Existing PR backlog

When the user asks to ship a backlog, inspect every relevant open PR directly
with fresh `gh pr view` and `gh pr checks` state. Do not create a second
reminder or leave a scheduler repeating an unchanged status. For each PR:

- If required CI is failing, open the failing run logs, fix only an actionable
  repo-owned failure, publish one coherent update, and recheck the same head.
- In `merge-authorized` mode, if CI is green, the PR is mergeable, and review
  items are addressed, use the authorized admin merge after the unchanged
  10-minute soak. Capture the final live `headRefOid` immediately before
  merging, retain that OID for branch disposition, and bind the operation to it:
  `gh pr merge <number> --squash --admin --match-head-commit <verified-head-oid>`.
  If the command rejects because the head changed, restart the soak.
- In `ready-only` mode, keep fixing CI and review feedback until the ready-PR
  gate in `/babysit-pr` holds; then leave the PR open without merging or rotating.
- If an external dependency is unchanged, record the exact blocker once and
  keep the foreground task quiet until a meaningful state change. Do not send
  repeated "continue" prompts that restate CI status.

The scheduler is a trigger, not the work. The original task that received the
ship request owns its endpoint; it must not stop at a progress report while an
actionable PR state is available. In `merge-authorized` mode, that endpoint is
merge, `origin/main` proof, and branch disposition; once the gates hold, the
owning task captures the final live `headRefOid` and performs the guarded admin
merge without waiting for the user or a separate watcher. In `ready-only` mode,
the endpoint is the verified ready-PR gate with the PR intentionally left open.
Under `merge-authorized`, `reviewDecision: REVIEW_REQUIRED` is not a user
handoff: once required checks are green, the live PR is `MERGEABLE`, and every
review item has a verified fix, reply, or terminal disposition, the owning task
must perform the guarded admin merge after the unchanged soak. Never ask the
user to click Merge for that routine authorized step.

## 1. Preflight

Start by refreshing the remote and reading the actual checkout:

```bash
if ! git fetch origin --quiet; then
  echo "Cannot refresh origin refs; stop before checking unpublished commits." >&2
  exit 1
fi
git status --short
git diff --stat
git log --oneline -5
git rev-list --count HEAD..origin/main
```

The all-origin fetch refreshes both `origin/main` and the current branch's
tracking ref before comparing unpublished work. Inspect the current branch's
unpushed commits with the remote-aware fallback:

```bash
if git show-ref --verify --quiet "refs/remotes/origin/$(git branch --show-current)"; then
  git log --oneline "origin/$(git branch --show-current)"..HEAD -- \
    ':(exclude)learnings.md' ':(exclude)bridge/**' ':(exclude)data/**'
else
  git log --oneline HEAD --not --remotes=origin -- \
    ':(exclude)learnings.md' ':(exclude)bridge/**' ':(exclude)data/**'
fi
```

The behind count is information, not a reason to merge or rebase. Check
GitHub's live mergeability before updating from origin/main.

If `git branch --show-current` is empty, inspect `git worktree list
--porcelain` and existing `changes-*` refs. Steve's standing authorization
covers creating a task-owned shipping branch without another permission ask.
Preserve the detached checkout, fetch `origin/main`, and save
`detached_head=$(git rev-parse
HEAD)`. If `origin/main` is an ancestor of `detached_head`, create the named
branch at that exact saved commit so it retains every detached commit and the
freshly fetched `origin/main` remains its base. If `detached_head` is an
ancestor of `origin/main`, create from `origin/main` only when the entire
worktree is clean. If it is dirty, leave the source checkout untouched, create
a separate worktree from `origin/main`, then carefully reapply all intended
tracked and untracked changes before publishing. If histories diverge, preserve
every source commit and path while reconciling in the new worktree; never create
from `origin/main` in a way that omits detached work. Use `/new-branch`'s
naming rules and do not stash or discard source changes.

Before publishing, classify every dirty path and unpushed commit. If any is
unrelated or incomplete concurrent work, preserve it and stop the publishing
step with a concrete report. Do not hide it in a stash or make a guessed
commit.

## 2. Validate and publish

Run the smallest relevant formatter, tests, typecheck, and guards for the
changed area. Push the first coherent snapshot before a long prep or broad
validation so CI can work in parallel. A slow or contaminated local check is
not permission to stall the handoff; record the exact result and let the PR
checks carry the gate.

After the ownership check, run:

```bash
corepack pnpm ship:push
```

Confirm the push landed on the current branch and read the remote head back.
Run ship:push again only for an actionable CI fix, review fix, conflict
resolution, or explicit user request. A clean tree, a behind count, queued
checks, or a babysit timer never creates a publish commit.

## 3. Open or update the PR

Open or update one ready PR for the current branch immediately after the first
push. Use a factual title and body. Do not create a second PR from a worktree.
Do not tag, assign, mention, or leave proactive comments on the PR unless the
user explicitly requested that communication. A factual reply needed to
document a review fix or terminal disposition is allowed when the babysit
gate requires it.

Keep these claims separate in the PR and final report:

- source and focused tests;
- CI and review state;
- merged commit and origin/main ancestry;
- beta, docs, or production deployment state.

## 4. Babysit

Run /babysit-pr <number> immediately after PR creation in this foreground
task. Follow that skill for local-change ownership checks, review handling,
conflict recovery, and cadence. `/ship` never creates a watcher or acquires a
lease; keep this task active through its authorized endpoint.

Under `/ship` with `ship_mode=merge-authorized`, `/babysit-pr` is a blocking
subworkflow, not a terminal handoff. Do not return "All clear" or stop this
foreground task while the PR is open. A green, review-clean, mergeable
unchanged head that passes the 10-minute gate is an immediate guarded-merge
trigger. After merge, continue in this foreground task through `origin/main`
verification and branch disposition before completing the ship goal.

With `ship_mode=ready-only`, continue fixing CI and review feedback until the
PR is open, required checks are green, all review items are addressed, GitHub
reports `MERGEABLE`, no new actionable feedback arrived since the final review
scan, the worktree is clean, and no commits are unpushed. Then leave the PR
open and return to the parent `/ship` goal without merging or rotating. This is
the no-merge endpoint, not the standalone 30-minute quiet stop.

If a live PR is CONFLICTING, let babysit-pr recover it only after:

- the local tree and publishable-path unpublished-commit check are clean;
- the local HEAD exactly matches the live PR headRefOid;
- origin/main was freshly fetched.

Merge origin/main once with a normal merge, resolve and test it, push, and
restart the soak. Never merge main merely because the PR is behind, checks are
pending, or mergeability is UNKNOWN.

### Feedback handoff

If /review-latest-feedback was used, carry its start cursor, grouped reports,
evidence links, and disposition table into the ship ledger and PR recap.
Follow review-latest-feedback for ownership, reactions, reporter replies, and
the exact disposition vocabulary; follow babysit-pr for review comments and
merge blocking. Do not send Slack replies or reactions as a routine ship step
unless that workflow was explicitly requested or already owns the action.

Close linked GitHub issues as soon as their accepted fix is verified in the
merged snapshot. The publication and runtime follow-ups belong in the ship
ledger; they do not delay issue closure. If an issue was already fixed in the
merged snapshot and the issue comments document that fix, close it during the
same ledger pass and thank the reporter. If more information is needed, ask
one targeted question and leave the issue open.

Leave bot-authored PRs, including Dependabot, untouched when reviewing a queue.

## 5. Merge gate

Merge only when all of these are true at the same time and remain true for 10
continuous minutes on the unchanged live PR head:

- working tree is clean and there are no unpushed commits;
- required GitHub Actions checks are green;
- every human or bot review item has a verified fix/reply or a valid terminal
  disposition;
- GitHub reports the PR mergeable;
- no new actionable feedback arrived during the soak.

Immediately before merging, revalidate the full gate for the still-open PR:
working tree clean, no unpushed commits, required checks green, every review
item addressed, mergeability still `MERGEABLE`, and no new actionable feedback
since the soak began. Capture the live `headRefOid` from that same final check
and use it for the merge guard. If any gate changed, restart the soak.

Then use the explicit squash-admin merge:

```bash
gh pr merge <number> --squash --admin --match-head-commit <verified-head-oid>
```

Capture `<verified-head-oid>` only after the full final gate check immediately
before this command. This admin merge is the normal `/ship` completion step
once the gates hold; do not wait for an additional approval or enable
auto-merge. If the head-match guard rejects the merge, restart the soak for the
new head.

Never enable auto-merge. If a gate fails, fix the actionable cause, publish one
coherent update to the same PR, and restart the soak. A queued, skipped,
cancelled, superseded, provider, or missing-secret job is not automatically a
repo defect; classify it before changing code.

## 6. Branch disposition after merge

After the merge, verify that `origin/main` contains the merge commit. In a
platform-managed Builder.io or Fusion checkout, keep its assigned branch. In a
clean user-owned worktree, use `/new-branch`'s guarded post-merge path under the
standing branch authorization. If unpublished work prevents rotation, retain
the source branch and report it. Only then mark the ship goal complete.

## Deployment boundary

Merges trigger the prebuilt beta publisher on every push to `main`. The docs
production workflow runs only when its path filters match. Other production
promotion is manual. Do not wait for Netlify Git-connected builds, clear a
Netlify lock by hand, or claim beta or production is live from a green PR. Use
/ship-and-monitor when the user asks for post-merge beta, docs, release-tail,
or manual-production proof.

## Final report

Include the ready PR URL, merged commit, branch disposition, focused/local
checks, required CI state, and any deployment result. In the feedback
dispositions,
name each linked issue that was thanked and closed and each issue left open
with its precise blocker. Say explicitly when deployment was not part of this
run.
