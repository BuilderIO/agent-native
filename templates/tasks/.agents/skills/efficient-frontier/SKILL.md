---
name: efficient-frontier
description: Apply the same orchestration as `/efficient-fable` to any high-cost frontier model: delegate research, coding, and testing to cheaper subagents while keeping planning, synthesis, and final review with the expensive model.
---

# Efficient Frontier

Use the expensive frontier model where its marginal judgment matters. Push
repeatable, bounded, or token-heavy work to cheaper/faster subagents.

## Workflow

1. Identify the frontier-only decisions: architecture, prioritization,
   ambiguity resolution, risk, synthesis, and final review.
2. Identify delegable work: research scans, repository inventory, search, docs
   extraction, browser/testing passes, log reduction, test failure clustering,
   narrow coding, and mechanical edits.
3. Spawn parallel subagents for independent slices with clear ownership,
   bounded scope, verification gates, and expected evidence.
4. Require compact returns: findings, changed files, commands run, residual
   risk, stop conditions hit, and anything the frontier model must decide.
5. Integrate and review centrally before presenting the result.

## Handoff Packets

Write delegated prompts as self-contained packets. Assume the receiving agent
has not seen the conversation. Include the repo path, objective, scope,
out-of-scope areas, relevant files or search targets, expected return format,
verification commands, and stop conditions.

Useful stop conditions:

- The live code does not match the assumption in the handoff.
- A verification command fails twice after a reasonable fix or retry.
- The work appears to require files outside the assigned scope.
- The agent cannot produce concrete evidence for its claim.

## Review Loop

Treat delegated output as evidence to inspect, not a verdict to forward. Reopen
important cited files, skim high-risk diffs, and rerun or spot-check the
verification that matters before claiming completion. If delegated agents
disagree, resolve the disagreement at the frontier-model layer.

## Common Scenarios

Use these as soft suggestions:

- Research: delegate broad repo scans, docs extraction, and source comparison;
  the frontier model keeps the judgment about what matters.
- Coding: delegate bounded patches, refactors, or mechanical edits when file
  ownership is clear; integrate and review centrally.
- Testing: let the frontier model choose the validation strategy and scripts,
  then use cheaper agents to run unit checks, browser flows, screenshots, and
  log reduction. Ask them to return exact commands, failures, likely causes, and
  whether the signal looks flaky, environmental, or product-relevant.
- Debugging: send independent agents after separate theories, logs, or repro
  paths; keep the final diagnosis with the frontier model.

## Guardrails

- Do not delegate the immediate blocker if your next step depends on it.
- Do not ask multiple agents to edit the same files at the same time.
- Do not trust subagent conclusions blindly when the risk is high; inspect the
  important evidence yourself.
- Do not claim universal savings. The pattern works best when exploration and
  implementation, testing, or research can be parallelized.

## Default Framing

"I will use the frontier model as the orchestrator and reviewer, and use
cheaper subagents for token-heavy research, coding, or testing so the expensive
tokens go to judgment, synthesis, and final quality."
