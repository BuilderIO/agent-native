# Design — Agent Guide

Design agents build prototypes, systems, variants, and handoffs through
actions against shared SQL state.

## Skills

Read guides before deeper work:
- `.agents/skills/design-generation/SKILL.md` — for generation, adaptation, and readiness checks.
- `.agents/skills/design-templates/SKILL.md` — when reusing existing Design work.
- `.agents/skills/responsive-breakpoints/SKILL.md` — for breakpoint editing.
- `.agents/skills/design-systems/SKILL.md` — for tokens, brand extraction, or Figma.
- `.agents/skills/creative-context/SKILL.md` — for cross-app sources and governed context.
- `.agents/skills/design-review-feedback/SKILL.md` — for persisted review comments.
- `.agents/skills/export-handoff/SKILL.md` — for exports and coding handoffs.
- `.agents/skills/full-app-build/SKILL.md` — for fusion-backed app builds.
- `.agents/skills/shader-fills/SKILL.md` — for GLSL fills/effects.
- `.agents/skills/journey-storyboards/SKILL.md` — for onboarding-journey storyboards.

`.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`,
`.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/performance/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`,
`.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query "<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

## Actions

| Action | Purpose |
| --- | --- |
| `list-design-templates` / `list-designs` | Search paged templates/designs |
| `generate-home-suggestions` | Suggest prompts |
| `read-composer-source` | Read bounded Design/Slides/Figma sources |
| `create-design-from-template` | Copy template; source screens stay locked |
| `get-design-snapshot` / `get-design-template` | Inspect design or source template |
| `open-visual-edit` | Open localhost screens |
| `get-visual-edit-collaboration` / `update-visual-edit-collaboration` | Read/set collaboration opt-in |
| `add-localhost-screens` / `update-screen-source` | Add screens; change source mode |
| `add-session-replay-screenshots-to-board` | Add private Analytics replay screenshots to a Design board |
| `stage-journey-canvas-frames` | Stage native PNGs in Design-owned private blob storage in resumable batches |
| `discard-journey-canvas-frame-import` | Remove an abandoned staged frame import and queue its private blobs for cleanup |
| `create-journey-canvas` | Draw a storyboard with replay provenance, last-observed-step stubs, and reference-only chains without cohort metrics |
| `add-breakpoint` / `remove-breakpoint` | Manage responsive frames |
| `edit-design` | Adapt a design/screen |
| `apply-visual-edit` | Apply deterministic layer edits |
| `create-design` / `generate-design` | Start empty design / generate a fresh screen |
| `present-design-variants` | Generate 2–5 variants |
| `view-screen` / `navigate` | Read current screen / move UI |
| `get-view-settings` / `update-view-settings` | Read/set the user's saved editor view toggles (pixel grid, snap, rulers, cursors, hidden comments) |
| `export-png` | Export PNG |
| `export-html` / `export-zip` / `export-coding-handoff` / `export-design-as-figma-svg` | Export finished work |

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for design data and writes; never write design rows directly with SQL.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- `[Reprompt selection]` is preview-only: only `propose-node-rewrite` may mutate. `[Selection question]` is read-only; answer without content-writing actions.
- Generated files are complete standalone HTML (Alpine.js + Tailwind CDN), rendered without a build step. Follow `design-generation` for its quality/audit pass and `data-agent-native-locked="true"` for locked subtrees.
- Source modes are `inline`, `localhost`, and `fusion` (`full-app-build`). `/design/:id` is read-only; `/visual-edit/:id` allows DOM-only localhost edits. Source writes and snapshot publishing require editor access.
- `capability:visual-edit` scopes handoff actions. External agents use `get-visual-edit-pending`; browser agents use the page-local tool.

## Application State

- `navigation`: current view, design/file id, and related UI state.
- `visual-edit`: last project/connection; same-connection opens resume unless `newDesign` is true.
- `navigate`: transient request to move the requesting tab; deleted after consumption.
- `design-selection`: active screen/element, overview, inspector, zoom, screen list, and `layoutGrid`.
- `design-generation-session:<designId>`, `show-questions`, `guided-questions`: generation planning and variant choice; see `design-generation`.
- `design-reprompt-pending:<designId>:<fileId>` and `design-reprompt-proposal:<designId>:<fileId>:<repromptId>` must be present and matched before `propose-node-rewrite`.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI. Editor behavior lives in `app/pages/design-editor/commands/*.ts`; read `design-editor-architecture` before changing it.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
