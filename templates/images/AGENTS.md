# Images Agent

Images manages brand image libraries and generates on-brand assets for this app
and for other agent-native apps over A2A.

## Rules

- All user-facing generation goes through chat. UI buttons submit with
  `sendToAgentChat({ submit: true, newTab: true })`; do not add direct provider
  calls to client components.
- Use image libraries as the source of truth for brand style. Uploaded logos
  and product images are evidence; never invent exact logos from memory.
- For multiple images, prefer `generate-image-batch` with stable slot IDs.
- For feedback, call `refine-image` with the previous `assetId`; preserve
  lineage instead of regenerating from scratch.
- For other apps, call the Images agent over A2A. If you create or reference an
  image, include the exact `assetId`, `runId`, and returned URLs.
- Every generation creates an audit run. Keep `source` and `callerAppId`
  accurate for cross-agent requests so the design team can inspect usage in
  `/audit`.

## Actions

| Action                                    | Purpose                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `list-libraries`                          | List accessible image libraries                      |
| `create-library`                          | Create a new image library                           |
| `get-library`                             | Read a library with collections, assets, and runs    |
| `update-library`                          | Update metadata, style brief, defaults, logo, cover  |
| `delete-library`                          | Delete a library and children                        |
| `create-collection` / `update-collection` | Manage category-specific collections                 |
| `list-assets` / `get-asset`               | Read images and reference assets                     |
| `update-asset` / `delete-asset`           | Retag, save, archive, or delete assets               |
| `generate-image`                          | Generate one candidate                               |
| `generate-image-batch`                    | Generate many candidates in parallel                 |
| `refine-image`                            | Iterate on an existing image from feedback           |
| `save-generated-image`                    | Promote a candidate to saved                         |
| `export-image`                            | Return preview/download URLs for another app         |
| `match-library`                           | Pick a library for a free-text use case              |
| `extract-palette-from-references`         | Write dominant colors into the style brief           |
| `list-audit-runs`                         | Admin audit feed for generated image runs            |
| `get-audit-run`                           | Inspect one run, its prompts, refs, outputs, lineage |
| `export-audit-csv`                        | Export audit runs for design/governance review       |
| `is-audit-admin`                          | Check whether the Audit log nav should be visible    |
| `view-screen`                             | Read current UI context and pending variants         |
| `navigate`                                | Navigate the UI                                      |

## Generation Playbook

- Role-tag references: style, logo, product, diagram, prior candidate.
- Use a small relevant subset by default. More references are supported, but
  noisy or conflicting examples dilute the style.
- Compile the style brief into prompts: palette, composition, lighting,
  typography policy, subject framing, and explicit constraints.
- Avoid in-image text unless the user explicitly asks for exact visible text.
- For diagrams, use the normal image path but specify chart type, label
  placement, line weights, hierarchy, and whitespace.
- For logo accuracy, ask Gemini to leave a clean placeholder region and composite
  the canonical uploaded logo server-side.

## Inline Previews

When the chat is in the Images app, embed candidates with:

````
```embed
src: /asset/<assetId>/embed
aspect: 16/9
title: Image candidate
```
````

Cross-app callers should use the `previewUrl` or import/exported asset URL when
same-origin embeds are not available.
