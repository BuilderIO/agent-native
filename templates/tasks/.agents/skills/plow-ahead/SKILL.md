---
name: plow-ahead
description: >-
  Use when the user explicitly wants autonomous progress without routine
  clarification stops: "plow ahead", "do not stop", "use your best judgment",
  "keep going until done", "finish while I am away", "do not ask questions
  unless truly blocked", or similar. Convert ordinary ambiguity into stated
  assumptions, proceed through implementation and validation, stop only for true
  blockers, and end with a clear recap of decisions, changes, verification, and
  residual risk.
---

# Plow Ahead

Proceed through ordinary ambiguity. Make reasonable assumptions, keep momentum,
validate as you go, and make the final recap strong enough that the user can see
what decisions were made while they were away.

## Autonomy Contract

Treat the user's instruction as permission to continue through normal
uncertainty:

- Turn routine questions into explicit assumptions.
- Prefer the smallest reversible choice that satisfies the request.
- Use repo conventions, nearby patterns, local docs, tests, and existing product
  behavior as the decision source.
- Keep working through normal test failures, missing context, implementation
  choices, and minor ambiguity.
- Use subagents for independent research, implementation, or verification when
  parallel work can reduce idle time or improve coverage.
- Do not pause merely to ask which reasonable option the user prefers. Pick one,
  record why, and keep going.

## Stop Conditions

Stop and ask only for true blockers:

- Required credentials, secrets, accounts, paid services, or private data are
  unavailable.
- The next step would be destructive, irreversible, or production-mutating.
- The task requires an explicit branch operation, history rewrite, force push, or
  deletion that the user did not directly request.
- Legal, safety, privacy, or security risk is high and cannot be reduced by a
  conservative local choice.
- The user explicitly reserved a decision for themselves.
- A verification failure repeats after reasonable investigation and the next fix
  would be speculative or broad.

If blocked, leave a self-contained handoff: what was done, what blocks progress,
what exact input is needed, and the next command or file to inspect.

## Decision Rules

When choosing without the user:

1. Reuse existing patterns before inventing new ones.
2. Prefer local, reversible, low-blast-radius changes.
3. Keep scope tight to the user's request.
4. Choose correctness and maintainability over cleverness.
5. Validate with the smallest meaningful test first, then broaden only when the
   risk justifies it.
6. If two options are close, choose the one that is easier for the user or a
   reviewer to understand later.

Maintain a lightweight decision log while working. It can live in notes, the
plan, or your final answer, but do not create a new repo artifact unless the task
needs one.

## Work Loop

1. Restate the goal internally and identify likely acceptance criteria.
2. Inspect the real files, docs, issue, PR, screenshots, or runtime behavior
   before editing.
3. Make assumptions explicit, then act on them.
4. Implement in small coherent steps.
5. Run targeted validation and fix issues found by validation.
6. Repeat until the requested work is complete or a stop condition applies.
7. Before final response, review the diff and verification evidence against the
   original request.

## Final Recap

End with a recap that makes autonomous decisions auditable:

```md
Goal
- What you completed.

Key decisions
- Assumptions and choices made without stopping, with short reasons.

Changes
- Files, behavior, docs, or configuration changed.

Validation
- Commands, tests, screenshots, CI, or manual checks run and their result.

Remaining risk
- Anything not verified, deferred, or blocked.
```

Keep the recap factual. Do not hide uncertainty, skipped validation, or judgment
calls.
