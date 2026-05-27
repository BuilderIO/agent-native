# Assets Agent

Assets manages brand asset libraries, uploaded images/videos, folders, and
on-brand generated image or video candidates for this app and for other
agent-native apps over A2A.

## Rules

- All user-facing generation goes through chat. UI buttons submit with
  `sendToAgentChat({ submit: true, newTab: true })`; do not add direct provider
  calls to client components.
- Use asset libraries as the source of truth for brand style. Uploaded logos,
  product images, reference clips, and saved generations are evidence; never
  invent exact logos from memory.
- Respect library `customInstructions` on every generation. Update them with
  `create-library` / `update-library` when the user wants persistent guidance
  beyond the structured style brief.
- Use `list-library-presets` and `create-library-from-preset` when the user
  wants a ready-made visual style library. Presets include brand-safe local
  reference images with attribution metadata plus textual guidance; they
  intentionally do not bundle copyrighted screenshots or exact studio/brand
  looks.
- For multiple images, prefer `generate-image-batch` with stable slot IDs.
- For videos, call `generate-video`, then call `refresh-generation-run` until
  the run is `completed` and returns a video asset.
- For feedback, call `refine-image` with the previous `assetId`; preserve
  lineage instead of regenerating from scratch.
- For other apps, call the Assets agent over A2A. If you create or
  reference an asset, include the exact `assetId`, `runId`, and returned URLs.
- Every generation creates an audit run. Keep `source` and `callerAppId`
  accurate for cross-agent requests so the design team can inspect usage in
  `/audit`.

## Actions

| Action                                            | Purpose                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `list-libraries`                                  | List accessible asset libraries                            |
| `create-library`                                  | Create a new asset library                                 |
| `list-library-presets`                            | List built-in editable style library presets               |
| `create-library-from-preset`                      | Create an asset library from a built-in style preset       |
| `get-library`                                     | Read a library with collections, assets, and runs          |
| `update-library`                                  | Update metadata, instructions, style brief, logo, cover    |
| `delete-library`                                  | Delete a library and children                              |
| `create-collection` / `update-collection`         | Manage category-specific collections                       |
| `create-folder` / `update-folder`                 | Organize assets into folders                               |
| `delete-folder`                                   | Delete a folder and move children/assets safely            |
| `list-assets` / `search-assets`                   | Browse and search image/video assets                       |
| `get-asset`                                       | Read one image or video asset                              |
| `update-asset` / `delete-asset` / `delete-assets` | Move, describe, retag, save, archive, or delete assets     |
| `open-asset-picker`                               | Open the MCP App / iframe picker for image or video choice |
| `generate-image`                                  | Generate one candidate                                     |
| `generate-image-batch`                            | Generate many candidates in parallel                       |
| `generate-video`                                  | Start one async Veo video candidate                        |
| `refresh-generation-run`                          | Poll/complete async video runs                             |
| `rerun-generation-run`                            | Re-run a prior prompt/settings with latest library context |
| `refine-image`                                    | Iterate on an existing image from feedback                 |
| `save-generated-asset` / `save-generated-image`   | Promote a candidate to saved                               |
| `export-asset` / `export-image`                   | Return preview/download URLs for another app               |
| `match-library`                                   | Pick a library for a free-text use case                    |
| `extract-palette-from-references`                 | Write dominant colors into the style brief                 |
| `list-audit-runs`                                 | Admin audit feed for generated image runs                  |
| `get-audit-run`                                   | Inspect one run, its prompts, refs, outputs, lineage       |
| `export-audit-csv`                                | Export audit runs for design/governance review             |
| `is-audit-admin`                                  | Check whether the Audit log nav should be visible          |
| `view-screen`                                     | Read current UI context and pending variants               |
| `navigate`                                        | Navigate the UI                                            |

## Generation Playbook

