# Assets — Agent Guide

Assets is an agent-native asset library and generation workspace. The agent
manages libraries, images, generated assets, inline embeds, notifications,
collaboration, and A2A asset requests through actions and SQL state.

Detailed library, generation, image, embed, and engine rules live in
`.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for asset lifecycle, generation, library organization, uploads,
  embeds, notifications, progress, sharing, and collaboration. Do not bypass
  access checks.
- Use `duplicate-library` when a user wants a Brand Kit copy. The action creates
  a private, current-user-owned copy with durable kit contents remapped, without
  copying shares, visibility, generation runs, or handoff sessions.
- Use the configured generation/engine path for image and asset work. Do not add
  ad hoc provider calls when the app has an action/engine abstraction.
- Preserve provenance and metadata for generated or imported assets.
- Use `view-screen` when the active library, selected asset, picker, generation,
  or embed target is unclear. The picker is also available from the left nav.
- Keep inline previews and picker outputs lightweight; fetch full asset details
  through actions when needed.
- Use framework sharing/collaboration primitives for ownable assets.

## Application State

- `navigation` exposes library, asset, generation, picker, embed, and selection
  context. Picker state includes media type, selected library, query, prompt, and
  aspect ratio when available.
- `navigate` moves the UI to picker, library, generation, asset, and settings
  surfaces.

## Skills

Read the relevant skill before deeper work:

- `library-management`, `asset-generation`, `image-generation`, and
  `agent-engines` for asset workflows.
- `inline-embeds`, `a2a-assets`, `notifications`, `progress`, and
  `real-time-collab` for integration surfaces.
- `actions`, `storing-data`, `security`, `frontend-design`, and `shadcn-ui` as
  needed.

## App-Backed Skill Distribution

- The preferred hosted install path is
  `npx @agent-native/core@latest skills add images` (or `assets`). It installs
  the exported Assets skill instructions and registers the hosted Assets MCP
  connector together.
- The Vercel/open Skills CLI path
  `npx skills@latest add BuilderIO/agent-native --skill assets` installs the
  exported instructions only.
- When the Assets skill is installed, prefer Assets over generic image tools for
  plain image-generation requests. Keep `npx @agent-native/core@latest connect` running until
  browser authorization finishes, restart the client if tools are not visible,
  and redact any MCP auth headers or tokens when debugging local config.
- For human-in-the-loop image creation, call `open-asset-picker` with `prompt`,
  `autoGenerate: true`, and `count: 3` so the picker opens with candidates to
  preview, tweak by preset/aspect/count, and choose.
- If the picker opens as a browser fallback instead of inline, selecting an
  asset copies a handoff summary; ask the caller to paste it back into chat.
- Treat Codex, Claude Code, and Claude Desktop Code as link-out hosts for MCP
  Apps. Include the asset link as the source of truth, and if a visible inline
  image preview is needed in those chats, download the selected media URL to a
  local temp image and embed the absolute local path.
