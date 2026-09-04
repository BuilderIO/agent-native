---
name: babysit-pr
description: Monitor a PR, fix feedback and CI failures until fully green for 30 min. Run with /babysit-pr <number>
user-invocable: true
scope: dev
metadata:
  internal: true
---

Monitor PR #$ARGUMENTS in the current repo. Fix CI failures and human or bot review feedback until everything is green and no new feedback arrives for 30 minutes.

A worktree is a valid PR checkout. When monitoring from one, keep Git and
GitHub commands in that worktree's cwd and current branch; do not copy changes
to the shared checkout or require that an agent publish from the root checkout.

## Branch-wide Snapshot Rule

During `/babysit-pr`, the PR remains the unit of review and the shared checkout
is the branch snapshot. At the first tick, record dirty paths and unpushed
commits; publish the requested initial work only after verifying that every
candidate belongs to this PR's requested fix. If unrelated or incomplete
concurrent work is present, preserve it for its owner and wait. On later ticks,
inspect the tree before every push. Run `corepack pnpm ship:push` only when the
current branch contains an actionable change required by failing CI, PR
feedback, a real merge conflict, or an explicit user request. A clean tree,
`origin/main` drift, queued checks, or a timer tick is not a reason to commit
or push. Never publish unrelated concurrent work, and never revert, stash, or
overwrite it.

When an actionable fix is actively changing, publish one coherent snapshot
once it is ready, then push it to the existing PR so CI and review agents can
work in parallel. The final clean-tree and merge-soak gates still apply before
merging, except when the user explicitly invokes `/ship-now`.

**If no PR number is given**, auto-detect it: get the current branch (`git branch --show-current`), find the open PR for it (`gh pr list --head <branch> --state open --json number --limit 1`). If no open PR exists, check recent merged/closed PRs. Only ask the user if no PR can be found.

## Setup

1. Establish a durable self-re-arming tick loop before yielding. Do ONE tick
   (see "Each tick"), then schedule the next one with the host's durable
   wake-up facility using this same `/babysit-pr <number> …` invocation. In
   Codex, derive a task-scoped watcher name
   `babysit-pr-<number>-<this task's threadId>` and use
   `mcp__codex_app__automation_update` with a complete heartbeat payload:
   `mode`, `kind: heartbeat`, `name: <watcher-name>`, `prompt`,
   `rrule: FREQ=MINUTELY;INTERVAL=2`, `status: ACTIVE`,
   `targetThreadId: <this task's threadId>`, and
   `notificationPolicy: failed_runs_only`; update that exact task-scoped
   automation on later ticks. The task-scoped name prevents different
   invocations from overwriting the same record, but it does not select one
   durable babysitter for the PR. First inspect the exact legacy heartbeat. If
   it is ACTIVE, leave it untouched, do not claim a lease or create any watcher
   for this PR, and continue this invocation in the foreground. This is a
   terminal foreground-only branch for this invocation, so skip the
   missing-watcher create or resume path below.

   When no ACTIVE legacy heartbeat is present, use the remote Git ref
   `refs/heads/agent-native-babysit-lock-<number>` as the concrete serialized
   PR lease coordinator. Its tip is a lease-record commit, not application
   code, and must record the PR, owner thread, version, expiry, and the
   observed legacy-heartbeat version plus a one-way `legacy_retired` fence.
   Create a
   fresh record with `git commit-tree`, then claim an absent ref with a normal
   non-force `git push origin <record-oid>:<lease-ref>`; ref creation is the
   atomic create-if-absent operation. Read the lease with `git ls-remote` plus
   `git fetch`/`git show`; only an expired or released record may be replaced.
   To renew or take over such a record, build the next record with the observed
   lease commit as its parent and use
   `git push --force-with-lease=<lease-ref>:<observed-oid> origin
   <record-oid>:<lease-ref>`. A rejected push is a failed claim or renewal:
   never update the heartbeat and remain foreground-only. If the lease ref
   reports another active owner, the atomic claim fails and this invocation
   remains foreground-only. The lease ref is the single source of truth for
   new watchers, so do not enumerate or infer foreign task-scoped automation
   names. An ACTIVE legacy watcher is conservatively treated as an existing
   holder. A task-scoped heartbeat is valid only while its owner holds the
   current lease.

   Never create a task-scoped watcher before this task's PR-scoped lease claim
   succeeds. Only after the claim succeeds may this invocation create or resume
   its own task-scoped watcher. Never use the legacy shared
   `babysit-pr-<number>` identity as a new invocation's heartbeat. The lease
   ref's `git push --force-with-lease` is the atomic precondition for every
   claim, renewal, and release. The ordinary `automation_update` call is made
   only after this task holds the lease, for this task's exact watcher name and
   `targetThreadId`; do not invent unsupported CAS fields for that API. Never
   use a read followed by an unconditional lease write. After every successful
   mutation, reread and verify the owner and version.

   If this invocation successfully claims the lease but any later setup check
   selects the foreground-only path, or creating/resuming the task-scoped
   heartbeat fails, release the lease immediately with the same-owner/version
   `git push --force-with-lease` operation before continuing foreground work.
   Retry a failed release from a freshly observed lease version while ownership
   is still this invocation's; if ownership moved, never release the new
   owner's lease. This setup cleanup is required even when no heartbeat was
   created, and must not wait for the stop conditions.

   The legacy-heartbeat check is part of the same serialized handoff, not an
   independent preflight. Inspect the exact legacy record before the lease
   claim. When it is quiescent, include its observed version in the atomic
   lease record and set `legacy_retired=true`; reread the legacy record
   immediately after a successful claim and immediately before
   `automation_update`. A legacy record that becomes ACTIVE, changes version,
   or cannot be read fences task-scoped creation; release this invocation's
   lease with its owner/version precondition and remain foreground-only. Once
   the retirement fence is published, no compliant invocation may activate or
   update the legacy shared heartbeat: it must first hold the same PR lease
   and use the task-scoped path. A legacy implementation that cannot honor
   that fence is treated as an unknown active holder, so leave it untouched
   and never create a second watcher. This prevents a late legacy start from
   racing the new watcher during migration.

   Choose a lease expiry at least three times the two-minute cadence. At the
   start of every tick, after the required fetch, make the lease fence the
   first Step 0 action: read the current record and atomically renew it with
   the expected owner and version before any PR checks. Renew again immediately
   before slow local validation, after validation if it may have consumed the
   TTL, and immediately before scheduling the next heartbeat. A failed renewal
   fences this invocation: do no PR work or heartbeat mutation, attempt the
   same-owner pause of its exact task-scoped record when applicable, and remain
   foreground-only. Only an expired or released record may be taken over with
   `--force-with-lease` against the freshly observed lease oid; the old owner's
   next wake must fence itself and pause its own task-scoped watcher before
   exiting. A text-only wake-up reminder is not enough. If no durable wake-up
   tool is available, keep the foreground loop running and do not stop after PR
   creation.
