# Design — Agent Guide

Design is an agent-native prototyping app. The agent creates and edits
complete interactive HTML prototypes, design systems, variants, and handoff
exports through actions against the shared SQL state.

Keep this file essential — it is loaded into the agent's context every turn.
Real depth lives in `.agents/skills/`; read the relevant skill before deeper
work in that area.

Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Use
`customizing-agent-native` for the configure → compose → eject → propose seam
ladder.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use the app actions for designs, files, versions, design systems, variants,
  export, and sharing. Do not write design rows directly with SQL.
- A message beginning with `[Reprompt selection]` is preview-only: call
  `propose-node-rewrite` with its exact `repromptId`, target, and base hash;
  never call a content writer (`edit-design`, `generate-design`,
  `apply-visual-edit`, ...) — only the frontend-only `resolve-node-rewrite`
  persists an accepted proposal (see `visual-edit`'s "Select And Reprompt").
  `[Selection question]` is read-only: answer about the captured element and
  subtree without calling content-writing actions.
- Call `view-screen` before editing a specific design if the current design or
  selected file is not already clear from context.
- Generated files must be complete, standalone HTML (Alpine.js + Tailwind CDN)
  that renders in the iframe without a build step. See `design-generation` for
  the full generation workflow — phases, the aesthetic quality bar, and the
  audit/screenshot pass required before calling a design "ready".
- Treat `data-agent-native-locked="true"` as authoritative: locked elements
  and descendants stay byte-for-byte unchanged (server-enforced). Ask the user
  to unlock the layer in the Layers panel if they want it changed.
- Figma import/read/paste and design-system/token workflows
  (`import-figma-frame`, `get-figma-design-context`, `list-figma-library-assets`,
  clipboard paste, `.fig` upload) are fully covered in `design-systems` — read
  it before guessing the calling convention. Never claim universal lossless
  Figma import/export; consult `FIGMA_INTEROPERABILITY.md` for the real
  fidelity contract. For open-ended GitHub/Figma API questions, use
  `provider-api-catalog`/`provider-api-docs`/`provider-api-request` rather than
  treating provider actions as a capability ceiling; non-read Figma requests
  need human approval.
- Persist useful work early: create/update the design and files as soon as a
  coherent candidate exists, then iterate.
- In dev, call actions with `pnpm action <name>`; in production, call the
  native tool.
- For shared prototype feedback, use the persisted review actions
  (`get-review-feedback`, `create-review-comment`, `resolve-review-thread`, ...)
  — read `design-review-feedback` for the one-thread-at-a-time loop.
- Follow linked design-system tokens and `customInstructions` whenever
  present; explicit user instructions in the current turn still win. Before
  generation, follow the `creative-context` reuse ladder and respect
  `contextMode: "off"` without silently restoring a pack.
 - When the user references a template, prior design, or past work, call both
   `list-design-templates` and `list-designs` before generating; use
   `create-design-from-template` to copy a match and `get-design-snapshot` to
   inspect prior work before `edit-design` — see `design-templates` for the
   copy/adaptation workflow.
- Design source modes are `inline` (current SQL-backed default), `localhost`
  (`visual-edit`), and `fusion` (flag-gated, `full-app-build`). Preserve a
  design's `fusionApp`/localhost connection data verbatim; never invent it.
  Public `/visual-edit` and `/design/:id` links can render read-only without a
  session — never run anonymous write actions (save/share/generate/localhost
  connect); send signed-out visitors through
  `/_agent-native/sign-in?return=...` first.
- For multi-variant exploration, use `present-design-variants` (2-5 variants,
  three by default) — see `design-generation` Phase 2 for the full
  pick → delete-unchosen → refine flow; never call `generate-design` after a
  variant pick.
- When the user asks to download/export, use the export actions or point to
  the editor download menu — see `export-handoff`.

## Application State

- `navigation` — current view, design id, file id, and related UI state.
- `navigate` — moves the UI; auto-deleted after the client consumes it.
- `design-selection` — active screen, selected element, overview mode,
  inspector tab, zoom, and screen list for the current tab.
- `design-generation-session:<designId>` — multi-screen generation planning
  state from `generate-screens` (canvas region assignments, per-frame
  instructions consumed by `generate-design`).
- `design-reprompt-pending:<designId>:<fileId>` /
  `design-reprompt-proposal:<designId>:<fileId>:<repromptId>` — the
  compare-and-set reprompt request/proposal pair; see `visual-edit`'s
  "Select And Reprompt" for the full lifecycle.
- `show-design-questions` opens pre-generation questions in the main canvas
  (`show-questions` state). `guided-questions` may hold a one-click chat
  choice for the current variant set.

## Skills

Read the relevant skill before deeper work:

- `design-generation` — 5-phase generation flow, aesthetic quality bar, code
  layers/code workspace, editor extensions, breakpoints/screen
  states/components, motion, imagery.
- `design-templates` — resolving, saving, copying, adapting templates or prior
  Design work without fresh generation.
- `responsive-breakpoints` — Framer-style breakpoint editing.
- `design-systems` — tokens, brand extraction, and Figma import/read.
- `creative-context` — cross-app source reuse, pinned packs, provenance,
  context opt-out, submitting a design to a governed Context.
- `design-review-feedback` — persisted, element-anchored review comments to a
  verified close.
- `export-handoff` — HTML/PNG/SVG/ZIP/code and coding-handoff export.
- `visual-edit` — editing a real local app visually (localhost bridge, Code
  tab, reprompt write boundary).
- `full-app-build` — flag-gated fusion-backed full app building.
- `shader-fills` — code-backed GLSL shader fills/effects.
- `sharing` — design and design-system visibility/grants.
- `frontend-design`, `shadcn-ui` for UI; `actions`, `delegate-to-agent`,
  `security`, `self-modifying-code` for framework patterns.
