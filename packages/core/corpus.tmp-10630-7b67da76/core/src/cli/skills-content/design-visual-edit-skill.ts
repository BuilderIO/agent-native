export const DESIGN_VISUAL_EDIT_SKILL_MD = `---
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

Use \`/visual-edit\` when the user wants to inspect or edit a real local app
visually instead of generating standalone Alpine HTML. The source of truth is
the running localhost app plus its route URLs. Design shows those routes as
iframe-backed screens on the infinite canvas.

## Core Model

- Each screen is a URL-backed iframe, not copied HTML.
- Each screen keeps URL metadata: \`connectionId\`, \`routeId\`, \`path\`,
  \`url\`, \`bridgeUrl\`, title, and viewport size.
- Start in Design's screen overview mode. In overview, screens are static
  design frames; full-screen focus is for scrolling and app interaction.
- Alt-drag duplicates a screen. For localhost screens, duplication copies the
  iframe frame and URL metadata; change the copy's path/query for a new state.
- Flow visualization is multiple URL states: \`/checkout?step=shipping\`,
  \`/checkout?step=payment\`, \`/checkout?step=done\`, etc.
- When the user gives a named flow or numbered screen list, preserve that order
  and create one screen per URL/path. Shorthand like
  \`localhost:1234/onboarding/1\` means
  \`http://localhost:1234/onboarding/1\`.

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

- The \`/visual-edit\` entry route can open before the viewer signs in. Public
  \`/design/:id\` editor links can also render read-only public designs without a
  session.
- Prefer links returned by Design actions or \`/_agent-native/open\` deep links.
  Do not surface URLs with \`_session=\` tokens. Query sessions are only a
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
in Design (which the browser reads to authorize \`/live-edit-bridge\`,
\`/read-file\`, \`/write-file\`). Get them to match by letting the
**authenticated** \`open-visual-edit\` action mint the token, then starting the
bridge with it. This is the only ordering that works for the remote-MCP flow —
the bridge cannot push its own token to the server without a CLI auth token, so
the server mints instead and the bridge adopts.

From the target app repo, make sure its dev server is running, then:

**1. Discover routes without starting a durable bridge** (one-shot, exits):

\`\`\`bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root . --json
\`\`\`

This prints the manifest (routes + capabilities). Parse it to build
\`routeManifest\` for the next step. (Skip this if the user already gave explicit
paths/URLs to place.)

**2. Call \`open-visual-edit\`** (see Action Flow below) with NO \`bridgeToken\`.
The server mints one, stores it on the user's connection row, copies it into the
placed screens' metadata, and returns it to you as \`bridgeToken\`. Capture it.

**3. Start the persistent bridge adopting that token** (single line; prefer the
env var so the secret does not appear in \`ps\`):

\`\`\`bash
AGENT_NATIVE_BRIDGE_TOKEN="<bridgeToken from step 2>" npx @agent-native/core@latest design connect --url http://localhost:5173 --root . --daemon
\`\`\`

(Equivalently, pass \`--bridge-token <token>\`.) This starts a detached bridge on
\`http://127.0.0.1:7331\`, adopts the server-minted token — so bridge and row
agree and live-edit authorizes with no self-registration — and stays alive after
the command exits.

For a manual health/manifest check on the running bridge:

\`\`\`bash
curl http://127.0.0.1:7331/manifest.json
\`\`\`

Only use \`--json\` for the step-1 route probe. Never use \`--json\`, \`--once\`,
or \`--dry-run\` for the durable step-3 bridge: they print the manifest and exit,
so Design falls back to a non-editable live iframe.

## Action Flow

Prefer the single authenticated \`open-visual-edit\` action. It registers or
refreshes the localhost bridge connection, mints and stores the bridge token,
creates or reuses a Design project, places URL-backed screens, stores the active
visual-edit context, and navigates to overview mode in one call. This avoids
creating a private design under a synthetic CLI user and then handing the browser
a tokenized URL that may be shadowed by an existing session.

Call it BEFORE starting the durable bridge (step 3 above): it does not contact
the bridge, so the bridge need not be running yet, and you need its returned
\`bridgeToken\` to start the bridge with a matching secret. Omit \`bridgeToken\`
on the call so the server mints one.

\`\`\`bash
pnpm action open-visual-edit '{
  "title": "Docs homepage visual edit",
  "devServerUrl": "http://localhost:5173",
  "bridgeUrl": "http://127.0.0.1:7331",
  "rootPath": "/absolute/path/to/app",
  "routeManifest": { "...": "from /manifest.json" },
  "paths": ["/", "/pricing", "/checkout?step=payment"]
}'
\`\`\`

The action returns \`designId\`, \`connectionId\`, \`bridgeToken\`, \`screens\`,
\`urlPath\`, and \`openUrl\`. Keep \`designId\`/\`connectionId\` in the chat context
for follow-ups, and pass \`bridgeToken\` to \`design connect\` (step 3) to start
the bridge. On follow-up calls reusing an existing \`connectionId\`, the same
token is returned (it is minted once and reused), so the running bridge stays
valid.

For a numbered flow the user describes in chat, keep the labels and order:

\`\`\`bash
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
\`\`\`

For responsive follow-ups, call \`open-visual-edit\` again with the same
\`designId\` and \`connectionId\`, plus explicit viewport dimensions:

\`\`\`bash
pnpm action open-visual-edit '{
  "designId": "<existing-design-id>",
  "connectionId": "<existing-connection-id>",
  "devServerUrl": "http://localhost:5173",
  "paths": ["/"],
  "defaultWidth": 390,
  "defaultHeight": 844,
  "startX": 1600,
  "startY": 0
}'
\`\`\`

If no \`routes\` or \`paths\` are supplied, \`open-visual-edit\` uses every route
from the localhost manifest.

Fallback, only when \`open-visual-edit\` is unavailable:

1. Register or refresh the bridge with \`connect-localhost\`, passing the
   \`/manifest.json\` result as \`routeManifest\` and \`capabilities\`.
2. Create or reuse a Design project with \`create-design\`.
3. Place URL-backed screens with \`add-localhost-screens\`.
4. Navigate to overview mode with \`navigate\`.

## Open The Design Surface

- Use the \`link\`, \`deepLink\`, or MCP App embed returned by Design actions so
  the user sees the canvas. In Codex Desktop or VS Code, prefer opening that
  Design URL in the available preview/webview panel; otherwise surface the
  "Open design" link.
- Return or open the \`openUrl\` / action link, not a hand-built
  \`/design/:id?_session=...\` URL.
- If the user is working in VS Code, the Agent Native extension can open the
  same URL via
  \`vscode://builder.agent-native/open?url=<encoded-design-url>\`. Its
  \`Agent Native: Open Design Canvas\` command also starts the local bridge and
  opens hosted Design in the VS Code side panel.
- After \`add-localhost-screens\`, confirm the Design editor is in overview mode
  with the requested URL-backed frames visible. Do not stop at "screens added"
  when the user asked to inspect or edit visually.

## Editing URLs

Keep localhost screens as URL files plus \`screenMetadata[fileId]\`. Do not
replace them with copied \`srcdoc\` HTML unless the user explicitly asks for a
frozen snapshot. To change a state, rerun \`add-localhost-screens\` with the new
path/query or duplicate the screen and update the copy's URL metadata.

## React Source Writeback

- Use compiler/debug provenance (project-relative file, line, column,
  component, and runtime multiplicity) to locate React/TSX source. Treat it as
  evidence, not as permission for a generic AST structural transform.
- Reparenting, grouping/ungrouping, wrappers, dynamic expressions, repeated
  \`.map()\` instances, shared components, and cross-file changes go through the
  coding agent with exact subject/target anchors and their runtime
  relationship.
- Before each write, read the file and pass its exact \`versionHash\` to
  \`write-local-file\` with \`requireExpectedVersionHash: true\`; on conflict,
  re-read and re-plan. Keep the optimistic preview until HMR/runtime confirms
  the result. Human write consent remains mandatory and agents cannot grant it.

## Verification

- \`list-localhost-connections\` returns the expected connection and routes.
- The Design editor opens in overview mode.
- Every requested screen renders the intended localhost URL.
- Alt-dragging a screen copies the URL-backed frame, not an inline HTML clone.
`;
