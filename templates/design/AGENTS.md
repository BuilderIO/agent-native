# Design — Agent Guide

Design is an agent-native prototyping app. The agent creates and edits complete
interactive HTML prototypes, design systems, variants, and handoff exports
through actions against the shared SQL state.

Keep this file essential. Detailed generation, design-system, export, and UI
patterns live in `.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use the app actions for designs, files, versions, design systems, variants,
  export, and sharing. Do not write design rows directly with SQL.
- Treat repository import actions as shortcuts, not capability limits. When the
  exact GitHub endpoint, search query, request body, pagination mode, metadata
  field, or API version matters, use `provider-api-catalog`,
  `provider-api-docs`, and `provider-api-request` against the real GitHub API.
  The provider API resolves auth from the saved `GITHUB_TOKEN` secret and never
  exposes the token value. For large scans, stage results with `stageAs` and
  analyze them with `query-staged-dataset`.
- In dev, call actions with `pnpm action <name>`; in production, call the native
  tool. The action schema is the source of truth for parameters.
- Call `view-screen` before editing a specific design if the current design or
  selected file is not already clear from context.
- Generated files must be complete, standalone HTML unless the user asks for a
  different export format. They should render in the iframe without a build step.
- For design generation, ground the work in a concrete audience, primary job,
  and visual thesis before writing. For existing products, inspect current
  screens, linked design systems, tokens, and component language before
  inventing a new direction. Use realistic content/copy and one signature choice
  per direction; avoid lorem ipsum, generic SaaS filler, and decorative
  placeholders. Include expected responsive/accessibility states and visually
  inspect the result before calling it ready.
- For editable reusable building blocks inside Design, use
  `list-design-native-assets` first, then `insert-design-native-asset` with the
  chosen kind. These are Design-native HTML primitives/components, not external
  media, so prefer them when the user asks for a Figma Assets-style library that
  supports our own primitives.
- For raster image generation, restyling, or editing existing screenshots/photos,
  use the available first-party Assets MCP tool such as `generate-asset` instead
  of placeholders or generic stock imagery. When the Assets picker returns a
  selected asset, preserve `assetId`, `runId`, and URLs verbatim; if a design is
  open, call `insert-asset` with the chosen URL/id, then refine placement with
  `get-design-snapshot` and `edit-design` as needed. If no Assets MCP tool is
  available, use the first-party Assets app via `call-agent` with agent
  `"assets"` when available. If the user attached an image, use its hosted
  chat-attachment URL or call `upload-image` to create one before delegating. If
  no image/upload provider is configured, say that specific setup is needed and
  continue any non-image Design work separately.
- For reusable Figma library components, use `list-figma-library-assets` with a
  Figma file URL or file key. It returns components/component sets with
  thumbnails, rendered insert URLs, and Figma provenance. Insert with
  `insert-figma-library-asset`, preserving `fileKey`, `nodeId`, `componentKey`,
  `sourceUrl`, and the rendered URL. This path requires the saved
  `FIGMA_ACCESS_TOKEN` secret; never ask the user to paste that token into chat
  or pass it as an action parameter. Figma styles and variables are design-system
  inputs, not draggable media assets; route full file/design-system extraction
  through Builder-backed indexing.
- Use Alpine.js and Tailwind CDN for interactive prototypes. Prefer Alpine
  directives over raw inline event handlers.
- Navigate between prototype screens with Alpine state (`x-show`), a
  `data-screen="file.html"` attribute, or `#` anchors — never real/relative
  URLs, which would navigate the preview iframe to the app itself.
- To refine an existing design, make the smallest change: read it with
  `get-design-snapshot`, then use `edit-design` (search/replace). Reserve
  `generate-design` for new files. For broad rewrites of an existing selected
  file, use `edit-design` with `mode: "replace-file"` and the exact `fileId`;
  never resend files you aren't changing.
- When the user asks to add tweak controls, preserve existing useful tweaks,
  add or update the requested `tweaks` definitions, and make sure each control
  is backed by a CSS custom property the rendered file actually uses. If source
  edits are needed, use `get-design-snapshot` first and persist the complete
  updated tweak definition list through `generate-design`.
- Design editor extensions render in the right inspector slot
  `design.editor.inspector`. When creating an extension for that panel, call
  `create-extension`, then `add-extension-slot-target` with that slot id, then
  `install-extension` so it appears inline. Extensions receive
  `window.slotContext` with the current design id, active screen, selected
  element, zoom, mode, tool, and tweak values. For AI-driven style/artboard
  changes, extension HTML should call `agentNative.chat.send(...)` with the
  selected element selector/sourceId and request; the agent should call
  `view-screen` first, prefer `apply-visual-edit` for element style/class/text
  changes, and use `update-design` or `generate-design` with `canvasFrames` for
  overview artboard placement changes. If creating the extension opens the
  standalone extension editor, return to the same design with `navigate` and
  `inspectorTab: "extensions"` after installing it.
