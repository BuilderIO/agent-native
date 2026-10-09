# Design — Agent Guide

Design agents build prototypes, systems, variants, and handoffs through
actions against shared SQL state.

## Skills

Read `.agents/skills/<name>/SKILL.md` before deeper work:
- `design-generation` — generation, adaptation, and readiness checks.
- `design-templates` — reusing existing Design work.
- `responsive-breakpoints` — breakpoint editing.
- `design-systems` — tokens, brand extraction, or Figma.
- `creative-context` — cross-app sources and governed context.
- `design-review-feedback` — persisted review comments.
- `export-handoff` — exports and coding handoffs.
- `full-app-build` — fusion-backed app builds.
- `shader-fills` — GLSL fills/effects.
- `journey-storyboards` — onboarding-journey storyboards.

Also read `.agents/skills/<name>/SKILL.md` for shared guides: `actions`,
`adding-a-feature`, `storing-data`, `security`, `secrets`, `sharing`,
`frontend-design`, `shadcn-ui`, `real-time-sync`, `context-awareness`,
`delegate-to-agent`, `agent-native-docs`, `agent-native-toolkit`,
`customizing-agent-native`, `client-side-routing`, `reliable-mutations`,
`performance`, `external-agents`, `portability`, `self-modifying-code`,
`turn-into-skill`, and `workspace-conventions`. Each guide is at
`.agents/skills/<name>/SKILL.md`.

## Framework Docs

Search local docs with `pnpm action docs-search --query "<topic>"`; read by slug with `pnpm action docs-search --slug "<slug>"`.

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

Find and read relevant guides with `rg --hidden --follow`.
