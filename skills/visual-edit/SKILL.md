---
name: visual-edit
description: >-
  Open a running local app in Design overview mode as URL-backed iframe screens
  for visual editing, flow review, duplication, and route-state exploration.
metadata:
  visibility: exported
---

# Visual Edit

Use `/visual-edit` when the user wants to inspect or edit a real local app
visually instead of generating standalone Alpine HTML. The source of truth is
the running localhost app plus its route URLs. Design shows those routes as
iframe-backed screens on the infinite canvas.

## Core Model

- Each screen is a URL-backed iframe, not copied HTML.
- Each screen keeps URL metadata: `connectionId`, `routeId`, `path`,
  `url`, `bridgeUrl`, title, and viewport size.
- Start in Design's screen overview mode. In overview, screens are static
  design frames; full-screen focus is for scrolling and app interaction.
- Alt-drag duplicates a screen. For localhost screens, duplication copies the
  iframe frame and URL metadata; change the copy's path/query for a new state.
- Flow visualization is multiple URL states: `/checkout?step=shipping`,
  `/checkout?step=payment`, `/checkout?step=done`, etc.
- When the user gives a named flow or numbered screen list, preserve that order
  and create one screen per URL/path. Shorthand like
  `localhost:1234/onboarding/1` means
  `http://localhost:1234/onboarding/1`.

## Required Local Bridge

From the target app repo, make sure its dev server is running, then run:

```bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root .
```

Use the app's real port. The command starts a local bridge on
`http://127.0.0.1:7331` by default and exposes `/manifest.json`,
`/routes.json`, and `/health`.

For one-shot agent setup, ask for JSON and keep the long-running bridge open in
a second terminal if the user needs live updates:

```bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root . --json
```

## Action Flow

1. Register or refresh the bridge with `connect-localhost`, passing the
   `/manifest.json` result as `routeManifest` and `capabilities`.
2. Create or reuse a Design project with `create-design`.
3. Place URL-backed screens with `add-localhost-screens`:

```bash
pnpm action add-localhost-screens '{
  "designId": "<design-id>",
  "connectionId": "<connection-id>",
  "paths": ["/", "/pricing", "/checkout?step=payment"]
}'
```

For a numbered flow the user describes in chat, keep the labels and order:

```bash
pnpm action add-localhost-screens '{
  "designId": "<design-id>",
  "connectionId": "<connection-id>",
  "routes": [
    { "url": "localhost:1234/onboarding/1", "title": "Screen 1" },
    { "url": "localhost:1234/onboarding/2", "title": "Screen 2" },
    { "url": "localhost:1234/onboarding/3", "title": "Screen 3" }
  ]
}'
```

If no `routes` or `paths` are supplied, `add-localhost-screens` uses every
route from the latest localhost manifest.

4. Navigate to overview mode:

```bash
pnpm action navigate --view editor --designId "<design-id>" --editorView overview
```

## Open The Design Surface

- Use the `link`, `deepLink`, or MCP App embed returned by Design actions so
  the user sees the canvas. In Codex Desktop or VS Code, prefer opening that
  Design URL in the available preview/webview panel; otherwise surface the
  "Open design" link.
- If the user is working in VS Code, the Agent Native extension can open the
  same URL via
  `vscode://builder.agent-native/open?url=<encoded-design-url>`. Its
  `Agent Native: Open Design Canvas` command also starts the local bridge and
  opens hosted Design in the VS Code side panel.
- After `add-localhost-screens`, confirm the Design editor is in overview mode
  with the requested URL-backed frames visible. Do not stop at "screens added"
  when the user asked to inspect or edit visually.

## Editing URLs

Keep localhost screens as URL files plus `screenMetadata[fileId]`. Do not
replace them with copied `srcdoc` HTML unless the user explicitly asks for a
frozen snapshot. To change a state, rerun `add-localhost-screens` with the new
path/query or duplicate the screen and update the copy's URL metadata.

## Verification

- `list-localhost-connections` returns the expected connection and routes.
- The Design editor opens in overview mode.
- Every requested screen renders the intended localhost URL.
- Alt-dragging a screen copies the URL-backed frame, not an inline HTML clone.
