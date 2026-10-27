# Design — Agent Guide

Build prototypes, systems, variants, and handoffs through actions and shared SQL.

## Skills

Read `.agents/skills/<name>/SKILL.md` as needed:
- `design-generation` — web prototype generation and readiness.
- `hubspot-email` — email creation, alignment, personalization, conversion and handoff.
- `design-templates` — reusing existing Design work.
- `responsive-breakpoints` — breakpoint editing.
- `design-systems` — tokens, brand extraction, or Figma.
- `creative-context` — cross-app sources and governed context.
- `design-review-feedback` — persisted review comments.
- `export-handoff` — exports, HubSpot email HTML validation, and coding handoffs.
- `full-app-build` — fusion-backed app builds.
- `native-effects` — WebGPU fills/effects, source edits, and PNG.
- `journey-storyboards` — onboarding-journey storyboards.

Shared guides: `actions`,
`adding-a-feature`, `storing-data`, `security`, `secrets`, `sharing`,
`frontend-design`, `shadcn-ui`, `real-time-sync`, `context-awareness`,
`delegate-to-agent`, `agent-native-docs`, `agent-native-toolkit`,
`customizing-agent-native`, `client-side-routing`, `reliable-mutations`,
`performance`, `external-agents`, `portability`, `self-modifying-code`,
`turn-into-skill`, and `workspace-conventions`.

## Framework Docs

Use `pnpm action docs-search --query "<topic>"` or `pnpm action docs-search --slug "<slug>"`.

## Actions

| Action | Purpose |
| --- | --- |
| sync-figma-screen | Check source drift, safely pull a one-sided source edit, or record a verified connected-tool write |
| sync-figma-comments | Idempotently import comment threads and publish eligible own comments |
| `list-design-templates` / `list-designs` | Search paged templates/designs |
| `generate-home-suggestions` | Suggest prompts |
| `read-composer-source` | Read bounded Design/Slides/Figma sources |
| `delete-file` | Delete a screen when requested |
| `create-design-from-template` | Copy template; source screens stay locked |
| `get-design-snapshot` / `get-design-template` | Inspect design or source template |
| `open-visual-edit` | Open localhost screens |
| `get-visual-edit-collaboration` / `update-visual-edit-collaboration` | Read/set collaboration opt-in |
| `add-localhost-screens` / `update-screen-source` | Add screens; change source mode |
| `add-session-replay-screenshots-to-board` | Add private replay screenshots |
| `stage-journey-canvas-frames` | Stage storyboard PNGs |
| `discard-journey-canvas-frame-import` | Discard staged storyboard import |
| `create-journey-canvas` | Create provenance-backed storyboard; see journey-storyboards |
| `add-breakpoint` / `remove-breakpoint` | Manage responsive frames |
| `edit-design` | Adapt a design/screen |
| `apply-visual-edit` | Apply deterministic layer edits |
| `get-motion-timeline` / `apply-motion-edit` / `remove-motion-timeline` | Read/edit/remove motion timelines |
| `create-design` / `generate-design` | Start empty design / generate a fresh screen |
| `present-design-variants` | Generate 2–5 variants |
| `view-screen` / `navigate` | Read current screen / move UI |
| `get-view-settings` / `update-view-settings` | Read/update view toggles |
| `get-shader` / `edit-native-shader` | Read/edit native effects |
| `get-native-shader-approvals` | Read effect approvals |
| `prepare-native-scene-export` | Pin scene for PNG |
| `get-native-render-contexts` / `request-native-local-export` / `get-native-local-export` | Export native PNG |
| `take-design-screenshot` / `export-png` | Inspect responsive images / export PNG |
| `export-html` / `export-hubspot-html` / `export-zip` / `export-coding-handoff` / `export-design-as-figma-svg` | Export finished work |

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for design data and writes; never write design rows directly with SQL.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- `[Reprompt selection]` is preview-only: only `propose-node-rewrite` may mutate. `[Selection question]` is read-only; answer without content-writing actions.
- Web files use standalone Alpine/Tailwind HTML. HubSpot email requests, including alignment and token edits, follow `hubspot-email`, which replaces web defaults. Preserve `data-agent-native-locked="true"` subtrees.
- Source modes are `inline`, `localhost`, and `fusion` (`full-app-build`). `/design/:id` is read-only; `/visual-edit/:id` allows DOM-only localhost edits. Source writes and snapshot publishing require editor access.
- `capability:visual-edit` scopes handoff actions. External agents use `get-visual-edit-pending`; browser agents use the page-local tool.

## Application State

- `navigation`: current view, design/file id, and related UI state.
- `visual-edit`: last project/connection; same-connection opens resume unless `newDesign` is true.
- `agent-selection`: screens and layers picked with Select; a `Selected objects` context block names the target set, so edit only those.
- `navigate`: transient request to move the requesting tab; deleted after consumption.
- `design-selection`: active screen/element, `activeFrameType` and screen `frameType` (`hubspot-email` or null), overview, inspector, zoom, `layoutGrid`; `motion` holds timeline, playback, auto-keyframe and selection.
- `design-generation-session:<designId>`, `show-questions`, `guided-questions`: generation planning and variant choice; see `design-generation`.
- `design-reprompt-pending:<designId>:<fileId>` and `design-reprompt-proposal:<designId>:<fileId>:<repromptId>` must be present and matched before `propose-node-rewrite`.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI. Editor behavior lives in `app/pages/design-editor/commands/*.ts`; read `design-editor-architecture` before changing it.

Search with `rg --hidden --follow`.
