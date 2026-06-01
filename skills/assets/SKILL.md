---
name: assets
description: >-
  Use Agent Native Assets for brand-safe image and video generation, asset
  search, export, and human-in-the-loop asset selection through the hosted
  Assets MCP app.
metadata:
  visibility: exported
---

# Assets

Use Assets when a workflow needs reusable brand media, generated images or
videos, or a person choosing the final asset from a picker.

## Setup

Recommended install path:

```bash
npx @agent-native/core@latest skills add assets
```

That installs these instructions and registers the hosted Assets MCP connector
for the selected agent client. Add `--client claude-code`, `--client codex`, or
`--client all` when needed.

If this skill was installed with the Vercel/open Skills CLI
(`npx skills add ...`), only the instructions were installed. That CLI does
not run postinstall scripts or register MCP connectors, so the hosted MCP
connector must be added separately:

```bash
npx @agent-native/core@latest connect https://assets.agent-native.com --client claude-code
```

For cross-app workspace access, connect Dispatch instead:

```bash
npx @agent-native/core@latest connect https://dispatch.agent-native.com --client claude-code
```

OAuth-capable hosts can add this remote MCP URL directly:

```text
https://assets.agent-native.com/_agent-native/mcp
```

## Use The Picker

Use `open-asset-picker` when a person should browse, search, generate, and
select an image or video. For generate-and-choose requests, pass:

```json
{
  "mediaType": "image",
  "prompt": "<user prompt>",
  "autoGenerate": true,
  "count": 3
}
```

Inline MCP hosts render the picker in chat. CLI and code-editor hosts return an
"Open in Assets ->" link; after the user picks, continue from the pasted handoff
summary or from a plain-language pick like "use image A".

## Use Direct Actions

Use unattended actions when the agent already knows what to do:

- `search-assets`
- `list-assets`
- `list-libraries`
- `generate-image`
- `generate-image-batch`
- `generate-video`
- `refresh-generation-run`
- `export-asset`

For images, generation actions are synchronous; use the returned asset fields
directly. For videos, poll `refresh-generation-run` until the run completes.

Preserve returned `assetId`, `runId`, `previewUrl`, `downloadUrl`, media type,
dimensions, `presetId`, and `sessionId` when present.

## Guardrails

- If an Assets tool call returns `Session terminated`, `needs auth`, or another
  connector/session error, do not keep retrying the tool. Tell the user to
  reconnect or authenticate the Assets MCP connector, then continue after it is
  available.
- Do not call image or video providers directly from another app.
- Do not treat `images` as the app identity; the app id is `assets`.
- Do not use picker UI for unattended generation when direct actions are enough.
- Do not store secrets in skill files; auth belongs in the MCP host.
