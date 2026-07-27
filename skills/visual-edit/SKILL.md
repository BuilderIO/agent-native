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

## Installing this skill for an external MCP host

The hosted install path
(`npx @agent-native/core@latest skills add visual-edit`, or `design` for the
full Design bundle) installs the exported instructions and registers the
hosted Design MCP connector together. The open Skills CLI path
(`npx skills@latest add BuilderIO/agent-native --skill visual-edit`) installs
exported instructions only, with no MCP connector registration.

## Core Model

- Each screen is a URL-backed iframe, not copied HTML.
- Each screen keeps URL metadata: `connectionId`, `routeId`, `path`,
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

## Select And Reprompt

When a chat message begins with `[Reprompt selection]`, the selected subtree is
a hard write boundary. The only mutation path is `propose-node-rewrite` with
the exact `repromptId`, target, and `baseVersionHash` captured in
`design-reprompt-pending:<designId>:<fileId>`. Never use `apply-visual-edit`,
`apply-source-edit`, `write-source`, `write-local-file`, `edit-design`, or any
other content-writing action for that request. Clarifying questions are allowed,
but a requested change must remain a proposal.

Produce one variant by default. Produce two or three only when the instruction
asks for options. A retry includes `priorProposalId`; keep the same target and
base version, incorporate the feedback, and call `propose-node-rewrite` again.
The UI previews the returned subtree without persisting it.

Use `resolve-node-rewrite` for the accept/reject lifecycle. Accept applies the
chosen variant as one version-checked inline/Yjs content transaction so one
undo restores the prior structure; reject clears the proposal without changing
content. For conversational resolution such as "apply the second one," call
`view-screen`, read the active `design.reprompt.proposal`, and pass its
`proposalId` plus the zero-based `variantIndex` to `resolve-node-rewrite`.

## Review Quality

- Treat the running app as the truth. Preserve its component language, tokens,
  route state, and real content unless the user explicitly asks for a new visual
  direction.
- Use multiple URL states to reveal meaningful UX moments: empty/loading/error
  states, focused panels, modals, responsive breakpoints, and completed flow
  steps when those matter to the review.
- For visual edits, compare before/after at the relevant viewport sizes and
  check key hover/focus/scroll states when the app exposes them.

## Account And Sharing Model

- The `/visual-edit` entry route can open before the viewer signs in. Public
  `/design/:id` editor links can also render read-only public designs without a
  session.
- Prefer links returned by Design actions or `/_agent-native/open` deep links.
  Do not surface URLs with `_session=` tokens. Query sessions are only a
  fallback after normal cookie resolution, so an existing browser session can
  still open the design as a different user and show "Design not found".
- Do not attempt anonymous write actions. Bridge registration, design creation,
  screen placement, generation, saving, and sharing are account-backed. If a
  signed-out visitor wants to save or share, send them through the framework
  sign-in return flow, then save or copy the design into that account before
  opening the share dialog.

## Required Local Bridge

The live-edit bridge is unlocked by a shared secret (the "bridge token") that
must match on two sides: the local bridge process, and the user's connection row
in Design (which the browser reads to authorize `/live-edit-bridge`,
`/read-file`, `/write-file`). Get them to match by letting the
**authenticated** `open-visual-edit` action mint the token, then starting the
bridge with it. This is the only ordering that works for the remote-MCP flow —
the bridge cannot push its own token to the server without a CLI auth token, so
the server mints instead and the bridge adopts.

From the target app repo, make sure its dev server is running, then:

**1. Discover routes without starting a durable bridge** (one-shot, exits):

```bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root . --json
```

This prints the manifest (routes + capabilities). Parse it to build
`routeManifest` for the next step. (Skip this if the user already gave explicit
paths/URLs to place.)

Inside the agent-native monorepo itself, use the workspace CLI instead of
`npx` — `npx` installs the last published `@agent-native/core`, which will not
contain local changes and costs a slow install on every call:

```bash
pnpm dev:cli design connect --url http://localhost:5173 --root templates/<app> --json
```

**2. Call `open-visual-edit`** (see Action Flow below) with NO `bridgeToken`.
The server mints one, stores it on the user's connection row, copies it into the
placed screens' metadata, and returns it to you as `bridgeToken`. Capture it.

**3. Start the persistent bridge adopting that token** (single line; prefer the
env var so the secret does not appear in `ps`):

```bash
AGENT_NATIVE_BRIDGE_TOKEN="<bridgeToken from step 2>" npx @agent-native/core@latest design connect --url http://localhost:5173 --root . --daemon
```

