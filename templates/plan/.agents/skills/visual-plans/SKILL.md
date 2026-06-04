---
name: visual-plans
description: >-
  Use Agent-Native Plans when coding-agent work needs an interactive HTML plan
  document with diagrams, wireframes, mockups, prototypes, annotations, and
  comments.
---

# Agent-Native Plans

Agent-Native Plans is HTML plan mode for coding agents. Generate the kind of
plan you would normally write in Markdown, but as a scannable HTML plan
document with visual blocks mixed in: diagrams, wireframes, mockups, prototype
options, tradeoff cards, file/symbol implementation maps, code previews, and
annotation prompts. It is a plan document, not a marketing page.

The goal is impatient review. The user should be able to react to visuals first
and read prose only where it helps.

## Install And Use

Users install Plans with the Agent-Native CLI:

```sh
agent-native skills add plans
```

That one command installs `/visual-plan`, `/ui-plan`, `/visual-questions`, and
`/visualize-plan` and registers the hosted MCP app connector for supported hosts
such as Claude Code and Codex.

Use `/visual-plan` for a fresh general plan. Use `/ui-plan` when the work is
primarily product UI and the review should start with high-fidelity screens and
states. Use `/visual-questions` when the agent should ask a visual intake form
before choosing the plan direction. Use `/visualize-plan` when there is already
a Codex, Claude Code, Markdown, or pasted text plan that should become an HTML
companion.

## Slash Commands

- `/visual-plan`: create a fresh rich HTML plan before implementation. Include
  a docs-level plan, visual architecture/flow diagrams, detailed wireframes or
  mockups when UI is involved, an implementation map with files/symbols/snippets,
  tradeoffs, open questions, and clear feedback prompts.
- `/ui-plan`: create a UI-first high-fidelity HTML plan before implementation.
  Use an optional top pan/zoom wireframe or diagram canvas when visuals clarify
  the flow, then continue as a refined Notion-like document with rich tabs,
  comments/drawing prompts, code tabs, and agent handoff notes.
- `/visual-questions`: create a rich visual intake questionnaire before a plan.
  Use this for chips, freeform answers, mockup choice tabs, sketch diagrams, and
  a generated answer summary that can feed `/ui-plan`, `/visual-plan`, or
  `/visualize-plan`.
- `/visualize-plan`: import an existing Codex, Claude Code, Markdown, or pasted
  text plan and turn it into a visual companion. Preserve the plan's intent,
  then add diagrams, wireframes, option cards, file/symbol maps, and annotation
  prompts.

## When To Use

Create or update a visual plan when:

- the user asks for a plan, HTML plan, visual plan, plannotate-style review,
  diagrams, wireframes, mockups, prototypes, comments, or annotations;
- work is multi-file, ambiguous, long-running, risky, or UI-heavy;
- the user is unlikely to read a long text plan closely;
- architecture, data flow, UI direction, options, or open questions would be
  clearer visually;
- you need the user to react before implementation.

## Plan Discipline

Plan mode protects the user from wasted work; it is not ceremony. Hold this
discipline before and around the plan document:

- **Right-size first.** Build a visual plan when work is multi-file, ambiguous,
  risky, architectural, UI-heavy, has multiple valid approaches, or the code is
  unfamiliar. Skip it for trivial, unambiguous work — typos, one-line fixes, a
  single well-specified function, anything whose diff you could describe in one
  sentence — and just make the change. A polished HTML plan is the most
  expensive plan form; only invest when a wrong direction is costly. Never pad a
  plan with filler or ship a single-step plan.
- **Research before you draft.** Read the real files, actions, schema, and
  existing patterns first, and name actual files, symbols, and data shapes in
  the plan instead of inventing them. Check existing `actions/` before proposing
  endpoints and prefer named client helpers over raw fetch. Delegate wide
  exploration to a sub-agent so the main context stays clear.
- **Planning is read-only.** Make no source edits while building or reviewing
  the plan. Start editing code only after the user approves the direction.
- **Clarify vs. assume.** Do not ask the user how to build it — explore and
  present the approach and options in the plan. Ask a clarifying question only
  when an ambiguity would change the design and you cannot resolve it from the
  code or a sensible default; batch a small set (2-4) of high-leverage,
  decision-changing questions before finalizing. Otherwise state the most
  reasonable assumption explicitly and proceed. Put anything still unresolved in
  a dedicated open-questions / needs-clarification block — never guess silently,
  and never fill it with detail you could infer.
- **Be specific.** Every plan states the objective and what "done" means,
  explicit scope and non-goals, ordered verifiable steps that name real files,
  symbols, and actions, the key choices with rationale, risks, and a closing
  verification step (tests, build, or a checkable behavior). Replace vague prose
  with specifics; never ship a step like "make it work."
