# Design — Agent Guide

Design is an agent-native prototyping app. The agent creates and edits
complete interactive HTML prototypes, design systems, variants, and handoff
exports through actions against the shared SQL state.

## Skills

Keep this file essential — it is loaded into the agent's context every turn.
Real depth lives in `.agents/skills/`; read the relevant skill before deeper
work in that area.

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
- `visual-edit` — editing a real local app visually (localhost bridge, Code
  tab, reprompt write boundary).
- `full-app-build` — design source modes and flag-gated fusion-backed full app
  building.
- `shader-fills` — code-backed GLSL shader fills/effects.
- `sharing` — design and design-system visibility/grants.
- `frontend-design`, `shadcn-ui` for UI; `actions`, `delegate-to-agent`,
  `security`, `self-modifying-code` for framework patterns.

Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Use
`customizing-agent-native` for the configure → compose → eject → propose seam
ladder.

## Actions

- Resolve templates or prior designs with `list-design-templates` and
  `list-designs`, copy with `create-design-from-template`, then inspect and
  adapt copied files with `get-design-snapshot` and `edit-design`.

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
- A message beginning with `[Reprompt selection]` is preview-only: the only
  mutation path is `propose-node-rewrite`; never call a content writer. See
  `visual-edit`'s "Select And Reprompt". `[Selection question]` is read-only:
  answer about the captured element and subtree without calling
  content-writing actions.
- Call `view-screen` before editing a specific design if the current design or
  selected file is not already clear from context.
- Generated files must be complete, standalone HTML (Alpine.js + Tailwind CDN)
  that renders in the iframe without a build step. See `design-generation` for
  the phases, quality bar, and the audit/screenshot pass required before
  calling a design "ready".
- Treat `data-agent-native-locked="true"` as authoritative — see
  `design-generation` for locked-subtree rules.
- Figma import/read/paste and design-system/token workflows are fully covered in
  `design-systems` — read it before guessing the calling convention, and never
  promise lossless Figma import/export.
- Persist useful work early: create/update the design and files as soon as a
  coherent candidate exists, then iterate.
- In dev, call actions with `pnpm action <name>`; in production, call the
  native tool.
- For shared prototype feedback, use the persisted review actions — read
  `design-review-feedback` for the loop.
- Follow linked design-system tokens and `customInstructions` whenever
  present; explicit user instructions in the current turn still win. Before
  generation, follow the `creative-context` reuse ladder and respect
  `contextMode: "off"`.
- When the user references a template or prior design, resolve it first — see
  `design-templates` for the lookup and reuse order.
- Design source modes are `inline`, `localhost`, and `fusion` — see
  `full-app-build`. Public `/visual-edit` and `/design/:id` links can render
  read-only without a session — never run anonymous write actions
  (save/share/generate/localhost connect); send signed-out visitors through
  `buildSignInReturnHref()` first.
- For multi-variant exploration, use `present-design-variants` (2-5, three by
  default) — see `design-generation` Phase 2 for the pick → refine flow.
- When the user asks to download/export, see `export-handoff`.

## Application State

- `navigation` — current view, design id, file id, and related UI state.
- `navigate` — moves the UI; auto-deleted after the client consumes it.
- `design-selection` — active screen, selected element, overview mode,
  inspector tab, zoom, and screen list for the current tab.
- `design-generation-session:<designId>`, `show-questions`, `guided-questions` —
  generation planning, pre-generation questions, and the variant chat choice;
  see `design-generation`.
- `design-reprompt-pending:<designId>:<fileId>` /
  `design-reprompt-proposal:<designId>:<fileId>:<repromptId>` — the
  compare-and-set reprompt request/proposal pair; see `visual-edit`'s
  "Select And Reprompt" for the full lifecycle.
