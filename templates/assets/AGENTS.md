# Assets — Agent Guide

Assets is an agent-native asset library and generation workspace. The agent
manages libraries, images, generated assets, inline MCP App pickers,
notifications, collaboration, and portable asset requests through actions and
SQL state.

## Skills

Read the relevant skill in `.agents/skills/` before deeper work:

- `creative-context` for cross-app source reuse, pinned packs, provenance, and
  context opt-out.
- `library-management` for kits, collections, access, imports, and duplication.
- `asset-generation` and `image-generation` for generation paths, presets,
  composer mentions, reference boards, and embedded text.
- `logo-composite` for canonical logo compositing and preset skeletons.
- `assets-navigation` for routes, tabs, chat surfaces, and `navigate` targets.
- `agent-engines` for model and engine configuration.
- `a2a-assets` for MCP/A2A callers, skill install paths, and host rendering.
- `inline-embeds`, `notifications`, and `progress` for integration surfaces.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Use actions for asset lifecycle, generation, library organization, uploads,
  embeds, notifications, progress, sharing, and collaboration. Do not bypass
  access checks.
- Use the configured generation/engine path for image and asset work. Do not add
  ad hoc provider calls when the app has an action/engine abstraction.
- Preserve provenance and metadata for generated or imported assets.
- Use `view-screen` when the active library, selected asset, picker, generation,
  or embed target is unclear.
- Image work is preset-first. Follow the `creative-context` reuse ladder, then
  check `list-generation-presets` and generate with a matching `presetId`
  instead of ad hoc settings; see `image-generation`.
- When a `preset` is tagged, the server embeds its brand style brief into your
  message inside a `<tagged-generation-presets>` block. Internalize that brief,
  then pass the `presetId` instead of restating its saved settings as args.
- Keep inline previews and picker outputs lightweight; fetch full asset details
  through actions when needed.
- Use framework sharing/collaboration primitives for ownable assets.

## Application State

- `navigation` exposes library, asset, generation, picker, embed, and selection
  context. Library uses
  `{ view: "library", selection: "all" | libraryId, tab, scope, folderId, search }`,
  the embedded picker uses
  `{ view: "picker", mediaType, libraryId, query, prompt, aspectRatio }`, and the
  preset editor uses `{ view: "preset", libraryId, presetId }`.
- `creative-context` holds
  `{ contextMode, selectedContextId, currentPackId, pinnedPackId }`. Respect
  `contextMode: "off"` without silently restoring a pack.
- `asset-variants` is the shared live generation tray state. New image
  candidates should appear there through `generate-image` or
  `generate-image-batch`; do not invent page-local progress surfaces.
- `imageGenerationModel` is the composer image-model default, which image
  generation actions may use when `model` is omitted.

## Actions

Uncommon actions stay discoverable through `tool-search`.

| Action | Purpose |
| --- | --- |
| `navigate` | Move the UI to a picker, library, generation, asset, preset, or settings surface |
| `view-screen` | Read current navigation, selection, and visible ids |
| `list-libraries` / `match-library` | Find or disambiguate a brand kit |
| `duplicate-library` | Make a private copy of a Brand Kit |
| `list-assets` / `search-assets` | Browse or search assets in accessible kits |
| `import-asset-from-url` | Ingest external brand or blog imagery as a reference asset |
| `import-style-from-url` | Render a website and merge its design.md-style visual language into a library or collection |
| `set-canonical-logo` | Pin the kit's pixel-perfect logo |
| `list-generation-presets` | List repeatable output formats before generating |
| `create-generation-preset` / `update-generation-preset` | Author preset format, references, `includeLogo`, skeleton |
| `generate-image` / `generate-image-batch` | Generate image candidates (synchronous) |
| `generate-video` | Generate video, then poll `refresh-generation-run` |
| `refine-image` / `edit-image` / `restyle-image` | Iterate on an existing asset |
| `generate-asset` | Human-in-the-loop generation that returns the inline picker |
| `open-asset-picker` | Browse, search, or pick existing assets in the embedded picker |
| `export-asset` | Return a download URL or artifact for another app |
| `create-generation-session` | Hand generation work off to a designer |
| `manage-context-membership` | Submit an asset to a governed Creative Context |

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