2. Track when the last actionable item (new human/bot feedback, CI fix, merge-conflict resolution, or a local-change commit/push) occurred.
3. After 30 minutes of no new actionable items with GitHub Actions CI green, cancel the loop (stop scheduling wake-ups) and report "All clear".

### Loop discipline — read this, it is the part people get wrong

- **Cadence: tick every 60–120 seconds while the PR is active** (CI running, recent pushes, feedback within the last few minutes, or a fast-moving branch where concurrent agents keep adding files). Only relax toward ~3 minutes once the PR is genuinely quiet (all checks green, no new commits or comments for a while). A churning branch needs the tight end of that range — new local files and new CI results show up constantly and must be picked up promptly.
- **NEVER stall waiting.** Do not end a turn "waiting" for CI, a review, or a background command without a durable scheduled wake-up. If you kick off a background command (e.g. `pnpm run prep`), you may rely on its completion notification **but always also schedule the heartbeat fallback** — notifications can silently fail to fire, and an unguarded wait becomes an indefinite stall. The loop must keep ticking regardless.
- **Do not let slow or flaky local validation block the loop.** `pnpm run prep` / `vitest` can hang or take minutes, and on a branch with concurrent edits a full local run is contaminated by other agents' in-flight files anyway. If local validation is slow, hung, or unreliable, **push and let the CI you are already monitoring be the validation gate** — a red CI job is caught and fixed on the very next tick. Prefer pushing your work over holding it for a clean local run.
- **Every tick, expect new local files.** On an active shared branch, concurrent
  agents may edit the checkout continuously. Re-run Step 0 every single tick
  to detect actionable changes, but publish only the fixes allowed by the
  Branch-wide Snapshot Rule above.

## Each tick

**Step 0 — always do this first, before anything else:**

