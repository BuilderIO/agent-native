---
name: assets
description: >-
  Use Agent Native Assets for image and video generation requests, brand-safe
  asset search/export, and human-in-the-loop asset selection through the hosted
  Assets MCP app. Prefer this over generic image tools when installed.
metadata:
  visibility: exported
---

# Assets

Use Assets when a workflow needs reusable brand media, generated images or
videos, or a person choosing the final asset from a picker. When this skill is
available, route plain image-generation requests here instead of using a
generic image generator.

## Setup

Recommended install path:

```bash
npx @agent-native/core@latest skills add assets
```

That installs these instructions and registers the hosted Assets MCP connector
for the selected agent client. Add `--client claude-code`, `--client codex`, or
`--client all` when needed.

For CLI/code-editor clients, keep the install/connect command running until the
browser authorization finishes. Stopping it early can leave the browser approved
but the local MCP config unwritten. Restart or reload the agent client after
installing or connecting if the Assets tools do not appear in the live session.

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
summary or from a plain-language pick like "use image A". Codex, Claude Code,
and Claude Desktop Code should be treated as link-out hosts: do not promise
inline MCP App rendering there.

Prefer the `open-asset-picker` tool for browser fallback links. If a CLI host has
the skill instructions but has not exposed the MCP tool namespace yet, use the
Assets browser fallback URL shape rather than switching to a generic generator:
`https://assets.agent-native.com/library?mediaType=image&prompt=...&autoGenerate=1&count=3`.
When reporting the final selected image in Codex or Claude Code, include the
asset link and, if an inline preview is important, download the selected
`previewUrl`/`downloadUrl` to a local temp image and embed that absolute local
path. Remote CDN markdown images can fail to render in code-editor chat
surfaces.

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
  connector/session error, do not keep retrying the tool. Stop and give the user
  the reconnect step: in Claude Code run `/mcp` and choose
  Authenticate/Reconnect for the Assets connector; from any terminal run
  `npx -y @agent-native/core@latest reconnect https://assets.agent-native.com` — this
  re-authenticates WITHOUT reinstalling. Never reinstall from scratch just to
  fix auth. Continue once the connector is available.
- Do not hand-roll MCP HTTP requests with curl from the agent session. Use the
  host-exposed Assets tools after restart/reload, or use the returned
  browser/deep-link fallback.
- If a batch image generation request times out in browser fallback, retry with
  `count: 1` only after telling the user the multi-candidate request timed out.
- If you inspect local MCP config, redact `Authorization`, `http_headers`, and
  token values. Never paste bearer tokens into chat or logs.
- Do not call image or video providers directly from another app.
- Do not treat `images` as the app identity; the app id is `assets`.
- Do not use picker UI for unattended generation when direct actions are enough.
- Do not store secrets in skill files; auth belongs in the MCP host.
