---
name: visual-questions
description: >-
  Use Agent-Native Plans to ask rich visual intake questions before creating a
  UI plan or visual plan.
metadata:
  visibility: both
---

# Visual Questions

Use `/visual-questions` when the next best step is not a plan yet, but a
reviewable visual intake: single-choice chips, multi-select chips, freeform
notes, mockup option tabs, sketch diagrams, and a generated answer summary that
feeds the next planning prompt.

This is a temporary, conservative command name for the first testable flow. It
is designed to compose with `/ui-plan`, `/visual-plan`, and `/visualize-plan`.

## When To Use

- The user asks to be shown options before the agent writes a plan.
- UI direction, form factor, layout model, feature set, or visual style is still
  fuzzy enough that 2-6 answers would materially change the plan.
- The user would benefit from choosing between visual mockups or diagrams rather
  than answering text-only terminal prompts.
- The next flow should be: answer questions -> create UI plan, answer questions
  -> create visual plan, or answer questions -> update/visualize an existing
  plan.

Skip this for tiny, unambiguous changes. If the agent can reasonably infer the
answer, prefer `/ui-plan` directly and put assumptions in the plan.

## Workflow

1. Call `create-visual-questions` with a clear title, brief, source, and repo
   path when known.
2. Omit `questions` for the default UI intake. Provide a custom `questions`
   array only when the task has domain-specific choices.
3. Surface the returned Plans link and ask the user to answer visually.
4. The user can click `Copy prompt` or `Send to agent`; that generated summary
   should drive the next step:
   - call `create-ui-plan` for UI flow plans;
   - call `create-visual-plan` for general visual plans;
   - call `visualize-plan` when the user already has a text plan;
   - call `update-visual-plan` when the active plan should absorb answers.
5. If the user leaves comments on the visual questionnaire, call
   `get-plan-feedback` before using the answers.

## Question Types

Supported `questions` entries:

- `single`: chip group where one option wins.
- `multi`: chip group where multiple options can be selected.
- `freeform`: textarea for constraints, inspirations, or things to avoid.
- `visual`: tabbed visual options with cards and sketch previews. Use this for
  layout direction, flow depth, mobile/desktop choices, or diagram choices.

Each option can include `label`, `value`, `description`, `recommended`,
`preview`, and `bullets`. Valid `preview` values are `desktop`, `mobile`,
`split`, `flow`, and `diagram`.

## Quality Bar

- Ask only decision-changing questions. A beautiful form with low-value
  questions is still friction.
- Prefer visible, answerable options over abstract prose.
- Use visual tabs when users need to compare layout/flow shapes.
- Keep the output calm and document-like, not a landing page.
- The generated answer summary is not the final plan; it is the intake prompt
  for the next agent step.

## Tool Guidance

- `create-visual-questions`: create the interactive intake plan.
- `get-visual-plan`: inspect the current visual question plan.
- `get-plan-feedback`: read comments before creating or updating the next plan.
- `create-ui-plan`: create a UI-first plan from the answers.
- `create-visual-plan`: create a general visual plan from the answers.
- `visualize-plan`: enrich an existing text plan after answers are gathered.