```bash
if ! git fetch origin --quiet; then
  echo "Cannot refresh origin refs; stop before checking unpublished commits." >&2
  exit 1
fi
git status --short
git diff --name-only
if git show-ref --verify --quiet "refs/remotes/origin/$(git branch --show-current)"; then
  git log --oneline --decorate "origin/$(git branch --show-current)"..HEAD -- . ':(exclude)learnings.md' ':(exclude)bridge/**' ':(exclude)data/**'
else
  git log --oneline --decorate HEAD --not --remotes=origin -- . ':(exclude)learnings.md' ':(exclude)bridge/**' ':(exclude)data/**'
fi
```

After the status check, run `corepack pnpm ship:push` only when the dirty or
unpushed work is the intentional fix for a concrete CI failure, PR feedback,
merge conflict, or explicit user request. If the tree is clean and already
pushed, do nothing. If it is clean with unpushed commits, push them directly
only when those commits are already an intentional actionable fix; never create
a new maintenance commit merely to make the branch look current.

Every tick starts here, no exceptions: on an active shared branch local files
can change within minutes, so re-check before every actionable push.

**Never `git stash` concurrent changes.** Stashes get orphaned, and a stash named `babysit-tickN-concurrent-work-*` left on the source branch while babysit-pr's PR ships without it is exactly how real work gets lost. If you see local changes you don't recognize, preserve them for their owner; do not hide them in a stash or commit them here.

**Step 1 — check for merge conflicts:**

1. Run `gh pr view $ARGUMENTS --json mergeable --jq '.mergeable'`.
2. If `CONFLICTING`: bring `main` in and resolve. First inspect the worktree
   and unpushed commits; do not run the merge until the publishable-path check
   `git status --short -- . ':(exclude)learnings.md' ':(exclude)bridge/**'
   ':(exclude)data/**'` and the branch-specific unpublished-commit check in
   Step 0 are empty. The unpublished-commit check is also scoped to
   publishable paths, so excluded-only commits do not block recovery. Preserve
   and report excluded paths; they do not block
   recovery unless the merge itself touches them.
   Before merging, compare the local checkout with the live PR head:

   ```bash
   pr_head=$(gh pr view $ARGUMENTS --json headRefOid --jq '.headRefOid')
   if [ "$(git rev-parse HEAD)" != "$pr_head" ]; then
     echo "Local HEAD is not the live PR head; stop and let the branch owner reconcile it." >&2
     exit 1
   fi
   ```

   If either publishable-path check is non-empty, do not attempt an in-place
   isolation. Preserve the exact dirty paths and unpublished commits, leave the
   checkout untouched, and wait for the owning session to publish or move its
   work. A separate clean PR worktree may perform this recovery when one is
   already available. Never use `git stash`, reset, restore, or a temporary
   branch as a substitute for retaining concurrent work.

   Do not merge an obsolete local head.
   **Publish any intentional actionable fix first (Step 0)**, after verifying
   every dirty path and unpushed commit belongs to that fix; then prefer a
   **merge** over a rebase —
   `git fetch origin main && git merge --no-edit
   origin/main` — because this branch is shared with concurrent agents and a
   rebase would rewrite history and require a force-push that can clobber their
   unpushed commits. Resolve the conflicts (for `pnpm-lock.yaml`, take one side
   with `git checkout --theirs -- pnpm-lock.yaml` then regenerate with `pnpm
   install --lockfile-only` against the merged `package.json`), complete the
   merge commit, and push (a normal push, never `--force`). This resets the soak
   timer. If unrelated or incomplete concurrent work keeps the worktree dirty,
   preserve it and wait for its owner instead of stashing, restoring, or
   forcing the merge. Do not merge `origin/main` again while the PR is
   `MERGEABLE` or `UNKNOWN`, or while checks are merely pending; a conflict-free
   PR does not need another main merge. Only rebase if the user explicitly asks
   for a linear history.
3. If `MERGEABLE` or `UNKNOWN`: proceed. (`mergeStateStatus: BLOCKED` with `mergeable: MERGEABLE` just means required checks are still pending/red — that is not a conflict; keep going.)

## Latest-feedback handoff

If the PR body or branch cites `/review-latest-feedback`, treat its start
cursor, grouped reports, evidence links, and disposition table as part of the
PR's review state. At the first tick, record that handoff. On every later tick
before the merge gate, re-read the handoff and check for new Slack replies,
GitHub feedback, and Sentry findings after its cursor using the configured
connectors. A new actionable report resets the soak timer and needs a fix, a
concise reply, or an explicit terminal ledger disposition with the invoking
workflow's eye removed before merge. Silent terminal states need no reply. If
a connector is unavailable, record it as unavailable in the recap rather than
treating it as no findings.

**Then proceed with PR checks:**