- Follow linked design-system tokens and `customInstructions` whenever present;
  explicit user instructions in the current turn still win.
- When a user wants tokens from design.md, CSS, theme/tokens JSON, Tailwind
  config, local files, or the current design, call `import-design-tokens` and
  preserve its `tokens`, `filesAnalyzed`, and provenance in your answer. Manual
  `apply-design-token-edit` / one-by-one token entry is the fallback for a small
  one-off token, not the primary import workflow. For Figma variables/styles or
  raw `.fig` files, keep using Builder-backed design-system indexing instead of
  local `.fig` parsing.
- Persist useful work early: create/update the design and files as soon as a
  coherent candidate exists, then iterate.
- For non-trivial new design prompts, ask before generating: create/open the
  design shell, call `show-design-questions`, stop while the main canvas shows
  the questions, then continue from the user's answers.
- For multiple screens/states, call `generate-screens` first. It opens the
  infinite screen overview and returns target filenames plus `canvasFrame`
  placements. Then call `generate-design` with those files and pass the matching
  `canvasFrames` entries so screens appear in the overview instead of only in
  the file list.
- After generation or broad updates, leave the user in the screen overview when
  the work involves multiple screens or artboard placement. Overview is the
  primary editing surface: users can select screens, move/resize/drop static
  frames and canvas primitives, edit layers in place, and use the frame's
  full-view button to enter focused editing.
- To move the user's editor, call `navigate` with `view: "editor"` and
  `editorView: "overview"` for the screen overview, or `editorView: "single"`
  plus `fileId`, `filename`, or `screen` to focus one screen.
- Single-screen mode is for scrolling, interacting with prototype behavior, and
  editing the DOM/code layers inside one screen. Do not use it as the default
  landing mode for multi-screen generation unless the user asks to focus a
  specific screen.
- The layers panel shows screens as top-level frames and nests DOM/code layers
  beneath the active screen. Rename DOM/code layers by safely editing source to
  set `data-agent-native-layer-name`; this is the stable human-readable layer
  name. `data-code-layer-id` and similar ids are for selection stability, not
  display naming.
- For inline/Alpine screens, stamp and preserve unique
  `data-agent-native-node-id` attributes on selectable DOM nodes. Treat
  generated CSS selectors as a compatibility fallback only. For localhost React
  screens, resolve through build-time source/debug metadata (stable generated
  ids, component name, file, and line) before falling back to selectors.
- For inline/Alpine motion, use `get-motion-timeline` to inspect the active
  file's saved or CSS-recovered timeline, then call `apply-motion-edit` with the
  same `sourceRef`/`fileId` to update it. Motion edits persist as durable
  managed keyframes in `<style data-agent-native-motion>` plus editable timeline
  metadata; it is not a one-way export. Real CSS module or `motion/react`
  write-back remains a localhost/fusion follow-up capability.
- For multi-variant work, use `present-design-variants` so every candidate is
  saved as a normal overview-board screen and the user gets one inline chat
  button per screen name. Keep each variant compact: prefer concise labels,
  descriptions, accent colors, and feature bullets, and omit full HTML when it
  would make the tool input too large. The action can render representative
  screens from direction data. After the user picks, delete the unchosen
  variant screens before continuing from the kept screen.
- Use framework sharing actions for design and design-system visibility/grants.
- `/visual-edit` is a public entry route and public `/design/:id` links may
  render read-only public designs without a session. Do not open anonymous write
  actions: save, share, generation, localhost connection, and screen persistence
  should send signed-out visitors through `/_agent-native/sign-in?return=...`,
  then save or copy the design into the authenticated account before sharing.
- When the user asks to download/export, use export actions or point to the
  editor download menu.
- Design source modes are `inline`, `localhost`, and `fusion`. Inline is the
  current SQL-backed prototype mode. Localhost connections come from
  `npx @agent-native/core@latest design connect` and are persisted with
  `connect-localhost`; list them with `list-localhost-connections` before
  creating or resolving local-code artboards. Fusion is a future source type and
  should be preserved when present but not invented for inline/local work.
- Localhost route manifests are scaffolding for URL-backed Flow Canvas
  artboards. Use `add-localhost-screens` to place routes or path/query states as
  iframe screens in overview mode. Preserve route ids, paths, `sourceType`,
  bridge URL, and snapshot/state references when moving between actions so later
  flow-edge derivation has stable anchors.

## Application State

- `navigation` tells you the current view, design id, file id, and related UI
  state.
- `navigate` moves the UI and is auto-deleted after the client consumes it.
- `design-selection` includes active screen, selected element, overview mode,
  inspector tab, zoom, and screen list for the current tab.
