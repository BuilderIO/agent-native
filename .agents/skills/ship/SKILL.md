---
name: ship
description: Commit all local changes, run prep, push, check CI, and address PR feedback
user_invocable: true
---

# Ship

Commit all locally changed files, run prep, push to remote, check CI status, and address PR review feedback.

## Steps

1. **Check local changes**: Run `git status` to see all modified/untracked files.

2. **Run prep**: Run `pnpm run prep` to verify build, typecheck, tests, and formatting all pass. If anything fails, fix it before proceeding.

3. **Stage and commit**: Stage all changed files (except `learnings.md` or other gitignored personal files). Write a concise commit message summarizing the changes.

4. **Push**: Push to the current remote branch.

5. **Check CI**: Run `gh pr checks` to see if CI is green. If there are failures, investigate with `gh run view <id> --log-failed`, fix the issues, and push again.

6. **Review PR feedback**: Check for new PR review comments via `gh api repos/{owner}/{repo}/pulls/{number}/comments`. For each comment:
   - Be skeptical — not all suggestions are worth implementing
   - Fix real bugs regardless of who wrote the code — you own the whole PR
   - Reply to comments you disagree with, explaining why
   - Only skip code that looks actively mid-work (half-written, clearly incomplete). If it looks done but has a bug, fix it.

7. **Report**: Summarize what was committed, CI status, and any feedback addressed.

## Important

- **Multiple agents run concurrently.** There will often be locally changed files you didn't generate. This is normal. Include everything and move forward. Don't revert other agents' work — but DO fix bugs in it if PR feedback flags real issues. Only leave code alone if it's clearly mid-work (half-written, incomplete). If it looks done but broken, fix it.
- Never commit `learnings.md` or files in `.gitignore`
- If prep fails on code you didn't write, fix it (bad imports, type errors, missing prettier, etc.)
- If PR review comments flag real bugs in other agents' code, fix those too — you own the whole PR
- Run `npx prettier --write` on any files you modify for fixes
- Always run `pnpm run prep` before pushing — it catches what CI will catch
