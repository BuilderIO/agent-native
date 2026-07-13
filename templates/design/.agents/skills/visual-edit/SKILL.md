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
- Localhost Edit mode renders the running app through the local bridge as a live
  iframe with the same editor bridge used by HTML designs. It is not a frozen
  static DOM snapshot.
- The live editor is same-origin through the local bridge proxy. This boots
  CSR apps and root-relative assets, but it is still a localhost editing proxy:
  app-origin cookies, WebSockets/HMR, SSE, and non-GET app API calls may need a
  future dev-server/plugin integration for perfect parity with the app's own
  origin.
- Interact mode renders the app's normal URL so app navigation, scrolling,
  links, and form controls behave as they would in the browser.
- While a localhost screen has pending live visual edits, do not switch back to
  Interact until the user either applies the edits to source or explicitly
  aborts/discards the preview.
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

The live-edit bridge is unlocked by a shared secret (the "bridge token") that
must match on two sides: the local bridge process and the user's connection row
(which the browser reads to authorize `/live-edit-bridge`, `/read-file`,
`/write-file`). Let the authenticated `connect-localhost` / `open-visual-edit`
action mint the token, then start the bridge adopting it — the bridge cannot
push its own token to the server without a CLI auth token, so the server mints.

From the target app repo, make sure its dev server is running, then:

**1. Discover routes without a durable bridge** (one-shot, exits):

```bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root . --json
```

Prints the manifest (routes + capabilities). Use it to build `routeManifest` for
the action call. Skip if the user already gave explicit paths/URLs.

**2. Register the connection** via `connect-localhost` / `open-visual-edit`
(Action Flow below) with NO `bridgeToken`. The server mints one, stores it on the
connection row, and returns it as `bridgeToken`. Capture it.

**3. Start the persistent bridge adopting that token:**

```bash
AGENT_NATIVE_BRIDGE_TOKEN="<bridgeToken from step 2>" \
  npx @agent-native/core@latest design connect \
  --url http://localhost:5173 --root . --daemon
```

(Or pass `--bridge-token <token>`; prefer the env var to keep the secret out of
`ps`.) The bridge exposes `GET /manifest.json`, `GET /routes.json`,
`GET /health`, and now authorizes live-edit because its token matches the row.

Only use `--json` for the step-1 route probe. Never use `--json`, `--once`, or
`--dry-run` for the durable step-3 bridge: they print the manifest and exit, so
Design falls back to a non-editable live iframe.

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

## Local Files in the Code Tab

Once a connection is registered, the design editor's Code panel (left rail →
Code, or `navigate --view editor --designId <id> --leftPanel code`) shows a
local-files workspace root for that connection next to the design's own files.
Treat that root like VS Code opened at the connected project directory: file
tree, search, open/edit, and save are backed by the real local files. It lists
the connected app's text/code files through the bridge
(`list-local-files` / `read-local-file`); build output, `node_modules`,
`.git`, and secret-looking paths (`.env*`, key files) are always excluded.

- Browsing and reading need only editor access on the design plus the running
  bridge.
- Saving goes through `write-local-file`: the first save opens the
  write-consent dialog (an 8-hour, folder-scoped grant) and retries
  automatically once granted. Only text/code files are writable; secret paths
  are always blocked.
- Saves are conflict-checked against the file's on-disk version — a file that
  changed since it was read fails with a version conflict instead of being
  overwritten.
- React/TSX canvas edits use build/debug provenance to locate the responsible
  source. A single-instance leaf text edit, literal `className`/`class` edit, or
  flat literal `style={{ ... }}` property may use `apply-visual-edit` with a
  `local-file` source and exact `target.sourceAnchor`. Preview first (omit
  `persist`), inspect `proposedDiff`, then call with `persist: true`; the action
  re-reads and writes through the consented, version-guarded local bridge.
  Structural meaning still belongs to the coding agent. Do not apply a generic
  AST reparent/group/ungroup transform. Repeated `.map()` instances, shared
  components, dynamic expressions, breakpoint edits, and cross-file edits
  always require semantic inspection.
- For every semantic React write, read the file first, pass that exact
  `versionHash` to `write-local-file` with `requireExpectedVersionHash: true`,
  re-read and re-plan if it conflicts, and
  verify the resulting HMR/runtime state before treating the preview as saved.
  Human write consent remains mandatory and cannot be granted by an agent.

## Verification

- `list-localhost-connections` returns the expected connection and routes.
- The Design editor opens in overview mode.
- Every requested screen renders the intended localhost URL.
- Alt-dragging a screen copies the URL-backed frame, not an inline HTML clone.
- A query/path edit changes only the target screen's URL metadata and iframe.
- The Code tab shows a local-files root for the connection and opens its files.