- `design-generation-session:<designId>` contains agent-facing multi-screen
  generation planning state created by `generate-screens` (canvas region
  assignments and per-frame instructions consumed by `generate-design` and
  `view-screen`; not rendered as canvas overlays).
- `show-design-questions` opens focused pre-generation questions in the main
  design canvas (`show-questions` application state).
- `guided-questions` may contain a one-click chat choice for the current
  variant set. Variants themselves are normal design files with `canvasFrames`
  and `screenMetadata`.

## Code Layers

- `get-code-layer-projection` reads inline HTML/JSX and returns selectable layer
  nodes, selectors, names, and edit intents for agent and UI workflows.
- `apply-visual-edit` supports deterministic local edits for HTML-backed code
  layers: text, classes, styles, attributes, source order, and small structural
  changes. Use it for selected-element edits before falling back to full
  `update-design` / `generate-design` rewrites.
- Prefer `data-agent-native-layer-name="Readable name"` on meaningful elements.
  The projection uses it before semantic/text fallbacks, and layer renames should
  persist by updating that attribute.
- Current limitation: visual code-layer edits are HTML-only. Localhost source
  mode can list and resolve local routes now, but file reads/writes remain a
  bridge contract until explicit permission controls are hardened.

## Code Workspace

- The editor left rail has a wide `code` workspace panel. Open it with
  `navigate --view editor --designId <id> --leftPanel code` and optionally pass
  `fileId`, `filename`, or `screen` to focus a file.
- Use `list-source-files` to inspect the source workspace. For the MVP the
  backend is `virtual-inline` over SQL-backed `design_files`, exposed as
  `designfs://<designId>/`.
- Use `read-source-file` for file contents and preserve its `versionHash` before
  writing. Do not return full file content from `view-screen`; it reports only
  active code file metadata and dirty state.
- Use `preview-source-edit` to show a diff without saving, then
  `apply-source-edit` with the prior `versionHash` to save either a full replace
  or exact replace. These actions update the same inline file state as the UI.
- Use `resolve-selection-source` when the user has a canvas element selected and
  you need the best matching inline file location/snippet. Localhost/container
  source reads and writes remain future backend work.

## Localhost Source Actions

- `connect-localhost`: registers or refreshes a localhost source connection
  emitted by `npx @agent-native/core@latest design connect`. Pass
  `devServerUrl`, optional `bridgeUrl`, optional `rootPath`, and either `routes`
  or a full `routeManifest`.
- `list-localhost-connections`: lists the current user's saved localhost
  connections and route manifests. Use this before referring to local-code
  artboards.
- `add-localhost-screens`: creates or refreshes URL-backed iframe screens from
  the latest localhost connection or a specific `connectionId`. Pass `routes`
  with `path`/`url` when visualizing a flow; pass `paths` for a concise route
  list. Then call `navigate --view editor --designId <id> --editorView overview`.

## App-Backed Skill Distribution

- The preferred hosted install path is
  `npx @agent-native/core@latest skills add design-exploration`,
  `npx @agent-native/core@latest skills add visual-edit`, or `design` for the
  full Design bundle. It installs the exported Design instructions and registers
  the hosted Design MCP connector together.
- The open Skills CLI path
  `npx skills@latest add BuilderIO/agent-native --skill visual-edit` installs
  exported instructions only.
- For local-code visual editing, `/visual-edit` should run the target app dev
  server, run
  `npx @agent-native/core@latest design connect --url http://localhost:<port> --root .`,
  register that manifest with `connect-localhost`, call `add-localhost-screens`,
  and open the editor in overview mode.
- For human-in-the-loop UI exploration, create a design shell, call
  `present-design-variants` with 2-5 concise directions (three by default),
  wait for the user to pick one in chat, delete each other generated variant
  screen with `delete-file` at most once, call `get-design-snapshot` exactly
  once with the selected screen's `fileId`, then call `edit-design` exactly once
  on that same `fileId` for follow-up refinement. Use `mode: "replace-file"`
  when expanding the representative placeholder into the full chosen direction.
  Do not repeat delete/snapshot cycles, and do not call `generate-design` after
  a variant pick.
- If inline chat choice buttons are unavailable, the user can tell you the
  preferred screen name. Do not show a separate variant picker or ask them to
  paste a copyable handoff summary.

## Skills

Read the relevant skill before deeper work:

- `design-generation` for creating/editing prototype HTML and variant flows.
- `design-systems` for tokens, brand extraction, and linked systems.
- `export-handoff` for HTML/PNG/SVG/ZIP/code handoff.
- `frontend-design` and `shadcn-ui` for app UI changes.
- `actions`, `delegate-to-agent`, `security`, and `self-modifying-code` for
  framework patterns.
