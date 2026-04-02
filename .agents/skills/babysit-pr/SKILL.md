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

5. **If only external CI fails** (Cloudflare Workers, Netlify, etc.) and GitHub Actions passes:
   - Note the failure but don't block on it — these may need dashboard config changes
   - Do NOT reset the 30-min timer for external-only failures

6. **If everything green + no new feedback for 30 min**: cancel the loop, report done

## Responding to feedback

**Every comment must get a response** — either a fix or a reply explaining why you're skipping it.

- If you fix it: commit, push, and the fix speaks for itself
- If you skip it: reply to the comment via `gh api repos/{owner}/{repo}/pulls/comments/{id}/replies -f body="..."` explaining why (pre-existing, false positive, not practical, etc.)
- Never silently ignore a comment

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

## Stop conditions

- No new actionable feedback AND GitHub Actions green for 30 consecutive minutes
- PR is merged or closed
