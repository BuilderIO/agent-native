---
name: bug-trace
description: >-
  Find the root cause of a reported bug: take in the report (GitHub issue, Jira
  ticket, file, or pasted text), trace the failing path hop by hop with each
  hop's runtime precondition, find the recent change that broke it, and rule
  out rival explanations. Use for any bug investigation where the cause is not
  yet known.
scope: dev
metadata:
  internal: true
---

# Bug trace

This skill finds a root cause. It doesn't judge whether the cause is
systemic; `investigate-bug` adds that judgment on top. Never change
product code while tracing.

## 1. Take in the report

```bash
pnpm exec tsx .agents/skills/bug-trace/scripts/bug-intake.ts \
  --issue <N|url> | --jira <KEY|url> | --file <path> | --text "<report>" \
  [--title "<line>"] [--run <id>]
```

It writes `bug.json` to the run directory and prints the run id
(`bug-gh-123`, `bug-eng-456`, or `bug-<date>-<hash>`). Re-running with the
same report reuses the run. Jira intake uses `jira-refactor-findings`'
client and credentials.

## 2. Split symptoms

A report often lists several. Treat each one on its own, with a short label.

## 3. Trace each symptom

Follow `references/bug-investigation.md`:

1. Write the path as hops, each with file:line and its runtime precondition.
2. Check every precondition against today's code.
3. List what changed on the path: system-history `analyze.ts --focus`
   with every file on the path, then read each regression candidate with
   `pr.ts`.
4. Hold at least two explanations, and run the check that separates them.
5. Reproduce in the branch browser when the path runs there.
6. Check `AGENTS.md`, skills, and `packages/core` for a rule or primitive
   the code bypasses.

When fanning out to sub-agents, give each one the symptom, its entry point,
and the whole brief. Don't give it a theory or a short list of files: that
list becomes the boundary of its search.

## Output

For each symptom:

- the hop list, and the broken hop;
- the trigger commit, or `none-found` and what you checked;
- the explanations you ruled out, and how;
- the evidence level: `reproduced`, `traced` (a broken hop shown in code),
  or `inferred`;
- the framework rule involved;
- the sibling sites.
