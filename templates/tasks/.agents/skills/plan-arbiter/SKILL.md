---
name: plan-arbiter
description: Use when asked to compare, cross-review, merge, judge, choose, or arbitrate competing plans from multiple agents such as Codex and Claude Code; when given two or more proposed plans, session IDs, transcripts, plan documents, PR descriptions, or pasted strategies; or when the user wants one recommended execution plan after agents review each other's proposals.
---

# Plan Arbiter

Turn competing plans into one executable direction. Preserve the best ideas,
reject weak assumptions, and produce a clear handoff instead of a blended mush.

## Workflow

1. Collect the source plans.
2. Normalize each plan into comparable claims.
3. Cross-review the plans against each other and the real codebase or task
   context.
4. Choose a winner, merge a better hybrid, or send the plans back for revision.
5. Produce one execution handoff with verification gates and rejected
   alternatives.

Planning is read-only unless the user explicitly asks you to implement after the
decision.

## Collect Source Plans

Accept plans as pasted text, local files, session IDs, transcript paths, PRs,
comments, visual-plan links, or chat history. Resolve the original artifacts
when possible so you can see prompt changes and assumptions that may be missing
from a final summary.

If a plan is still being written and the user asked you to wait, monitor it
until it is done or blocked. If a plan cannot be resolved, continue with the
available plan text and mark the missing source as a risk.

## Normalize

For each plan, extract:

- Objective and scope.
- Key assumptions and unresolved questions.
- Proposed files, modules, APIs, data shapes, UI states, or workflows.
- Implementation sequence.
- Validation strategy.
- Rollback or migration concerns.
- Cost, complexity, and expected executor fit.

Do not reward verbosity. Prefer plans that are concrete, grounded in real code,
and honest about tradeoffs.

## Cross-Review

Review each plan as if another capable agent wrote it:

- Check whether it satisfies the user's actual request.
- Verify claims against the repo, docs, tests, screenshots, or external systems
  when those are relevant and available.
- Identify hidden dependencies, missing tests, risky sequencing, vague steps,
  unnecessary scope, and hard-to-reverse decisions.
- Notice complementary strengths: one plan may have the better architecture
  while another has the better migration or validation path.
- Separate plan quality from executor preference. A cheaper/faster executor can
  be the right choice for implementation even when another model produced the
  best critique.

Use subagents for independent review when the plans are large, the codebase is
wide, or the decision would benefit from separate technical and product passes.

## Decide

Choose one of three outcomes:

- **Adopt:** pick one plan mostly as written.
- **Hybrid:** combine specific pieces into a stronger execution plan.
- **Revise first:** request another planning pass because both plans miss a
  key constraint or depend on an unresolved decision.

Use this tie-break order:

1. Correctness and fit to the user's request.
2. Grounding in real files, APIs, tests, data, and UI behavior.
3. Simpler first implementation that does not block the intended future.
4. Better validation and rollback story.
5. Lower token/time cost for execution once quality is acceptable.

## Handoff

Return a compact decision memo:

```md
Decision
- Adopt Plan A / Hybrid / Revise first.

Why
- The deciding evidence and tradeoffs.

Execution Plan
- Ordered steps with files or surfaces to touch.

Borrowed From Other Plans
- Useful pieces kept from non-winning plans.

Rejected
- Ideas intentionally not taking, with reasons.

Verification
- Tests, browser checks, screenshots, CI, review, or deploy checks needed.

Executor Recommendation
- Which agent/model should implement and why.
```

When the user already asked for execution and the chosen path is clear, proceed
with the selected plan after reporting the decision briefly. Otherwise stop at
the handoff and ask for approval.
