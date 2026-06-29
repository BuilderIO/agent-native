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
- Use Alpine.js and Tailwind CDN for interactive prototypes. Prefer Alpine
  directives over raw inline event handlers.
- Navigate between prototype screens with Alpine state (`x-show`), a
  `data-screen="file.html"` attribute, or `#` anchors — never real/relative
  URLs, which would navigate the preview iframe to the app itself.
- To refine an existing design, make the smallest change: read it with
  `get-design-snapshot`, then use `edit-design` (search/replace). Reserve
  `generate-design` for new files or large structural rewrites; never resend
  files you aren't changing.
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
- For multi-variant work, write candidates incrementally so the UI can preview
  progress. External MCP hosts should use `present-design-variants` so the same
  picker opens inline instead of writing `application_state` directly.
- Use framework sharing actions for design and design-system visibility/grants.
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
- `design-generation-session:<designId>` contains visible multi-screen
  generation frames created by `generate-screens`.
- `show-design-questions` opens focused pre-generation questions in the main
  design canvas (`show-questions` application state).
- `design-variants` contains in-progress candidates for the variant picker.

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
  `present-design-variants` with 2-5 complete HTML directions (three by
  default), wait for the user to pick one, then use `get-design-snapshot` and
  `generate-design` for follow-up refinements.
- Inline MCP-app hosts (ChatGPT / Claude / Claude Desktop main chat) carry the
  pick back over the chat bridge automatically. If the Design app instead opens
  as a browser link (CLI hosts like Codex / Claude Code, deep link carries
  `handoff=chat`), the user picks there and the editor shows a copyable summary
  (also in `present-design-variants` result `fallbackInstructions`) — ask them
  to paste it back into chat so you can continue from the chosen direction.

## Skills

Read the relevant skill before deeper work:

- `design-generation` for creating/editing prototype HTML and variant flows.
- `design-systems` for tokens, brand extraction, and linked systems.
- `export-handoff` for HTML/PNG/SVG/ZIP/code handoff.
- `frontend-design` and `shadcn-ui` for app UI changes.
- `actions`, `delegate-to-agent`, `security`, and `self-modifying-code` for
  framework patterns.
