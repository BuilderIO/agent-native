# Agent-Native Plans — Agent Guide

Agent-Native Plans is a local-first structured visual plan mode for coding
agents. Its job is to turn agent plans into editable rich blocks, diagrams,
wireframes, prototype options, annotations, and comments that a person can
review before code changes happen.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Follow the root framework rules: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Use actions for app operations and keep frontend/API parity.
- Keep database code provider-agnostic and additive.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- For new features, update UI, actions, skills/instructions, and application
  state when applicable.
- Default to structured visual artifacts over long Markdown. Text is one block
  type, not the whole plan.
- Current app actions require a real user session so plans stay scoped and
  shareable. Local development can use the framework's auto-created dev account;
  hosted persistence, private sharing, reviewer links, and cross-device/team
  workflows use account login, with Google sign-in shown when the standard
  Google OAuth env vars are configured.
- Runtime plan content is normalized JSON in SQL. MDX is the source-control
  surface: `plan.mdx` for frontmatter plus markdown/document blocks,
  `canvas.mdx` for optional DesignBoard/Section/Artboard/Screen/Annotation/
  Connector markup, optional `assets/`, and optional `.plan-state.json`.
- Surface material assumptions only when they change behavior, data, security,
  tests, deployment, or definition of done.
- Before edits, read pending feedback with `get-plan-feedback`.

## Application State

- `navigation.view` is `plans`, `plan`, `extensions`, or `team`.
- `navigation.planId` identifies the active visual plan when present.
- `navigate` moves the UI to the plan list or a specific visual plan.

## Normal Planning Flow

`/visual-plan` is the main command. Treat it like the host agent's standard
planning mode: inspect the codebase, use parallel agents when useful, gather the
information needed, ask clarifying questions through the host's native
ask-user-question tools when needed, then call `create-visual-plan` to publish
the plan.

The markdown/document portion should stay close to the plan the agent would
normally produce. Diagrams, wireframes, mockups, and annotations are additive
review aids, not a separate intake flow.

Do not automatically call `create-visual-questions` from `/visual-plan` or
`/ui-plan`. If the user types `/visual-questions`, treat it as an explicit visual
intake command before a later plan.

## Skills

The plan skills own all planning behavior. Read the matching SKILL.md before
generating or editing a plan — they carry the shared Wireframe & Canvas and
Document Quality cores, so do not restate those rules here.

- `.agents/skills/visual-plan/SKILL.md` — `/visual-plan`, the canonical command
  for any rich plan.
- `.agents/skills/ui-plan/SKILL.md` — `/ui-plan`, UI-first work that starts with
  the screens.
- `.agents/skills/visual-questions/SKILL.md` — `/visual-questions`, visual intake
  before a plan.
- `.agents/skills/visualize-plan/SKILL.md` — `/visualize-plan`, a companion for
  an existing Codex / Claude Code / Markdown / pasted plan.

When the user critiques a plan's look or structure, fix the renderer or the
sync-guarded skills (not just one stored plan) so the improvement sticks.

## Source Sync

- Use `export-visual-plan` or `read-visual-plan-source` when a user or external
  agent wants plan files to check into a repo.
- Use `import-visual-plan-source` to create or replace a plan from an MDX folder.
- Use `patch-visual-plan-source` for small source edits by stable semantic IDs.
  It patches the MDX AST, runs formatting, parses back to normalized JSON, and
  persists the runtime model. Prefer this over regenerating a whole plan when the
  requested change is a few lines, one annotation, one artboard, or one
  wireframe node.
- Do not fork the vocabulary. MDX components must map to the same runtime terms:
  `DesignBoard`, `Section`, `Artboard`, `Screen`, `Annotation`, `Connector`, and
  the wireframe kit primitives from `shared/plan-content.ts`.

## Browser Editing

- Prose in `rich-text` blocks is edited inline with the shared
  `RichMarkdownEditor`, autosaved through `update-visual-plan` with
  `contentPatches: [{ op: "update-rich-text", blockId, markdown }]`.
- Review annotation mode makes prose temporarily read-only so clicks can pin
  feedback. Leaving review mode restores inline prose editing.
- Canvas, artboard, wireframe, diagram, and custom visual edits remain driven by
  comments, source patches, or structured content patches rather than direct
  rich-text editing.
- Plan comments include reviewer identity and Figma-style threads. When adding
  human feedback through `update-visual-plan`, preserve `authorEmail` and
  `authorName` when known; pass `parentCommentId` to reply inline to an
  existing comment thread. `get-plan-feedback` returns both flat comments and
  grouped threads for multi-reviewer triage.
- New human comments send best-effort transactional email when email is
  configured: root comments and replies notify the plan owner, and replies also
  notify prior human participants in that thread. Reuse the shared `renderEmail`
  template; do not invent a separate plan-specific email style.

Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `storing-data`, `real-time-sync`, `security`, `delegate-to-agent`,
`frontend-design`, `shadcn-ui`, and `self-modifying-code`.
