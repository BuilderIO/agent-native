---
name: babysit-pr
description: Monitor a PR, fix feedback and CI failures until fully green for 30 min. Run with /babysit-pr <number>
user_invocable: true
---

Monitor PR #$ARGUMENTS in the current repo. Fix CI failures and review feedback until everything is green and no new feedback arrives for 30 minutes.

**If no PR number is given**, auto-detect it: get the current branch (`git branch --show-current`), find the open PR for it (`gh pr list --head <branch> --state open --json number --limit 1`). If no open PR exists, check recent merged/closed PRs. Only ask the user if no PR can be found.

## Setup

1. Start a `/loop 1m` that checks for new feedback and CI status every minute
2. Track when the last actionable item (new feedback or CI fix) occurred
3. After 30 minutes of no new actionable items with GitHub Actions CI green, cancel the loop and report "All clear"

## Each tick

**Step 0 — always do this first, before anything else:**

1. Run `git status --short` to check for local uncommitted changes from concurrent agents.
2. If any exist: look at `git diff --stat` to understand what changed, then write a descriptive commit message based on the actual changes (e.g. "feat(tools): add error toast + dark mode sync" or "fix(analytics): update sidebar layout"). Never use generic messages like "chore: sweep concurrent agent changes".
3. `git add <files> && git commit -m "<descriptive message>" && git push`.
4. Run `git log --oneline origin/<branch>..HEAD` to check for local commits not yet on the remote.
5. If any unpushed commits exist: `git push`.

This ensures every tick starts with a clean, fully-pushed working tree. Never skip this step.

**Step 1 — check for merge conflicts:**

1. Run `gh pr view $ARGUMENTS --json mergeable --jq '.mergeable'`.
2. If `CONFLICTING`: rebase on main (`git fetch origin main && git rebase origin/main`), resolve conflicts, commit, and push. This resets the soak timer.
3. If `MERGEABLE` or `UNKNOWN`: proceed.

**Then proceed with PR checks:**

1. Check for new review comments from bots:
   ```bash
   gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments --jq '.[] | select(.user.type == "Bot") | select(.created_at > "<30min_ago>") | {id, path: .path, body: .body[0:300]}'
   ```

2. Check CI status:
   ```bash
   gh pr checks $ARGUMENTS
   ```

3. **If new bot comments with real bugs** (confidence >= 75):
   - Read the relevant files
   - Fix the issues
   - Run `pnpm run prep` to verify locally
   - Commit and push
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

**Every comment must get an inline reply** — either a fix or an explanation of why you're skipping it.

- If you fix it: commit, push, AND reply inline confirming the fix. Fixing code marks the comment as "outdated" in GitHub's UI, but the user needs to see the reply to know you addressed it — don't rely on the outdated status alone.
- If you skip it: reply to the comment via `gh api repos/{owner}/{repo}/pulls/323/comments/{id}/replies -f body="..."` explaining why (pre-existing, false positive, not practical, etc.)
- If the issue is real but you didn't introduce it: fix it anyway and reply. Real bugs should be fixed regardless of who wrote the code.
- **Never silently ignore a comment** — every single one must have a reply so the user can verify everything was addressed.

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
4. **All review comments addressed** — every bot comment has a fix or a reply
5. **No merge conflicts** — `gh pr view --json mergeable --jq '.mergeable'` must be `MERGEABLE`

The 10-minute soak timer **resets to zero** whenever you push anything, CI fails, a new review comment arrives, merge conflicts appear, or local changes are found and committed.

Only after 10 consecutive clean minutes, force merge with `gh pr merge <number> --squash --admin`.

## Stop conditions

- No new actionable feedback AND GitHub Actions green for 30 consecutive minutes
- PR is merged or closed
