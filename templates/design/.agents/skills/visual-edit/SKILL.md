---
name: visual-edit
description: >-
  Open a running local app in Design overview mode as URL-backed iframe screens
  for visual editing, flow review, duplication, and route-state exploration.
  Use when the user asks to inspect, compare, or edit a real local app visually
  in Design.
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
- Each screen keeps its own URL metadata: `connectionId`, `routeId`, `path`,
  `url`, `bridgeUrl`, title, and viewport size.
- Start in Design's screen overview mode. The user can edit/select/drop on any
  visible screen from the overview canvas.
- In overview, screens are static like Figma frames: no iframe scrolling or app
  interaction. Full-screen focus is for scrolling and app interaction.
- Alt-drag duplicates a screen. For localhost screens, duplication copies the
  iframe frame and URL metadata; change the copy's path/query when you need a
  new flow state.
- Flow visualization is just multiple URL states: `/checkout?step=shipping`,
  `/checkout?step=payment`, `/checkout?step=done`, etc.
- When the user gives a named flow or numbered screen list, preserve that order
  and create one screen per URL/path. Shorthand like
  `localhost:1234/onboarding/1` means `http://localhost:1234/onboarding/1`.

## Review Quality

- Treat the running app as the truth. Preserve its component language, tokens,
  route state, and real content unless the user explicitly asks for a new visual
  direction.
- Use multiple URL states to reveal meaningful UX moments: empty/loading/error
  states, focused panels, modals, responsive breakpoints, and completed flow
  steps when those matter to the review.
- For visual edits, compare before/after at the relevant viewport sizes and
  check key hover/focus/scroll states when the app exposes them.

## Required Local Bridge

From the target app repo, make sure its dev server is running, then run the
Design bridge with `npx`:

```bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root .
```

Use the app's real port. The command starts a local bridge on
`http://127.0.0.1:7331` by default and exposes:

- `GET /manifest.json` — dev server URL, bridge URL, discovered routes, root.
- `GET /routes.json` — route manifest only.
- `GET /health` — bridge liveness.

For one-shot agent setup, ask for JSON and keep the long-running bridge open in
a second terminal if the user needs live updates:

```bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root .
curl http://127.0.0.1:7331/manifest.json
```

Do not use `--json` for an editable session. `--json`, `--once`, and
`--dry-run` print the manifest and exit, so Design will fall back to a
non-editable live iframe as soon as it tries to refresh the snapshot.

## Action Flow

1. Register or refresh the bridge in Design:

```bash
pnpm action connect-localhost '{
  "devServerUrl": "http://localhost:5173",
  "bridgeUrl": "http://127.0.0.1:7331",
  "rootPath": ".",
  "routeManifest": { "version": 1, "sourceType": "localhost", "routes": [] }
}'
```

Prefer passing the actual `/manifest.json` result as `routeManifest` and
`capabilities`. Keep any local filesystem paths out of user-facing summaries
unless the user asks.

2. Create or reuse a Design project:

```bash
pnpm action create-design --title "Local app visual edit" --projectType prototype
```

3. Place URL-backed screens on the overview canvas:

```bash
pnpm action add-localhost-screens '{
  "designId": "<design-id>",
  "connectionId": "<connection-id>",
  "routes": [
    { "path": "/", "title": "Home", "width": 1280, "height": 900 },
    { "path": "/pricing", "title": "Pricing", "width": 1280, "height": 900 },
    { "path": "/checkout?step=payment", "title": "Checkout payment", "width": 1280, "height": 900 }
  ],
  "startX": 0,
  "startY": 0,
  "gap": 160
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

If no `routes` or `paths` are supplied, `add-localhost-screens` uses every route
from the latest localhost manifest. Use `paths` for a concise flow:

```bash
pnpm action add-localhost-screens '{
  "designId": "<design-id>",
  "paths": ["/", "/pricing", "/checkout?step=payment"]
}'
```

4. Navigate the user to overview mode:

```bash
pnpm action navigate --view editor --designId "<design-id>" --editorView overview
```

## Editing URLs

To change a localhost screen's URL, update that screen through
`add-localhost-screens` again using the same route-derived filename/path or use
normal Design screen duplication followed by a route/path update. Keep the file
content as the absolute URL and keep `screenMetadata[fileId]` aligned:

```json
{
  "sourceType": "localhost",
  "previewState": "live",
  "url": "http://localhost:5173/checkout?step=done",
  "previewUrl": "http://localhost:5173/checkout?step=done",
  "path": "/checkout?step=done"
}
```

Do not replace localhost screens with copied `srcdoc` HTML unless the user
explicitly asks to freeze a snapshot.

## Verification

- `list-localhost-connections` returns the expected connection and routes.
- The Design editor opens in overview mode.
- Every requested screen renders the intended localhost URL.
- Alt-dragging a screen copies the URL-backed frame, not an inline HTML clone.
- A query/path edit changes only the target screen's URL metadata and iframe.
