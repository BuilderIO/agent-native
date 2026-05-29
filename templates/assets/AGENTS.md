# Assets — Agent Guide

Assets is an agent-native asset library and generation workspace. The agent
manages libraries, images, generated assets, inline embeds, notifications,
collaboration, and A2A asset requests through actions and SQL state.

Detailed library, generation, image, embed, and engine rules live in
`.agents/skills/`.

## Core Rules

- Use actions for asset lifecycle, generation, library organization, uploads,
  embeds, notifications, progress, sharing, and collaboration. Do not bypass
  access checks.
- Use the configured generation/engine path for image and asset work. Do not add
  ad hoc provider calls when the app has an action/engine abstraction.
- Preserve provenance and metadata for generated or imported assets.
- Use `view-screen` when the active library, selected asset, picker, generation,
  or embed target is unclear.
- Keep inline previews and picker outputs lightweight; fetch full asset details
  through actions when needed.
- Use framework sharing/collaboration primitives for ownable assets.

## Application State

- `navigation` exposes library, asset, generation, picker, embed, and selection
  context.
- `navigate` moves the UI to library, generation, asset, and settings surfaces.

## Skills

Read the relevant skill before deeper work:

- `library-management`, `asset-generation`, `image-generation`, and
  `agent-engines` for asset workflows.
- `inline-embeds`, `a2a-assets`, `notifications`, `progress`, and
  `real-time-collab` for integration surfaces.
- `actions`, `storing-data`, `security`, `frontend-design`, and `shadcn-ui` as
  needed.
