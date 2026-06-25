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
- Follow linked design-system tokens and `customInstructions` whenever present;
  explicit user instructions in the current turn still win.
- Persist useful work early: create/update the design and files as soon as a
  coherent candidate exists, then iterate.
- For non-trivial new design prompts, ask before generating: create/open the
  design shell, call `show-design-questions`, stop while the main canvas shows
  the questions, then continue from the user's answers.
- For multi-variant work, write candidates incrementally so the UI can preview
  progress. External MCP hosts should use `present-design-variants` so the same
  picker opens inline instead of writing `application_state` directly.
- Use framework sharing actions for design and design-system visibility/grants.
- When the user asks to download/export, use export actions or point to the
  editor download menu.

## Application State

- `navigation` tells you the current view, design id, file id, and related UI
  state.
- `navigate` moves the UI and is auto-deleted after the client consumes it.
- `show-design-questions` opens focused pre-generation questions in the main
  design canvas (`show-questions` application state).
- `design-variants` contains in-progress candidates for the variant picker.

## App-Backed Skill Distribution

- The preferred hosted install path is
  `npx @agent-native/core@latest skills add design-exploration` (or `design`).
  It installs the exported Design exploration instructions and registers the
  hosted Design MCP connector together.
- The open Skills CLI path
  `npx skills@latest add BuilderIO/agent-native --skill design-exploration` installs
  the exported instructions only.
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
