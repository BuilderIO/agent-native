---
name: visual-questions
description: >-
  Use Agent-Native Plans to ask rich visual intake questions when
  /visual-questions is explicitly requested before creating a UI plan or visual
  plan.
metadata:
  visibility: both
---

# Visual Questions

Use `/visual-questions` when the next best step is not a plan yet, but a
reviewable visual intake: single-choice chips, multi-select chips, freeform
notes, mockup choices, sketch diagrams, and a generated answer summary that feeds
the next planning prompt. It composes with `/visual-plan`, `/ui-plan`,
`/prototype-plan`, `/plan-design`, and `/visualize-plan`.

## When To Use

- The user asks to be shown options before the agent writes a plan.
- UI direction, form factor, layout model, feature set, or visual style is fuzzy
  enough that 2-6 answers would materially change the plan.
- The user would benefit from choosing between visual mockups or diagrams rather
  than answering text-only prompts.

Gate hard: skip this for tiny, unambiguous changes. If the agent can reasonably
infer the answer, prefer `/ui-plan`, `/prototype-plan`, `/plan-design`, or
`/visual-plan` directly and put assumptions in the plan.

Visual questions are an explicit intake command, not an automatic preflight for
`/visual-plan`, `/ui-plan`, `/prototype-plan`, or `/plan-design`.

## Workflow

1. Call `create-visual-questions` with a clear title, brief, source, and repo
   path when known.
2. Omit `questions` for the default UI intake. Provide a custom `questions` array
   only when the task has domain-specific choices.
3. Surface the returned Plans link and ask the user to answer visually.
4. The generated summary drives the next step: `create-ui-plan` for static UI
   review, `create-prototype-plan` for click-through UI flows,
   `create-plan-design` for high-fidelity branded UI review,
   `create-visual-plan` for general plans, `visualize-plan` when a text plan
   already exists, or `update-visual-plan` with targeted `contentPatches` to
   fold answers into an active plan.
5. If the user leaves comments, call `get-plan-feedback` before using the answers.

## Question Types

Supported `questions` entries:

- `single`: chip group where one option wins.
- `multi`: chip group where multiple options can be selected.
- `freeform`: textarea for constraints, inspirations, or things to avoid.
- `visual`: visual options with sketch previews — use for layout direction, flow
  depth, surface choice, or diagram choices.

Each option can include `label`, `value`, `description`, `recommended`,
`preview`, and `bullets`. Valid `preview` values match the wireframe surfaces:
`desktop`, `mobile`, `popover`, `panel`, `component`, `split`, `flow`, and
`diagram`. Pick the preview that matches the real footprint — do not offer a
desktop/mobile pair for a popover, panel, or component.

## Quality Bar

- Ask only decision-changing questions. A beautiful form with low-value questions
  is still friction.
- Prefer visible, answerable options over abstract prose.
- Use visual tabs when users need to compare layout or flow shapes.
- Keep the output calm and document-like, not a landing page.
- The generated answer summary is not the final plan; it is the intake prompt for
  the next agent step.

## Tool Guidance

- `create-visual-questions`: create the interactive intake plan.
- `get-visual-plan`: inspect the current visual question plan.
- `get-plan-feedback`: read comments before creating or updating the next plan.
- `create-ui-plan`: create a UI-first plan from the answers.
- `create-prototype-plan`: create a prototype-first plan from the answers when
  interaction feel matters.
- `create-plan-design`: create a high-fidelity branded design plan from the
  answers when visual polish is the primary review input.
- `create-visual-plan`: create a general visual plan from the answers.
- `visualize-plan`: enrich an existing text plan after answers are gathered.
- `export-visual-plan`: export answer plans as HTML, Markdown fallback,
  structured JSON, and MDX files when the intake needs to be checked into a repo.
- `read-visual-plan-source` / `patch-visual-plan-source`: inspect or patch the
  MDX source if another agent is operating from checked-in plan files.

## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and
authenticates it in the same step (a one-time browser sign-in at setup — this is
intended), so the first tool call does not hit an OAuth wall:

```bash
agent-native skills add visual-plan
```

After that, `/visual-plan` (and `/ui-plan`, `/prototype-plan`, `/plan-design`,
`/visual-questions`, `/visualize-plan`) generate a plan and open the editor. Pass `--no-connect` to
register the connector without authenticating, then run
`agent-native connect https://plan.agent-native.com` whenever you are ready.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns `needs auth`, `Unauthorized`, or `Session terminated`,
do not keep retrying the tool. Authenticate the connector with
`agent-native connect https://plan.agent-native.com` (OAuth-capable hosts can
instead re-run /mcp and choose Authenticate), then continue once the connector
is available.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`. Do
not put shared secrets in skill files.