- **The plan is the approval gate.** After surfacing the plan, explicitly ask
  the user to review and approve before you write any code, and name which
  files/areas and permissions the work will touch so approval grants scope.
  Presenting the plan and requesting sign-off is the approval step — do not ask
  a separate "does this look good?" question.
- **The document is the source of truth, not the chat.** When scope shifts
  during review or implementation, update the plan with `update-visual-plan`
  rather than only changing course in chat, and re-read the approved plan before
  major steps so the work does not drift.

## Core Workflow

1. Call `create-visual-plan` with the title, brief, source, repo path, and plan
   sections before implementation.
2. Put the best possible plan document in `html` when you can. It should feel
   like a bespoke HTML version of a strong Markdown implementation plan, not a
   dashboard or landing page.
3. Surface the returned Agent-Native Plans link or inline MCP App. In CLI hosts,
   ask the user to review the plan visually.
4. Call `get-plan-feedback` before editing, after review, after any long pause,
   and before final response.
5. Incorporate comments/corrections with `update-visual-plan`; update the HTML
   document when feedback changes the direction.
6. Export an HTML/JSON/Markdown receipt with `export-visual-plan` when the user
   wants a shareable artifact.

## Visual Defaults

- Use implementation-plan structure first: objective, scope/non-goals, proposed
  approach, phases or steps, files/symbols/snippets, risks, open questions, and
  validation.
- UI work gets wireframes, state mockups, or prototype sketches.
- When UI direction is the center of the work, prefer the `ui-plan` skill so the
  mockups, states, comments/drawing space, and agent handoff come before file
  implementation detail. Keep `visual-plans` general for architecture, backend,
  refactors, and mixed implementation planning.
- Wireframes should be concrete enough to critique: show layout regions,
  controls, states, empty/loading/error paths, review affordances, and copy
  placeholders. Avoid vague rectangle-only sketches.
- When showing multiple diagrams, wireframes, mockups, or design directions, use
  compact tabs so the plan stays readable. Use `data-plan-tabs`,
  `data-tab-target`, and `data-tab-panel`; the Plans iframe runtime will wire
  up the interaction.
- Backend/refactor work gets architecture, sequence, data-flow, or dependency
  diagrams.
- Complex tradeoffs get two or three option cards with consequences.
- Open questions are surfaced as visual callouts, not buried in paragraphs.
- Long prose is split into readable document sections with clear headings.
- Visuals should be review aids, not decoration. Avoid decorative hero art,
  gradient/hero backgrounds, brand/logo chrome, nav bars, slogans, fluffy value
  props, huge landing-page H1s, or marketing-style cards unless the user
  explicitly asks.
- Implementation plans include a file map: file path, symbols/components to
  touch, reason for the change, risk/coordination notes when relevant, and short
  syntax-highlighted snippets for the code shape the agent expects to modify.
- File previews should be concise and reviewable. Do not paste entire large
  files; show the key region, public API, component boundary, schema, action, or
  selector that matters for review.
- Include editor-open links where `repoPath` is known. Prefer explicit user
  clicks for opening VS Code/Cursor; never auto-open editor links.
- Include README-like details when helpful: command names, tool behavior,
  install flow, MCP/link fallback, data shape, and what is in or out of scope.
- Comments and corrections should feel plannotator-style: quick to add,
  structured enough for the agent to consume, and easy to share when the user
  chooses.

## Tool Guidance

- `create-visual-plan`: start one HTML plan per agent task/run.
- `create-ui-plan`: start a UI-first plan with high-fidelity screen/state tabs.
- `create-visual-questions`: start a visual intake questionnaire whose answers
  feed a UI plan, visual plan, or plan update.
- `visualize-plan`: create an HTML companion from an existing text plan.
- `update-visual-plan`: revise the plan document, sections, status, or comments.
- `get-visual-plan`: read the current plan document and annotations.
- `get-plan-feedback`: read unconsumed human feedback. Use it frequently.
- `export-visual-plan`: export HTML, Markdown fallback, and structured JSON.

## HTML Guidance

- Prefer semantic HTML with scoped CSS inside the document.
- Match Agent-Native's dark, restrained theme unless the user asks otherwise.
- Keep the first viewport legible and plan-like: title, brief, concise scope,
  and a useful diagram/checklist/table when it helps.
- Use tabs, accordions, or small interactions only when they make review faster.
- Do not paste huge HTML into chat. Store it in Plans and surface the MCP app or
  link.
- Hosted default: connect
  `https://plan.agent-native.com/_agent-native/mcp`. Do not put shared secrets
  in skill files.
