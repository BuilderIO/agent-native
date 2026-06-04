---
name: visual-plans
description: >-
  Use Agent-Native Plans when coding-agent work needs an interactive HTML plan
  document with diagrams, wireframes, mockups, prototypes, annotations, and
  comments.
metadata:
  visibility: exported
---

# Agent-Native Plans

Agent-Native Plans is HTML plan mode for coding agents. Generate the kind of
plan you would normally write in Markdown, but as a polished, scannable HTML
document with visual blocks mixed in: diagrams, wireframes, mockups, prototype
options, tradeoff cards, and annotation prompts.

Install with the Agent-Native CLI. It adds the skills and MCP connector:

```bash
npx @agent-native/core@latest skills add plans
```

Then start typing `/visual-plan` for a fresh general plan, `/ui-plan` for a
UI-first high-fidelity plan, `/visual-questions` for visual intake before a
plan, or `/visualize-plan` to turn an existing Codex, Claude Code, Markdown, or
pasted plan into a visual companion.

## Slash Commands

- `/visual-plan`: create a fresh rich HTML plan before implementation. Include
  a docs-level plan, visual architecture/flow diagrams, detailed wireframes or
  mockups when UI is involved, tradeoffs, open questions, and clear feedback
  prompts.
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
  then add diagrams, wireframes, option cards, and annotation prompts.

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

## Workflow

1. Call `create-visual-plan` with a title, brief, source, repo path, sections,
   and ideally a complete bespoke `html` document.
2. Surface the returned inline MCP App or browser link.
3. Ask the user to react to diagrams, wireframes, mockups, options, and open
   questions.
4. Call `get-plan-feedback` before implementation and after review.
5. Use `update-visual-plan` to revise the plan document or comments.

## Tools

- `create-visual-plan`
- `create-ui-plan`
- `create-visual-questions`
- `visualize-plan`
- `update-visual-plan`
- `get-visual-plan`
- `get-plan-feedback`
- `export-visual-plan`

## Quality Bar

- Wireframes must be concrete enough to critique: layout regions, controls,
  states, empty/loading/error paths, review affordances, and copy placeholders.
- Use `/ui-plan` when UI direction is the center of the work. `/visual-plan`
  stays the general plan command for architecture, backend, refactors, and
  mixed implementation planning.
- Include README-like details when helpful: command names, tool behavior,
  install flow, MCP/link fallback, data shape, and what is in or out of scope.
- Avoid vague rectangle-only sketches and generic dashboards.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`.
