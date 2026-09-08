---
name: plan-authoring-flow
description: >-
  Which Plan command and creation action fits a request — document-first,
  UI-first, prototype-first, design-first, recap, or visual intake — plus how to
  raise an existing plan to design fidelity. Use when creating, routing, or
  re-rendering a plan.
---

# Plan Authoring Flow

The plan skills carry the shared Wireframe & Canvas and Document Quality cores,
so those rules are not restated in `AGENTS.md`. When the user critiques a plan's
look or structure, fix the renderer or the sync-guarded skills (not just one
stored plan) so the improvement sticks.

## Plan Content

Surface material assumptions only when they change behavior, data, security,
tests, deployment, or definition of done.

## Wireframe Markup

New canvas wireframes must use `<Screen html={...} />` / `data.html` semantic
HTML. Nested kit-tree nodes such as `FrameScreen`, `Card`, `Row`, and `Btn` are
legacy compatibility only and should not be authored for new plans/recaps.

## Normal Planning Flow

`/visual-plan` is the main command. Treat it like the host agent's standard
planning mode: inspect the codebase, use parallel agents when useful, gather the
information needed, ask clarifying questions through the host's native
ask-user-question tools when needed, then call `create-visual-plan` to publish
the plan. When the user pasted, referenced, or already has a Codex / Claude Code
/ Markdown plan, keep `/visual-plan` as the command and pass the source text to
`create-visual-plan` as `planText` so the new review surface builds from what
they already have.

For UI-first work where the plan leads with product screens, use `/visual-plan`
and call `create-ui-plan`.

For prototype-first work — when the user needs to operate the behavior before
implementation — use `/visual-plan` and call `create-prototype-plan`. Prototype
plans must be functional review surfaces with local state and realistic controls;
do not pass off static screen-to-screen navigation as a prototype. Keep static
mocks in the document and use the top viewer for functional review, comments,
rough/clean mode, dark/light mode, and prototype popout.
(`create-prototype-plan` is an MCP tool reached from `/visual-plan`, not a
separate slash command.)

For full-fidelity branded UI design before implementation, use `/visual-plan` and
call `create-plan-design`. Research the real app shell, `design.md` if present,
`.fig` brand-kit/design-system data when available, and codebase CSS/Tailwind/
token signals. Pass high-fidelity bounded HTML/CSS screens for the Design tab,
stable `data-design-id` attributes for targeted element style edits, and
transitions only when a matching Prototype tab should be clickable. Treat the
Design tab as the visual source of truth and the Prototype tab as the same
direction made interactive. (`create-plan-design` is an MCP tool reached from
`/visual-plan`, not a separate slash command.)

Treat “higher fidelity,” “pixel-accurate,” “polished mockup,” “production-like,”
“real design,” and “not a sketch/wireframe” as design-first requests, even when
the prompt also says “mockup.” For an existing plan, do not create a duplicate:
call `update-visual-plan` on the same plan id with a
`set-visual-render-mode` patch using `renderMode: "design"`, and replace or patch
the affected screen HTML/CSS in the same update. Put scoped styles in each
screen's `css` field, never in `<style>` tags. Merely switching the viewer-local
Clean toggle removes rough.js for one browser but does not create a high-fidelity
artifact.

Use `/visual-recap` when the user wants a high-level review surface for a PR,
commit, branch, or git diff that already changed. Recaps are reverse plans:
derive blocks from the real diff, call `create-visual-recap` with the recap
MDX source, publish it as a review aid, and state that reviewers still need to
inspect the actual changed lines.

The markdown/document portion should stay close to the plan the agent would
normally produce. Diagrams, wireframes, mockups, annotations, and an optional
bottom `question-form` Open Questions block are additive review aids, not a
separate intake flow.

Do not automatically call `create-visual-questions` from `/visual-plan`. If a
normal plan has answerable unresolved decisions, keep them in the same plan as a
bottom `question-form` block with single-choice, multi-choice, or freeform
questions, recommended options when useful, and wireframe/diagram previews for
visual directions. If the user explicitly requests a visual intake questionnaire
before planning, call `create-visual-questions` from `/visual-plan`.
(`create-visual-questions` is an MCP tool reached from `/visual-plan`, not a
separate slash command.)

## Related Skills

- **visual-plan** — the canonical `/visual-plan` skill, carrying the shared
  Wireframe & Canvas and Document Quality cores.
- **visual-recap** — `/visual-recap` recap generation.
- **plan-hosted-writes** — session, revision guard, and post-write verification
  for every plan write this flow performs.
- **plan-review-recaps** — recap comparison blocks and the PR recap workflow.
