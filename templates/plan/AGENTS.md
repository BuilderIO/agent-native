# Agent-Native Plan — Agent Guide

Agent-Native Plan is a local-first structured visual plan mode for coding
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
  `prototype.mdx` for optional Prototype/PrototypeScreen/PrototypeTransition
  markup, `canvas.mdx` for optional DesignBoard/Section/Artboard/Screen/
  Annotation/Connector markup, optional `assets/`, and optional
  `.plan-state.json`.
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
the plan. When the user pasted, referenced, or already has a Codex / Claude Code
/ Markdown plan, keep `/visual-plan` as the command and pass the source text to
`create-visual-plan` as `planText` so the new review surface builds from what
they already have.

For UI-first work where the plan leads with product screens, use `/visual-plan`
and call `create-ui-plan`.

For prototype-first work — when the user needs to click through states or review
the feel of an interaction before implementation — use `/visual-plan` and call
`create-prototype-plan`. Call `convert-visual-plan-to-prototype` when an
existing visual plan has HTML canvas wireframes that should become a live
prototype. Prototype plans keep static mocks in the document and use the top
viewer for clickable review, comments, rough/clean mode, dark/light mode, and
prototype popout. (`create-prototype-plan` and `convert-visual-plan-to-prototype`
are MCP tools reached from `/visual-plan`, not separate slash commands.)

For full-fidelity branded UI design before implementation, use `/visual-plan` and
call `create-plan-design`. Research the real app shell, `design.md` if present,
`.fig` brand-kit/design-system data when available, and codebase CSS/Tailwind/
token signals. Pass high-fidelity bounded HTML/CSS screens for the Design tab,
stable `data-design-id` attributes for targeted element style edits, and
transitions only when a matching Prototype tab should be clickable. Treat the
Design tab as the visual source of truth and the Prototype tab as the same
direction made interactive. (`create-plan-design` is an MCP tool reached from
`/visual-plan`, not a separate slash command.)

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

## Skills

The plan skills own all planning behavior. Read the matching SKILL.md before
generating or editing a plan — they carry the shared Wireframe & Canvas and
Document Quality cores, so do not restate those rules here.

- `.agents/skills/visual-plan/SKILL.md` — `/visual-plan`, the canonical slash
  command for any rich plan; also governs the MCP-tool modes: UI-first
  (`create-ui-plan`), prototype-first (`create-prototype-plan`), design-first
  (`create-plan-design`), and visual-intake (`create-visual-questions`).
- `.agents/skills/visual-recap/SKILL.md` — `/visual-recap`, high-level visual
  code-review recaps for PRs, commits, branches, and git diffs.

When the user critiques a plan's look or structure, fix the renderer or the
sync-guarded skills (not just one stored plan) so the improvement sticks.

## Review Recaps

- `columns` is the generic before/after layout primitive for structured
  comparisons. Use it for side-by-side schema, API, prose, and model blocks.
- The PR Visual Recap GitHub Action runs the `visual-recap` skill on each PR via
  an LLM coding agent (Claude Code or Codex, chosen with `VISUAL_RECAP_AGENT`;
  model and reasoning depth via `VISUAL_RECAP_MODEL` / `VISUAL_RECAP_REASONING`)
  when `PLAN_RECAP_TOKEN` and the backend's API key are configured, shows a
  non-required `Visual Recap` check while it runs, then posts a sticky comment
  with an inline screenshot. The recap is informational and must not imply the
  diff has been reviewed.

## Source Sync

- Use `export-visual-plan` or `read-visual-plan-source` when a user or external
  agent wants plan files to check into a repo.
- Use `import-visual-plan-source` to create or replace a plan from an MDX folder.
- Use `patch-visual-plan-source` for small source edits by stable semantic IDs.
  It patches the MDX AST, runs formatting, parses back to normalized JSON, and
  persists the runtime model. Prefer this over regenerating a whole plan when the
  requested change is a few lines, one annotation, one artboard, or one
  wireframe node.
- In Agent Native Desktop, the Plan menu can link a user-chosen local folder for
  the current plan, write the exported MDX files to it, import local edits back
  through `import-visual-plan-source`, and optionally auto-export whenever the
  hosted plan changes. This is a native desktop bridge; it does not require a
  cloned Plan app or CLI process.
- Do not fork the vocabulary. MDX components must map to the same runtime terms:
  `DesignBoard`, `Section`, `Artboard`, `Screen`, `Annotation`, `Connector`, and
  the wireframe kit primitives from `shared/plan-content.ts`.