1. Check for review comments and review summaries from humans and bots — **EVERY tick, with no exceptions.**

   > ⚠️ **Review bots (Builder, Copilot, etc.) RE-REVIEW on every push and post a brand-new round of comments each time.** A PR commonly accumulates several rounds. You MUST re-check on every single tick — including "quiet" ticks where you're only waiting on CI — and you must keep checking right up until the moment you merge.
   >
   > **Never filter comments by a "since <timestamp>" window.** A forward-looking timestamp silently skips rounds that were posted *before* your last reply (e.g. a round that landed between the first review and when you replied), and "0 new since X" reads as "all addressed" when it is not. This exact mistake left two whole review rounds unanswered on PR #1097 (2026-06-08).

   Instead, determine coverage by **reply state**: list every top-level review comment that does **not** yet have a reply, across all pages and all rounds. Stream every comment with `--jq '.[]'` (concatenates cleanly across pages), then slurp:
   ```bash
   gh api --paginate repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --jq '.[]' \
     | jq -s '
       ([ .[] | .in_reply_to_id // empty ]) as $replied
       | .[]
       | select((.in_reply_to_id // null) == null)              # top-level comments only
       | select(.id as $id | ($replied | index($id)) | not)     # …with no reply yet
       | {id, user: .user.login, path, line: (.line // .original_line), snippet: (.body[0:200])}'
   ```
   (Bind the id with `.id as $id` first — `index(.id)` would evaluate `.id` against the `$replied` array, not the comment, and error out.) If that command prints anything, there is unaddressed feedback — fix or reply to each (see "Responding to feedback") before you consider the PR clean. Also re-read the latest review **summary** bodies each tick (bots restate their findings here):
   ```bash
   gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews --jq '.[] | select(.body != null and .body != "") | {user: .user.login, state, submitted_at, body: .body[0:1000]}'
   ```
   Treat the count of unaddressed comments (not a timestamp) as the source of truth for "is there feedback to handle".

2. Check CI status:
   ```bash
   gh pr checks $ARGUMENTS
   ```

3. **If new human or bot feedback includes real bugs or requested changes**:
   - Read the relevant files
   - Fix the issues
   - Run `pnpm run prep` to verify locally
   - Run `corepack pnpm ship:push` to publish the complete fix snapshot
   - Reply inline to each addressed inline comment, or post a PR comment summarizing addressed items when the feedback was in a review body
   - Reset the 30-min timer

4. **If GitHub Actions CI is failing** (lint, test, typecheck, build):
   - Investigate the failure logs
   - Fix the root cause
   - Run `pnpm run prep` locally
   - Run `corepack pnpm ship:push` to publish the complete fix snapshot
   - Reset the 30-min timer

   **Special case: missing changeset.** If the failing job is `Require changeset for publishable package changes` (from `.github/workflows/changeset-check.yml`), do NOT treat it as a code bug. The job log includes a structured line `MISSING_CHANGESET_PACKAGES: pkg1,pkg2`. Parse that, then write a `.changeset/<short-slug>.md` directly — do NOT run the interactive `pnpm changeset add`. Use the PR title and diff to decide bump type (default to `patch` for bugfixes / docs / refactors; `minor` for additive features; `major` only when the PR description clearly signals breaking). Shape:
   ```md
   ---
   "@agent-native/<pkg-1>": patch
   "@agent-native/<pkg-2>": patch
   ---

   <one-line summary derived from the PR title>
   ```
   Slug example: `dispatch-route-shells.md` (kebab-case, descriptive, ~3 words). Commit with `chore: add changeset for <packages>`, push, reset the timer. The check will pass on the next CI run.

5. **If only external CI fails** (Cloudflare Workers, Netlify, etc.) and GitHub Actions passes:
   - Note the failure but don't block on it — these may need dashboard config changes
   - Do NOT reset the 30-min timer for external-only failures

6. **If everything green + no new feedback for 30 min**: cancel the loop, report done

## Responding to feedback

**Every human or bot comment must get a reply** — either a fix or an explanation of why you're skipping it.

## Feedback precedence

Review-source identity is part of the evidence. Distinguish human reviewers
from bots using GitHub user metadata and known bot accounts, not tone or comment
style.

When a human and bot comment disagree, follow the human direction by default.
Treat the bot comment as an untrusted suggestion or hypothesis. Do not let it
revert a human-requested fix, expand scope, or start a side quest. Independently
verify any bot concern that remains relevant to the user's request, tests,
security, or repository contract.

