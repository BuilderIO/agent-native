---
name: ship
description: >-
  Commit and push the complete current-branch snapshot, open a ready PR,
  babysit it, merge when clean, then create a fresh branch. Use when the user
  asks to ship, publish, or hand off local changes. Matching beta and docs
  paths publish automatically after merge; other production promotion is manual.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship

Use /ship only when the user asks to ship, publish, or hand off the current
work. It means: publish the requested current-branch snapshot, open a ready
PR, monitor it, merge it when the gates hold, and leave the worktree ready for
the next task.

## Contract

- Ship all nonignored changes belonging to the requested work on the current
  branch. The checkpoint helper excludes learnings.md, bridge/**, and data/**.
- Preserve unrelated or incomplete concurrent work. Never reset, clean, stash,
  overwrite, rebase, or force-push it.
- /ship authorizes the merge once the gates below pass, unless the user says
  not to merge.
- That `/ship` request also authorizes one post-merge branch rotation in a
  user-owned checkout, after the merge commit is verified on `origin/main`.
  Platform-assigned Builder.io and Fusion branches stay in place. Apply
  `/new-branch`'s naming and safety checks only when rotation is allowed; do not
  move branches earlier or touch another checkout.
- In Codex, inspect the task goal with `get_goal` at the start. If none exists,
  create one with `create_goal` whose objective, under normal `/ship`
  authorization, says to continue until the PR is merged, `origin/main` ancestry
  is verified, and post-merge branch disposition is complete (rotate only in a
  user-owned checkout; preserve platform-assigned branches), while checking and
  fixing CI/review feedback and using the guarded squash-admin merge. If the user explicitly
  opts out of merging, make the goal match that endpoint. Reuse an existing goal
  only when it covers this shipment; never replace an unrelated goal. Complete
  the ship goal with `update_goal` only after its stated endpoint is reached.
  The goal records the objective; `/babysit-pr` owns the checks and durable
  wake-ups.
- In Claude Code, use its native session goal for the same endpoint. `/goal` is
  a session command, not an agent tool; start the ship task with `/goal` and a
  condition that tells Claude to run `/ship` and continue until the PR is
  merged, `origin/main` contains the merge commit, and post-merge branch
  disposition is complete: rotate only in a user-owned checkout, while keeping
  platform-assigned Builder.io and Fusion branches unchanged. A bare `/ship`
  cannot set this native goal on Claude's behalf. Do
  not replace an unrelated active goal; Claude Code permits one per session.
  The invocation condition is: `Run /ship through the guarded admin merge,
  verify origin/main contains the merge commit, then rotate only if the checkout
  is user-owned; keep platform-assigned Builder.io and Fusion branches unchanged.
  Keep fixing CI and review feedback until then.`
  The goal evaluator reads the transcript, so report the live PR state, merge
  SHA, ancestry proof, and rotation result as they happen. If Claude clears the
  goal after judging it impossible or an unrecoverable error, or pauses it
  without reaching the endpoint, that is not success: fix the cause, set the
  same goal again, and continue. A resumed Claude Code session restores an
  active goal.
- If the user asks not to create scheduled tasks, keep ship and babysitting in
  the foreground; do not create a separate recurring automation.
- For a linked GitHub issue, a verified source fix in the merged shipping
  snapshot is enough to close it. Thank the reporter, link the fix, and close
  immediately; do not leave it open waiting for publication, beta, or live
  proof, and never say "leaving open until published." Keep it open only while
  accepted scope is still unfixed, the source fix is not merged, or reporter
  information is required.
- Use the current worktree and branch. A detached worktree may create one
  unused shipping branch during this flow; never attach or move another
  worktree.
- Never add Co-Authored-By, codex, [codex], or agent labels to commits, branch
  names, PR titles, or PR bodies.

## Flow

1. Preflight the worktree and ownership.
2. Run focused validation and publish the first coherent snapshot.
3. Open or update the ready PR immediately.
4. Run /babysit-pr <number> and keep the watcher or foreground loop active
   through merge. Its 30-minute green-and-quiet stop applies only to standalone
   babysitting; it never ends an authorized /ship lifecycle.
5. Merge only after the live gates hold continuously for 10 minutes.
6. Verify the merge reached origin/main, then rotate to a fresh branch.
7. Report source checks, PR, merge, branch rotation, and deployment boundaries
   separately.

## Existing PR backlog

When the user asks to ship a backlog, inspect every relevant open PR directly
with fresh `gh pr view` and `gh pr checks` state. Do not create a second
reminder or leave a scheduler repeating an unchanged status. For each PR:

- If required CI is failing, open the failing run logs, fix only an actionable
  repo-owned failure, publish one coherent update, and recheck the same head.
- If CI is green, the PR is mergeable, and review items are addressed, use the
  authorized admin merge after the unchanged 10-minute soak. Capture the final
  live `headRefOid` immediately before merging and bind the operation to it:
  `gh pr merge <number> --squash --admin --match-head-commit <verified-head-oid>`.
  If the command rejects because the head changed, restart the soak.
- If an external dependency is unchanged, record the exact blocker once and
  keep the watcher quiet until a meaningful state change. Do not send repeated
  "continue" prompts that only renew a lease or restate CI status.

The scheduler is a trigger, not the work. A ship task must inspect, fix,
publish, merge, verify `origin/main`, and rotate the branch in the same
lifecycle; it must not stop at a progress report while an actionable PR state
is available. The original task that received the ship request owns this tail:
once the gates hold, it captures the final live `headRefOid` and runs
`gh pr merge <number> --squash --admin --match-head-commit <verified-head-oid>`
without waiting for the user or a separate watcher to perform the routine
merge.
Under `/ship`, `reviewDecision: REVIEW_REQUIRED` is not a user handoff: once
required checks are green, the live PR is `MERGEABLE`, and every review item
has a verified fix, reply, or terminal disposition, the owning task must
perform the guarded admin merge after the unchanged soak. Never ask the user
to click Merge for that routine authorized step.

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

If git branch --show-current is empty, inspect git worktree list --porcelain
and existing changes-\* refs, then create an unused shipping branch in this
worktree only. Never use main, attach a branch checked out elsewhere, or move
another worktree. This branch creation is authorized by the explicit /ship
request.

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

Run /babysit-pr <number> immediately after PR creation and follow that skill
for the durable heartbeat, serialized PR lease, local-change ownership checks,
review handling, conflict recovery, and cadence. Do not duplicate its lease
protocol here or end the task after opening the PR without either its watcher
or a foreground loop.

Under `/ship`, `/babysit-pr` is a blocking subworkflow, not a terminal handoff.
Do not return "All clear," stop the task, or pause its watcher while the PR is
open. A green, review-clean, mergeable unchanged head that passes the 10-minute
gate is an immediate guarded-merge trigger. After the PR merges, continue in
this task through `origin/main` verification and branch rotation before
completing the ship goal.

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

## 6. Rotate after merge

After the merge, verify that `origin/main` contains the merge commit. In a
platform-managed Builder.io or Fusion checkout, keep its assigned branch and
complete the ship goal without rotating. Otherwise, in the current user-owned
worktree, require a clean tree, fetch `origin/main`, choose a unique name using
`/new-branch`'s naming rules, and run `git switch -c <branch> origin/main`;
never check out or pull a possibly stale local `main`. Preserve existing
stashes. Only then mark the ship goal complete.

## Deployment boundary

Merges trigger the prebuilt beta publisher on every push to `main`. The docs
production workflow runs only when its path filters match. Other production
promotion is manual. Do not wait for Netlify Git-connected builds, clear a
Netlify lock by hand, or claim beta or production is live from a green PR. Use
/ship-and-monitor when the user asks for post-merge beta, docs, release-tail,
or manual-production proof.

## Final report

Include the ready PR URL, merged commit, fresh branch, focused/local checks,
required CI state, and any deployment result. In the feedback dispositions,
name each linked issue that was thanked and closed and each issue left open
with its precise blocker. Say explicitly when deployment was not part of this
run.