(Equivalently, pass `--bridge-token <token>`.) This starts a detached bridge on
`http://127.0.0.1:7331`, adopts the server-minted token — so bridge and row
agree and live-edit authorizes with no self-registration — and stays alive after
the command exits.

For a manual health/manifest check on the running bridge:

```bash
curl http://127.0.0.1:7331/health
```

`/health` needs no token. The full manifest at `/manifest.json` is
preview-token protected, so an unauthenticated `curl` of it returns
`{"ok":false,"error":"invalid or missing preview token"}` — that response means
the bridge is up, not that it is broken.

Only use `--json` for the step-1 route probe. Never use `--json`, `--once`,
or `--dry-run` for the durable step-3 bridge: they print the manifest and exit,
so Design falls back to a non-editable live iframe.

The bridge listens on a single fixed port (7331) and refuses to start for a
second, different app. It is detached with no log file, so if `--daemon` reports
a timeout, check for a stale process (`lsof -ti:7331`) before retrying.

## Action Flow

Prefer the single authenticated `open-visual-edit` action. It registers or
refreshes the localhost bridge connection, mints and stores the bridge token,
creates or reuses a Design project, places URL-backed screens, stores the active
visual-edit context, and navigates to overview mode in one call. This avoids
creating a private design under a synthetic CLI user and then handing the browser
a tokenized URL that may be shadowed by an existing session.

Call it BEFORE starting the durable bridge (step 3 above): it does not contact
the bridge, so the bridge need not be running yet, and you need its returned
`bridgeToken` to start the bridge with a matching secret. Omit `bridgeToken`
on the call so the server mints one.

```bash
pnpm action open-visual-edit '{
  "title": "Docs homepage visual edit",
  "devServerUrl": "http://localhost:5173",
  "bridgeUrl": "http://127.0.0.1:7331",
  "rootPath": "/absolute/path/to/app",
  "routeManifest": { "...": "from /manifest.json" },
  "paths": ["/", "/pricing", "/checkout?step=payment"]
}'
```

The action returns `designId`, `connectionId`, `bridgeToken`, `screens`,
`urlPath`, and `openUrl`. Keep `designId`/`connectionId` in the chat context
for follow-ups, and pass `bridgeToken` to `design connect` (step 3) to start
the bridge. On follow-up calls reusing an existing `connectionId`, the same
token is returned (it is minted once and reused), so the running bridge stays
valid.

### Desktop and mobile side by side

Pass `viewports` to place every requested route once per viewport. Frames lay
out as a grid: one row per route, one column per viewport. Presets are
`desktop` (1280x900), `laptop` (1440x900), `tablet` (834x1112), and `mobile`
(390x844); an explicit `{ "label": "...", "width": N, "height": N }` also works.

```bash
pnpm action open-visual-edit '{
  "title": "Tasks responsive visual edit",
  "devServerUrl": "http://localhost:5173",
  "bridgeUrl": "http://127.0.0.1:7331",
  "rootPath": "/absolute/path/to/app",
  "paths": ["/tasks", "/inbox"],
  "viewports": ["desktop", "mobile"]
}'
```

Prefer this over two separate calls with `defaultWidth`/`defaultHeight`: it
keeps each route's viewports aligned in a row and titles them
`Tasks — Desktop` / `Tasks — Mobile` so the canvas reads clearly. `viewports`
overrides `defaultWidth`/`defaultHeight`. With no `routes`/`paths`, it expands
every route in the localhost manifest, which is usually far more frames than
the user wants — name the paths.

### Adding more page frames later

Call `open-visual-edit` again with the same `designId` and `connectionId` and
only the new paths. Existing frames for the same route and viewport are
refreshed in place rather than duplicated, and a frame the user has dragged or
resized keeps its position unless you explicitly pass `x`/`y`/`width`/`height`.

```bash
pnpm action open-visual-edit '{
  "designId": "<existing-design-id>",
  "connectionId": "<existing-connection-id>",
  "devServerUrl": "http://localhost:5173",
  "paths": ["/settings", "/team"],
  "startY": 2200
}'
```

Do NOT add `defaultWidth`/`defaultHeight` just to restate the default size:
supplying either one marks the viewport as explicitly requested, which
overwrites frame sizes the user has already adjusted on the canvas.

For a numbered flow the user describes in chat, keep the labels and order:

```bash
pnpm action open-visual-edit '{
  "designId": "<existing-design-id>",
  "connectionId": "<existing-connection-id>",
  "devServerUrl": "http://localhost:1234",
  "routes": [
    { "url": "localhost:1234/onboarding/1", "title": "Screen 1" },
    { "url": "localhost:1234/onboarding/2", "title": "Screen 2" },
    { "url": "localhost:1234/onboarding/3", "title": "Screen 3" }
  ]
}'
```

