---
name: visual-plans
description: >-
  Use Visual Plans for coding-agent work that needs an interactive HTML plan,
  diagrams, wireframes, prototype options, annotations, implementation tasks,
  feedback, and proof gates through the hosted Visual Plans MCP app.
metadata:
  visibility: exported
---

# Visual Plans

Use Visual Plans as HTML plan mode for coding work. The point is not to create a
prettier Markdown plan. The point is to give the user something visual to react
to before the agent edits code: diagrams, wireframes, option cards, clickable
prototype sketches, assumptions, tasks, annotations, and proof gates.

Text is the fallback layer. Default to visual artifacts.

## Setup

Recommended install path:

```bash
npx @agent-native/core@latest skills add visual-plans
```

That installs these instructions and registers the hosted Visual Plans MCP
connector for the selected agent client. Add `--client claude-code`,
`--client codex`, or `--client all` when needed.

OAuth-capable hosts can add this remote MCP URL directly:

```text
https://plans.agent-native.com/_agent-native/mcp
```

The legacy `contracts` skill name should be treated as an alias for Visual
Plans.

## When To Use

Create or update a visual plan when:

- the user asks for a plan, visual plan, HTML plan, plannotate-style review,
  diagrams, wireframes, mockups, prototype options, comments, or annotations;
- work is multi-file, ambiguous, long-running, risky, or UI-heavy;
- the user needs to react quickly to direction rather than read prose;
- the task touches auth, billing, migrations, public APIs, tests, production
  config, data, security, permissions, or deploy behavior;
- you would otherwise proceed on a material assumption;
- you are about to claim the work is complete and need proof gates checked.

## Core Workflow

1. Call `create-visual-plan` with the goal, source, repo path, and initial
   plan nodes before implementation.
2. Surface the returned Visual Plans link or inline MCP App. In CLI hosts, tell
   the user to open the link and review the visual plan.
3. Prefer diagrams, wireframes, UI mockups, option cards, and small interactive
   prototypes over paragraphs.
4. Call `get-plan-feedback` before editing, after review, after any long pause,
   and before the final response.
5. If the user comments, accepts, rejects, corrects, or requests proof, consume
   the structured feedback and update the implementation plan accordingly.
6. If new facts require a change after approval, create an amendment or
   deviation with `update-visual-plan` instead of drifting silently.
7. Attach command/test/log/diff/screenshot/design artifacts with
   `record-plan-evidence`. Agent claims are not proof.
8. Export an HTML/JSON/Markdown receipt with `export-visual-plan` when the user
   wants a shareable summary.

## Visual Defaults

- UI work gets wireframes or prototype options before coding.
- Backend/refactor work gets architecture and data-flow diagrams.
- Complex tradeoffs get two or three option cards with consequences.
- Assumptions are shown as reviewable visual callouts, not hidden prose.
- Proof gates stay compact: what must pass, current evidence, and missing proof.
- Long prose is collapsed behind the visual plan.

## Tool Guidance

- `create-visual-plan`: start one visual plan per agent task/run.
- `update-visual-plan`: bulk add/update plan nodes, options, assumptions,
  decisions, tasks, risks, deviations, annotations, and proof gates.
- `get-visual-plan` and `get-plan-review-queue`: read current plan state.
- `get-plan-feedback`: read unconsumed human feedback. Use it frequently.
- `record-plan-progress`: update phase/status and mark feedback consumed only
  after you incorporated it.
- `record-plan-evidence`: attach artifacts and provenance. Use high trust for
  captured commands/tests/CI, human_confirmed for explicit human confirmation,
  and low trust for agent-only statements.
- `analyze-visual-plan`: import pasted Markdown/text and create possible visual
  plan nodes. Treat detections as possible, not authoritative.

## Guardrails

- Keep it simple. Do not build a ten-tab dashboard unless the user asks.
- Do not log every trivial inference. Material assumptions affect behavior,
  data model, security, billing, public API, migrations, tests, architecture,
  deployment, file scope, or definition of done.
- Never modify tests merely to make implementation pass unless the visual plan
  explicitly approves test expectation changes.
- If proof is missing, say so. Do not call the task complete just because code
  changed.
- Do not hand-roll MCP HTTP requests with curl. Use host-exposed tools after
  restart/reload, or use the returned browser/deep-link fallback.
- Do not put shared secrets in skill files. Auth belongs in the MCP host.
