---
name: babysit-pr
description: Monitor a PR, fix feedback and CI failures until fully green for 30 min. Run with /babysit-pr <number>
user-invocable: true
metadata:
  internal: true
---

Monitor PR #$ARGUMENTS in the current repo. Fix CI failures and human or bot review feedback until everything is green and no new feedback arrives for 30 minutes.

## Non-Negotiable Branch Ownership Rule

During `/babysit-pr`, the PR branch is the unit of ownership. Every tick must
commit and push **all** non-gitignored local changes on the current branch,
including changes made by the user or other concurrent agents. Do not limit
commits to files you personally edited. Do not stash, skip, or leave behind
local work unless it is `learnings.md` or an ignored/personal file.

**If no PR number is given**, auto-detect it: get the current branch (`git branch --show-current`), find the open PR for it (`gh pr list --head <branch> --state open --json number --limit 1`). If no open PR exists, check recent merged/closed PRs. Only ask the user if no PR can be found.

## Setup

1. Run a self-re-arming tick loop. Do ONE tick (see "Each tick"), then immediately schedule the next one with `ScheduleWakeup` before yielding — pass this same `/babysit-pr <number> …` invocation back as the wake-up prompt so the next firing repeats the tick. The loop ends only at a stop condition (below); until then there is **always** a scheduled next tick.
2. Track when the last actionable item (new human/bot feedback, CI fix, merge-conflict resolution, or a local-change commit/push) occurred.
3. After 30 minutes of no new actionable items with GitHub Actions CI green, cancel the loop (stop scheduling wake-ups) and report "All clear".

### Loop discipline — read this, it is the part people get wrong

- **Cadence: tick every 60–120 seconds while the PR is active** (CI running, recent pushes, feedback within the last few minutes, or a fast-moving branch where concurrent agents keep adding files). Only relax toward ~3 minutes once the PR is genuinely quiet (all checks green, no new commits or comments for a while). A churning branch needs the tight end of that range — new local files and new CI results show up constantly and must be picked up promptly.
- **NEVER stall waiting.** Do not end a turn "waiting" for CI, a review, or a background command without a scheduled wake-up. If you kick off a background command (e.g. `pnpm run prep`), you may rely on its completion notification **but always also schedule a fallback `ScheduleWakeup`** — notifications can silently fail to fire, and an unguarded wait becomes an indefinite stall. The loop must keep ticking regardless.
- **Do not let slow or flaky local validation block the loop.** `pnpm run prep` / `vitest` can hang or take minutes, and on a branch with concurrent edits a full local run is contaminated by other agents' in-flight files anyway. If local validation is slow, hung, or unreliable, **push and let the CI you are already monitoring be the validation gate** — a red CI job is caught and fixed on the very next tick. Prefer pushing your work over holding it for a clean local run.
- **Every tick, expect new local files.** On an active shared branch, concurrent agents commit into the same checkout continuously. Re-run Step 0 every single tick and push whatever is there — never assume "I already pushed, the tree is clean".

## Each tick

**Step 0 — always do this first, before anything else:**

1. Run `git status --short` to check for local uncommitted changes from concurrent agents.
2. If any exist: look at `git diff --stat` to understand what changed, then write a descriptive commit message based on the actual changes (e.g. "feat(tools): add error toast + dark mode sync" or "fix(analytics): update sidebar layout"). Never use generic messages like "chore: sweep concurrent agent changes".
3. `git add <files> && git commit -m "<descriptive message>" && git push`.
4. Run `git log --oneline origin/<branch>..HEAD` to check for local commits not yet on the remote.
5. If any unpushed commits exist: `git push`.

This ensures every tick starts with a clean, fully-pushed working tree. Never skip this step.

**Never `git stash` concurrent changes.** Stashes get orphaned, and a stash named `babysit-tickN-concurrent-work-*` left on the source branch while babysit-pr's PR ships without it is exactly how real work has been lost (2026-05-05: stash@{0} held a Sentry-instrumentation feature for clips, including a new `analytics.ts` module, that was meant to merge with PR #511's followup but stayed stuck in the stash list because babysit stashed instead of committing). If you see local changes you don't recognize, that's still other agents' work — commit it with a descriptive message based on the diff, don't hide it in a stash.

**Step 1 — check for merge conflicts:**

1. Run `gh pr view $ARGUMENTS --json mergeable --jq '.mergeable'`.
2. If `CONFLICTING`: bring `main` in and resolve. **Commit/push any local changes first (Step 0) so the tree is clean**, then prefer a **merge** over a rebase — `git fetch origin main && git merge --no-edit origin/main` — because this branch is shared with concurrent agents and a rebase would rewrite history and require a force-push that can clobber their unpushed commits. Resolve the conflicts (for `pnpm-lock.yaml`, take one side with `git checkout --theirs -- pnpm-lock.yaml` then regenerate with `pnpm install --lockfile-only` against the merged `package.json`), `git add` the resolved files, complete the merge commit, and push (a normal push, never `--force`). This resets the soak timer. Only rebase if the user explicitly asks for a linear history.
3. If `MERGEABLE` or `UNKNOWN`: proceed. (`mergeStateStatus: BLOCKED` with `mergeable: MERGEABLE` just means required checks are still pending/red — that is not a conflict; keep going.)

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
   - Commit and push
   - Reply inline to each addressed inline comment, or post a PR comment summarizing addressed items when the feedback was in a review body
   - Reset the 30-min timer

4. **If GitHub Actions CI is failing** (lint, test, typecheck, build):
   - Investigate the failure logs
   - Fix the root cause
   - Run `pnpm run prep` locally
   - Commit and push
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

**Never auto-merge by default.** Only merge when the user explicitly asks you to.

When the user does ask to merge, all of these must be true **simultaneously for 10 consecutive minutes** before merging:

1. **No local uncommitted changes** — `git status --short` must be empty
2. **No unpushed commits** — `git log --oneline origin/<branch>..HEAD` must be empty
3. **All GitHub Actions CI green** — Build, Lint, Test, Typecheck, Scaffold E2E, Guard
4. **All review comments addressed** — every human/bot inline comment and review-body item has a fix or a reply
5. **No merge conflicts** — `gh pr view --json mergeable --jq '.mergeable'` must be `MERGEABLE`

The 10-minute soak timer **resets to zero** whenever you push anything, CI fails, a new review comment arrives, merge conflicts appear, or local changes are found and committed.

Only after 10 consecutive clean minutes, force merge with `gh pr merge <number> --squash --admin`.

## Stop conditions

- No new actionable feedback AND GitHub Actions green for 30 consecutive minutes
- PR is merged or closed

Before stopping OR merging, the unaddressed-comments command above must print **nothing** — re-run it as the final gate. "I replied earlier" is not sufficient; bots may have posted new rounds since.