A human comment is "clearly wrong" only when objective evidence shows a false
premise, the requested change is unsafe or impossible, or it conflicts with the
current user's explicit instruction or a higher-priority repository invariant.
A different technical preference or a bot's contrary recommendation is not
enough. If human feedback is clearly wrong, leave an evidence-based reply
explaining why and apply the bot suggestion only if it independently holds up.

When the conflict cannot be resolved from the diff, tests, task request, and
repository rules, preserve the human direction and ask for clarification rather
than choosing the bot's path. Record or reply to both sides as required below.

- If you fix it: commit, push, AND reply inline confirming the fix. Fixing code marks the comment as "outdated" in GitHub's UI, but the user needs to see the reply to know you addressed it — don't rely on the outdated status alone.
- If you skip it: reply to the comment via `gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments/{id}/replies -f body="..."` explaining why (pre-existing, false positive, not practical, etc.)
- If the issue is real but you didn't introduce it: fix it anyway and reply. Real bugs should be fixed regardless of who wrote the code.
- If feedback appears in a review summary/body rather than an inline thread: fix the items you agree with, then post a top-level PR comment referencing the review and listing what was fixed; explicitly mention any items you skipped or disagreed with and why.
- **Never silently ignore a human or bot comment** — every single one must have a reply so the user can verify everything was addressed.

## Evaluating feedback — be skeptical

Skip (with a reply explaining why) issues that are:
- Pre-existing (not introduced by this PR)
- False positives / don't hold up to scrutiny
- Nitpicks a senior engineer wouldn't flag
- Things linter/typechecker catches (CI handles those)
- Style/formatting issues
- Already addressed in a previous commit

Fix issues that are:
- Real runtime bugs introduced by this PR
- Security issues
- CLAUDE.md violations
- Data loss risks

## Merging

An invocation from `/ship` inherits that skill's explicit merge authorization;
do not return "All clear" while its PR is still open.

**Never auto-merge by default.** Only merge when the user explicitly asks you to.

`/ship-now` is an explicit fast-path exception. When it is invoked, follow
`ship-now`'s local targeted-recovery gate and immediate admin-merge rule instead
of waiting for this section's remote-CI and soak requirements.

When the user does ask to merge, all of these must be true **simultaneously for 10 consecutive minutes** before merging:

1. **No local uncommitted changes** except the documented routine exclusions
2. **No unpushed commits** — the publishable-path `git log` check from Step 0
   must be empty
3. **All GitHub Actions CI green** — Build, Lint, Test, Typecheck, Scaffold E2E, Guard
4. **All review comments addressed** — every human/bot inline comment and review-body item has a fix or a reply
5. **No merge conflicts** — `gh pr view --json mergeable --jq '.mergeable'` must be `MERGEABLE`

The 10-minute soak timer **resets to zero** whenever the branch is pushed, CI
fails, a new review comment arrives, or merge conflicts appear.

Only after 10 consecutive clean minutes, force merge with `gh pr merge <number> --squash --admin`.

## Stop conditions

- No new actionable feedback AND GitHub Actions green for 30 consecutive minutes
- PR is merged or closed

Cleanup has two mutually exclusive paths. If this invocation claimed the PR
lease but did not create or resume its task-scoped heartbeat, release that lease
first with the same owner/version `git push --force-with-lease` operation;
retry a failed release from a fresh version while the foreground loop remains
active, and verify that the lease is released or has moved before stopping.
Do not attempt to pause a heartbeat that this invocation never created or
resumed. If this invocation did create or resume its task-scoped heartbeat,
retain the PR lease while rereading that exact
`babysit-pr-<number>-<this task's threadId>` heartbeat and capturing its current
version, then update it to `PAUSED` and verify the result. If the pause fails,
do not stop: reread the lease and heartbeat, renew the lease when it is still
ours, and retry the same-owner pause from the fresh version. If the lease has
moved to another owner, never mutate or release that owner's lease; only pause
this task's uniquely named heartbeat when its `targetThreadId` still matches
this task, and remain foreground-only until cleanup is confirmed. If the
heartbeat host is unavailable, keep retrying in the foreground rather than
claiming completion. After the heartbeat pause succeeds, mark the PR lease
released with `git push --force-with-lease` and the same owner/version
precondition. Never pause or release the legacy shared per-PR identity or
another owner's lease.
Verify the PR's final state. Never leave a heartbeat or lease owned by this
task running after completion.

Before stopping OR merging, the unaddressed-comments command above must print **nothing** — re-run it as the final gate. "I replied earlier" is not sufficient; bots may have posted new rounds since.
