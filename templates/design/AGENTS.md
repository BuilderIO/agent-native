# Design — Agent Guide

Design is an agent-native prototyping app. The agent creates and edits
complete interactive HTML prototypes, design systems, variants, and handoff
exports through actions against the shared SQL state.

## Skills

Read the relevant skill before deeper work in that area.

- `design-generation` — 5-phase generation flow, aesthetic quality bar, code
  layers/code workspace, editor extensions, breakpoints/screen
  states/components, motion, imagery, locked subtrees, generation state.
- `design-templates` — resolving, saving, copying, adapting templates or prior
  Design work without fresh generation.
- `responsive-breakpoints` — Framer-style breakpoint editing.
- `design-systems` — tokens, brand extraction, Figma import/read/paste, and the
  real Figma fidelity contract.
- `creative-context` — cross-app source reuse, pinned packs, provenance,
  context opt-out, submitting a design to a governed Context.
- `design-review-feedback` — persisted, element-anchored review comments to a
  verified close, one root thread at a time.
- `export-handoff` — HTML/PNG/SVG/ZIP/code and coding-handoff export.
- `full-app-build` — design source modes and flag-gated fusion-backed full app
  building.
- `shader-fills` — code-backed GLSL shader fills/effects.
- `capture-learnings` — record a user preference or correction so it outlives
  the thread.

## Actions

| Action | Purpose |
| --- | --- |
| `list-design-templates` / `list-designs` | Resolve a named template or prior design; paginated (`page`, `pageSize`, `createdBy: "me"`, `search`) |
| `create-design-from-template` | Copy a template into a new design; screens keep their `createdFromTemplate` locks |
| `get-design-snapshot` / `get-design-template` | Inspect a copied design's current files, or the original template |
| `open-visual-edit` | Open a running localhost app as live URL-backed iframe screens without a Design login |
| `add-localhost-screens` / `update-screen-source` | Add route/state screens or switch one selected screen between live URL and static HTML |
| `add-breakpoint` / `remove-breakpoint` | Manage responsive frames on the canvas |
| `edit-design` | Adapt an existing or copied design/screen in place |
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
- Design source modes are `inline`, `localhost`, and `fusion` — see
  `full-app-build`. Public `/visual-edit` and `/design/:id` links can render
  read-only without a session. Only the short-lived,
  design-scoped `capability:visual-edit` embed minted by `open-visual-edit`
  may perform its localhost screen, breakpoint, snapshot, and source actions;
  it is not an account session and cannot save/share/generate or access another
  design. Bare public links stay read-only. The page-local
  `get-visual-edit-prompt` tool returns the latest pending source handoff;
  account operations use `buildSignInReturnHref()`.

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