If no `routes` or `paths` are supplied, `open-visual-edit` uses every route
from the localhost manifest.

Fallback, only when `open-visual-edit` is unavailable:

1. Register or refresh the bridge with `connect-localhost`, passing the
   `/manifest.json` result as `routeManifest` and `capabilities`.
2. Create or reuse a Design project with `create-design`.
3. Place URL-backed screens with `add-localhost-screens`.
4. Navigate to overview mode with `navigate`.

## Open The Design Surface

- Use the `link`, `deepLink`, or MCP App embed returned by Design actions so
  the user sees the canvas. In Codex Desktop or VS Code, prefer opening that
  Design URL in the available preview/webview panel; otherwise surface the
  "Open design" link.
- Return or open the `openUrl` / action link, not a hand-built
  `/design/:id?_session=...` URL.
- If the user is working in VS Code, the Agent Native extension can open the
  same URL via
  `vscode://builder.agent-native/open?url=<encoded-design-url>`. Its
  `Agent Native: Open Design Canvas` command also starts the local bridge and
  opens hosted Design in the VS Code side panel.
- After `open-visual-edit`, confirm the Design editor is in overview mode
  with the requested URL-backed frames visible, and that they render the app
  rather than a spinner. Do not stop at "screens added" when the user asked to
  inspect or edit visually.

## Applying Visual Edits Back To Source

Canvas edits on a localhost screen do not write source as you make them. They
accumulate as pending edits and the editor shows an "Apply with Design agent"
button in the bottom-right corner of the canvas. Clicking it hands a structured
prompt to the Design agent chat, which performs the real source write.

- Style, text, and drag/drop structure edits all collect into the same pending
  batch, so the user can make several changes and apply once.
- After the write lands, the target app's own dev-server HMR refreshes the
  frames — no manual reload. If frames do not refresh, the write did not land;
  say so rather than assuming.
- The separate disk-icon "Apply to source" button is the deterministic
  whole-file HTML/CSS writer. It is intentionally disabled for compiled
  `.jsx`/`.tsx` routes — those must go through the agent path above.

## Editing URLs

Keep localhost screens as URL files plus `screenMetadata[fileId]`. Do not
replace them with copied `srcdoc` HTML unless the user explicitly asks for a
frozen snapshot. To change a state, rerun `open-visual-edit` with the new
path/query or duplicate the screen and update the copy's URL metadata.

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
- If the agent calls `write-local-file` directly (not through a UI save) and it
  fails with "no write-consent grant", call `request-localhost-write-consent`.
  It opens the write-consent dialog in the editor, or reports `alreadyGranted`
  if one already exists. Granting is human-only —
  `grant-localhost-write-consent` is hidden from agents, so you cannot approve
  it yourself. Tell the user to click "Allow writes", then retry
  `write-local-file` once. Do not keep retrying blindly: the write stays
  blocked until the user approves.
- Saves are conflict-checked against the file's on-disk version — a file that
  changed since it was read fails with a version conflict instead of being
  overwritten.

## React Source Writeback

- Use compiler/debug provenance (project-relative file, line, column,
  component, and runtime multiplicity) to locate React/TSX source. Treat it as
  evidence, not as permission for a generic AST structural transform.
- A single-instance leaf text edit, literal `className`/`class` edit, or flat
  literal `style={{ ... }}` property may use `apply-visual-edit` with a
  `local-file` source and exact `target.sourceAnchor`. Preview first (omit
  `persist`), inspect `proposedDiff`, then call with `persist: true`.
- Reparenting, grouping/ungrouping, wrappers, dynamic expressions, repeated
  `.map()` instances, shared components, breakpoint-scoped edits, and
  cross-file changes go through the coding agent with exact subject/target
  anchors and their runtime relationship. `apply-visual-edit` refuses these
  with `status: "needsAgent"` rather than guessing.
- Before each write, read the file and pass its exact `versionHash` to
  `write-local-file` with `requireExpectedVersionHash: true`; on conflict,
  re-read and re-plan. Keep the optimistic preview until HMR/runtime confirms
  the result. Human write consent remains mandatory and agents cannot grant it.

## Verification

- `list-localhost-connections` returns the expected connection and routes.
- The Design editor opens in overview mode.
- Every requested screen renders the intended localhost URL, showing real app
  content rather than an endless loading spinner.
- Alt-dragging a screen copies the URL-backed frame, not an inline HTML clone.
- A query/path edit changes only the target screen's URL metadata and iframe.
- The Code tab shows a local-files root for the connection and opens its files.