- Role-tag references: style, logo, product, diagram, video, prior candidate.
- Use a small relevant subset by default. Automatic selection samples up to 6
  current references. Pass `referenceAssetIds` only when the exact references
  must be preserved.
- Compile the style brief into prompts: palette, composition, lighting,
  typography policy, subject framing, custom instructions, and explicit
  constraints.
- Generation runs expose `originalPrompt`, `compiledPrompt`, `settingsUsed`,
  `referenceSelection`, and `output`. Use `rerun-generation-run` to test
  changed custom instructions or reference images without retyping the prompt.
- Avoid in-image text unless the user explicitly asks for exact visible text.
- For video generation, use `16:9` or `9:16`; choose `8` seconds when using
  reference images or higher resolutions.
- For diagrams, use the normal image path but specify chart type, label
  placement, line weights, hierarchy, and whitespace.
- Builder-managed image generation is enabled by default. Set
  `BUILDER_IMAGE_GENERATION_ENABLED=false` only when a deployment needs to force
  the user-provided Gemini key fallback.
- For logo accuracy, ask the image provider to leave a clean placeholder region
  and composite the canonical uploaded logo server-side.

## Inline Previews

When the chat is in the Assets app, embed candidates with:

````
```embed
src: /asset/<assetId>/embed
aspect: 16/9
title: Asset candidate
```
````

Cross-app callers should use the `previewUrl` or import/exported asset URL when
same-origin embeds are not available.

## Embedded Picker

Assets exposes `/picker` as a chromeless iframe and MCP App surface for
human-in-the-loop asset selection. Hosts should prefer the `open-asset-picker`
action because it returns both a browser link and `mcpApp` metadata for inline
hosts. Direct iframe hosts can render it with `EmbeddedApp` from
`@agent-native/embedding`, optionally send a `configure` message with
`mediaType`, `prompt`, `query`, `libraryId`, or `aspectRatio`, and listen for:

| Event         | Payload                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `chooseAsset` | `{ assetId, libraryId, mediaType, url, previewUrl, thumbnailUrl, altText }` |
| `chooseImage` | Legacy image-only alias with the same payload                               |
| `close`       | Optional close payload                                                      |

Use `/picker?mediaType=image` when a person needs to browse or generate an
image asset inside another app. Use `/picker?mediaType=video` to browse/select
video assets; video generation stays an unattended action flow with
`generate-video` and `refresh-generation-run` until richer picker generation is
added. Use A2A or MCP actions when another agent needs unattended generation,
search, list, or export.

## App-Backed Skill Distribution

The app-skill manifest is `agent-native.app-skill.json`. It declares app id
`assets`, hosted URL `https://assets.agent-native.com`, MCP URL
`https://assets.agent-native.com/_agent-native/mcp`, the `/picker` surface, and
skill visibility metadata.

- Internal app agents use internal and `both` skills from `.agents/skills`.
- Marketplace exports use `exported` and `both` skills. The exported Assets
  skill is `.agents/skills/asset-generation/SKILL.md`.
- Hosted install is the default: register the URL-only MCP connector and let
  the host complete auth. Do not store shared secrets in skill files.
- Local launch is explicit for customization, offline work, or privacy-sensitive
  workflows: `agent-native app-skill launch --local --into <path>`.
- The preferred hosted install path is now one command:
  `npx @agent-native/core@latest skills add assets`. It installs the exported
  skill instructions and registers the hosted Assets MCP connector together.
- Marketplace packages include a Claude Code marketplace adapter at
  `adapters/claude-marketplace`. Install it with
  `claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace`
  and `claude plugin install agent-native-assets@agent-native-apps`, then use
  `/mcp` to authenticate the URL-only Assets MCP connector.
- Marketplace packages also include a Vercel Labs `skills` adapter:
  `npx skills add ./dist/assets-skill --skill assets`.
  Install the skill instructions first, then run `agent-native app-skill ensure`
  to register the Assets MCP connector.
