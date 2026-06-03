---
name: visualize-plan
description: >-
  Convert an existing Codex, Claude Code, Markdown, or pasted plan into a
  Visual Plans companion with diagrams, wireframes, annotations, and proof gates.
metadata:
  visibility: exported
---

# Visualize Plan

Use this as the visual companion for an existing text plan. The native Codex or
Claude Code plan can stay exactly where it is; Visual Plans turns it into an
interactive HTML review surface with diagrams, wireframes, prototype options,
annotations, assumptions, and proof gates.

This is for impatient review. Default to things the user can scan and react to.

## Setup

Recommended install path:

```bash
npx @agent-native/core@latest skills add visual-plans
```

That installs both `visual-plans` and `visualize-plan`, and registers the
hosted Visual Plans MCP connector for the selected agent client. Add
`--client claude-code`, `--client codex`, or `--client all` when needed.

OAuth-capable hosts can add this remote MCP URL directly:

```text
https://plans.agent-native.com/_agent-native/mcp
```

## When To Use

Use `visualize-plan` when:

- the user has an existing Codex, Claude Code, Markdown, or pasted plan;
- the user asks to visualize, annotate, plannotate, mock up, diagram, or make a
  plan easier to review;
- the plan is long enough that the user may not read it closely;
- UI direction, architecture, data flow, risky assumptions, or proof gates would
  be clearer visually;
- the user wants feedback on wireframes, design/prototype options, diagrams, or
  tradeoffs before implementation.

If there is no existing plan text available, ask for it or use `visual-plans` to
create a fresh plan instead.

## Workflow

1. Gather the existing plan text from the user's paste, a referenced file, or
   the recent agent-visible plan. Do not invent a source plan.
2. Call `visualize-plan` with `planText`, `title`, `goal`, `source`, and
   `repoPath` when available.
3. Surface the returned Visual Plans link or inline MCP App.
4. Enrich the imported plan with `update-visual-plan` when helpful:
   - diagrams for architecture, data flow, state machines, or dependencies;
   - wireframes/mockups for user-visible UI changes;
   - two or three option cards when there are real tradeoffs;
   - small prototype sketches for interactions, states, or animation choices;
   - reviewable assumptions and open questions;
   - compact proof gates for tests, screenshots, CI, rollout, or rollback.
5. Ask the user to react in the visual plan. Then call `get-plan-feedback`
   before implementing, after review, and before final response.
6. Treat the imported text as source material. Structured Visual Plans state is
   canonical for feedback, assumptions, decisions, and proof.

## Visual Defaults

- Keep the first screen simple: plan summary, one primary visual, review queue.
- Prefer one strong diagram or wireframe over a wall of sections.
- Hide long prose behind disclosure controls or source references.
- Label inferred items as possible, not confirmed.
- Ask for feedback with targeted prompts: "Which option?", "Is this flow
  right?", "What assumption is wrong?", "What proof is missing?"
- Preserve native-agent momentum: this companion should make the plan easier to
  approve or revise, not force a giant planning ceremony.

## Guardrails

- Do not replace a native plan unless the user asks. Build beside it.
- Do not pretend the companion has feedback until `get-plan-feedback` returns
  it or the user pastes it back.
- Do not use visual polish as a substitute for clarity. The point is review.
- Do not hand-roll MCP HTTP requests with curl. Use host-exposed tools after
  restart/reload, or use the returned browser/deep-link fallback.
