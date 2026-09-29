# Design — Agent Guide

Design is an agent-native prototyping app. The agent creates and edits
interactive HTML prototypes, design systems, variants, and handoffs through
actions against shared SQL state.

## Skills

Read the relevant skill before deeper work in that area.

- `design-generation` — generation flow, quality bar, code layers/workspace,
  breakpoints, components, motion, imagery, locked subtrees, and state.
- `design-templates` — resolving, saving, copying, adapting templates or prior
  Design work without fresh generation.
- `responsive-breakpoints` — Framer-style breakpoint editing.
- `design-systems` — tokens, brand extraction, Figma import/read/paste, and
  fidelity requirements.
- `creative-context` — source reuse, pinned packs, provenance, opt-out, and
  governed Context submission.
- `design-review-feedback` — persisted, element-anchored review comments to a
  verified close.
- `export-handoff` — HTML/PNG/SVG/ZIP/code and coding handoffs.
- `full-app-build` — source modes and flag-gated fusion-backed app building.
- `shader-fills` — code-backed GLSL shader fills/effects.
- `capture-learnings` — record a user preference or correction so it outlives
  the thread.

## Actions

| Action | Purpose |
| --- | --- |
| `list-design-templates` / `list-designs` | Search paginated templates or designs |
| `generate-home-suggestions` | Personalized home prompts |
| `read-composer-source` | Read bounded Design, Slides, or Figma references |
| `create-design-from-template` | Copy a template into a new design; screens keep their `createdFromTemplate` locks |
| `get-design-snapshot` / `get-design-template` | Inspect a copied design's current files, or the original template |
| `open-visual-edit` | Open a localhost app as live iframe screens without Design login |
| `get-visual-edit-collaboration` / `update-visual-edit-collaboration` | Read/set snapshot opt-in; signed-in editors can enable it |
| `add-localhost-screens` / `update-screen-source` | Add routes/states or switch a screen between live URL and static HTML |
| `add-breakpoint` / `remove-breakpoint` | Manage responsive frames on the canvas |
| `edit-design` | Adapt an existing or copied design/screen in place |
| `apply-visual-edit` | Make deterministic layer edits; `booleanSubtract` creates an editable mask from supported selected sibling shapes |
| `create-design` | Start a new design (empty shell, `renderable: false`) |
| `generate-design` | Generate a fresh screen — never for a copied template screen |
| `present-design-variants` | Generate 2-5 variants for the user to pick and refine |
| `view-screen` | Re-read the current design or selected file when context is stale |
| `navigate` | Move the UI to a design, file, or panel |
| `export-png` | Export screen as PNG |
| `export-html` / `export-zip` / `export-coding-handoff` / `export-design-as-figma-svg` | Export a finished design |

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Use app actions for designs, files, versions, systems, variants, exports, and
  sharing; do not write design rows directly with SQL.
- A message beginning with `[Reprompt selection]` is preview-only: the only
  mutation path is `propose-node-rewrite`; never call a content writer.
  `[Selection question]` is read-only: answer about the captured element and
  subtree without calling content-writing actions.
- Generated files must be complete, standalone HTML (Alpine.js + Tailwind CDN)
  that renders in the iframe without a build step. See `design-generation` for
  the phases, quality bar, and the audit/screenshot pass required before
  calling a design "ready".
- Treat `data-agent-native-locked="true"` as authoritative — see
  `design-generation` for locked-subtree rules.
- Use `apply-visual-edit` with `intent.kind="booleanSubtract"` for two or more
  consecutive sibling rectangles or ellipses with absolute pixel geometry and
  solid fills. The first layer in source order supplies the result paint; the original
  operands remain editable under the Subtract layer. Other shapes, custom
  markup, non-solid paints, and non-sibling selections are not converted.
- Source modes are `inline`, `localhost`, and `fusion`; see `full-app-build`.
  Public `/design/:id` links are read-only; public
  `/visual-edit/:id` links allow DOM-only localhost edits, signed in or out.
  Source writes remain editor-gated. The design-scoped
  `capability:visual-edit` scopes localhost handoff actions, not an account
  session or access to other designs. Shared snapshots default off; only a
  signed-in editor can opt in and publish, and viewers get no snapshot while
  off. `get-visual-edit-prompt` returns the pending handoff; external agents
  call `get-visual-edit-pending`, browser agents use the page-local tool.

## Application State

- `navigation` — current view, design id, file id, and related UI state.
- `navigate` — moves the UI in the tab that asked; auto-deleted after the
  client consumes it.
- `design-selection` — active screen, selected element, overview mode,
  inspector tab, zoom, screen list, and `layoutGrid`.
- `design-generation-session:<designId>`, `show-questions`, `guided-questions` —
  generation planning, pre-generation questions, and the variant chat choice;
  see `design-generation`.
- `design-reprompt-pending:<designId>:<fileId>` /
  `design-reprompt-proposal:<designId>:<fileId>:<repromptId>` — the
  compare-and-set reprompt request/proposal pair. Both must be present and
  matched before `propose-node-rewrite`; a stale pair is never applied.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI. Editor behavior lives in
`app/pages/design-editor/commands/*.ts`, not `DesignEditor.tsx` — read
`design-editor-architecture` before changing it.