## Version History

- Plans keep DB-backed snapshots before meaningful authoring changes. Pure
  comments, feedback replies, and comment status changes do not create history
  snapshots.
- Use `list-plan-versions` to see saved snapshots for a plan, and
  `get-plan-version` to inspect one full snapshot before recommending a
  rollback.
- Use `restore-plan-version` only when the user asks to restore or roll back.
  The current plan is snapshotted first with `Before restore`, so restore is
  reversible. Restore preserves sharing, ownership, hosted publish metadata,
  comments, and activity history; it restores the plan's authoring content and
  legacy sections.

## Browser Editing

- Prose in `rich-text` blocks is edited inline with the shared
  `RichMarkdownEditor`, autosaved through `update-visual-plan` with
  `contentPatches: [{ op: "update-rich-text", blockId, markdown }]`.
- Review annotation mode makes prose temporarily read-only so clicks can pin
  feedback. Leaving review mode restores inline prose editing.
- Canvas, artboard, wireframe, diagram, and custom visual edits remain driven by
  comments, source patches, or structured content patches rather than direct
  rich-text editing.
- Design-mode artboards can be element-edited with `update-visual-plan`
  `contentPatches: [{ op: "update-design-element-style", frameId, blockId,
elementId, styles }]`. Elements must have `data-design-id` or
  `data-plan-design-id`; use `patch-wireframe-html` / `patch-prototype-html` for
  structural or text changes.
- Plan comments include reviewer identity, @mentions, resolver intent
  (`agent` or `human`), exact anchors, and Figma-style threads. When adding
  human feedback through `update-visual-plan`, preserve `authorEmail` and
  `authorName` when known; pass `parentCommentId` to reply inline to an
  existing comment thread. Text feedback should anchor to the nearest prose
  block, and visual/canvas feedback should include target coordinates plus
  concise surrounding context.
- Use `delete-plan-comment` only when the user explicitly asks to remove a
  comment, undo an accidental comment, or clean up an obsolete thread. Deleting
  is a soft delete: normal comment views hide the comment while the database row
  remains for audit/debugging. Deleting a thread root also deletes its replies.
  When feedback has merely been handled, prefer `resolve-plan-comment` and
  `consume-plan-feedback` so review history remains visible.
- `get-plan-feedback` returns flat comments, grouped threads, anchor summaries,
  detailed anchor lines, and recent review events that describe the edit/comment
  delta. Use those fields before changing code or updating the plan, especially
  to distinguish comments the agent should act on from comments intended for a
  human reviewer.
- **Anchor interpretation.** `targetX`/`targetY` are percentages within the
  named element; bare `x`/`y` are percentages of the whole document;
  `canvasX`/`canvasY` are board-world pixels. Wireframe anchors carry
  `targetNodeId`/`targetNodePath` — prefer those over raw coordinates; fall back
  to coordinates plus the focused screenshot only when no node id is present.
  Resolve `textQuote` with `contextBefore`/`contextAfter`; if `ambiguous: true`,
  ask the user. Threads in `detachedThreads` no longer match current prose —
  reconcile, never drop. Act on `resolutionTarget=agent`; treat `human` as
  context only; `@mentions` are notification signals, not routing. Mark ingested
  comments consumed (`consumedCommentIds`); set `status=resolved` only on
  agent-targeted comments you actually addressed.
- New human comments send best-effort transactional email when email is
  configured: root comments and replies notify the plan owner, @mentioned
  members, and replies also notify prior human participants in that thread.
  Reuse the shared `renderEmail` template; do not invent a separate
  plan-specific email style.
- `report-visual-plan` records a bounded abuse report for a public plan or recap
  without changing plan content. It requires the caller to be scoped to an
  accessible public plan, accepts a fixed reason plus optional short details,
  and updates an existing open report from the same reporter instead of creating
  duplicate rows.

## Events

The plan app emits four events on the framework event bus: `plan.created`,
`plan.commented`, `plan.published`, and `plan.status.changed`. Automations can
subscribe to any of them — if a user asks to "notify me when someone comments"
or similar, call `manage-automations` with `action=define` (trigger `plan.commented`,
optional condition on `resolutionTarget`) rather than writing bespoke integration
code. See the `automations` skill and the [Visual Plans events docs](/docs/template-plan#events)
for payload schemas and recipe examples.

Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `storing-data`, `real-time-sync`, `security`, `delegate-to-agent`,
`frontend-design`, `shadcn-ui`, and `self-modifying-code`.
