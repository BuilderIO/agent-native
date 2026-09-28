export const DESIGN_VISUAL_EDIT_SKILL_MD = `---
name: visual-edit
description: >-
  Open and collaboratively edit a running local app in Design, with shared
  fallback previews and source handoff. Use when the user asks to inspect,
  share, or edit a real local app in Design.
metadata:
  visibility: exported
---

# Visual Edit

Use \`/visual-edit\` when the user wants to inspect or edit a real local app
visually instead of generating standalone Alpine HTML. The source of truth is
the running localhost app plus its route URLs. Design shows those routes as
iframe-backed screens on the infinite canvas.

The editor is hosted at \`https://design.agent-native.com\`. Never start local
Design; only the target app and bridge run locally.

## Fast local startup

- Do not install this skill into the target app or start a local Design server.
  The skill belongs to the coding host; Design is always the hosted app above.
- If you need to start an Agent-Native framework app yourself, use
  \`AUTH_DISABLED=1\` with its normal dev command. This is local-only and gives
  the visual editor the framework's dev identity without a user login.
- If an agent-owned local server redirects a requested screen to \`/sign-in\`,
  restart that server with \`AUTH_DISABLED=1\` and probe the route again before
  opening Design. Never present a sign-in page as the requested screen.
- Before calling \`open-visual-edit\`, verify the target URL responds. Start an
  agent-owned dev server with its normal command when it is down, and wait for
  the requested routes to respond before opening Design. Never leave a dead
  localhost URL in the canvas.
- Preserve a server you did not start; use its existing authenticated browser
  session or explain that the target app, rather than Design, requires login.
- When the user gives explicit paths, skip route inventory and place those
  paths directly. Discover routes only when paths were not supplied.

## Installation

\`npx @agent-native/core@latest skills add visual-edit\` installs the skill and
hosted Design MCP connector. \`npx skills@latest add BuilderIO/agent-native
--skill visual-edit\` installs instructions only; page-capable WebMCP hosts need
no connector installation.

## Put Design Beside The Chat

Prefer the interactive MCP App from \`open-visual-edit\`: it keeps Design beside
chat and routes **Apply design updates** through the host's MCP Apps bridge. The
host may ask the user to confirm the current conversation. Otherwise,
\`openUrl\` is a credential-free, read-only fallback; never claim it is editable.

- Inline-browser hosts should open \`https://design.agent-native.com/visual-edit\`
  and call its \`open-visual-edit\` WebMCP tool. It works signed in or out; the
  one-time capability is not a Design account session. A page-capable browser
  controller is enough, so Claude-in-Chrome, Claude Code browser tools, the
  ChatGPT Chrome/browser extension, Puppeteer or Playwright MCP, CDP, and
  similar JavaScript-capable controllers do not need the hosted MCP connector.
- VS Code uses its Design webview/deep link. Without page WebMCP, use the hosted
  Design MCP connector and its normal OAuth/device authorization. Never replace
  either path with a local Design server.

Inside Design, use **Show/Hide UI** from the \`Cmd K\` menu or press Figma's
\`Shift \\\` shortcut to toggle all editing chrome so only the canvas remains.

## Browser WebMCP (Default Without Connector)

Without a connected Design MCP, use a visible browser tab with a main-world
JavaScript evaluator. Prefer the host's inline browser; use external Chrome
only when requested or unavailable. Open
\`https://design.agent-native.com/visual-edit\`, keep it visible while tools
register, and read the title before work. Never enter, copy, or request
passwords, cookies, tokens, or codes. Signed-out loopback visual-edit works;
other pages that block tools behind sign-in still require a signed-in tab.
If the browser exposes CDP permissions, grant \`local-network-access\` to
\`https://design.agent-native.com\` before calling page tools; otherwise use the
page's Connect button and let the browser's permission prompt complete.

Use a native browser-session WebMCP bridge when the host provides one: list
once with \`list-browser-session-webmcp-tools\` and run with
\`run-browser-session-webmcp-tool\`, or use the \`list-host-webmcp-tools\` and
\`run-host-webmcp-tool\` pair. Preserve the exact discovered name, origin, and
args. Otherwise use the page-world API. Agent-Native pages expose this helper:

Example assumes signed-in or existing bridge; fresh signed-out loopback must add
the locally held \`bridgeToken\` described below.

\`\`\`js
const an = window.__agentNativeWebMcp;
const status = await an.ready({ waitMs: 20_000 });
if (status.state !== "ready") throw new Error(status.error ?? status.state);
const tools = await an.tools("visual-edit");
if (!tools.some((tool) => tool.name === "open-visual-edit")) {
  throw new Error("open-visual-edit is not registered yet");
}
const result = await an.call("open-visual-edit", {
  devServerUrl: "http://localhost:5173",
  paths: ["/"],
  navigate: true,
}, { waitMs: 2_000 });
if (result.state === "pending") {
  // On the next evaluation, read the still-running call without replaying it.
  an.result(result.id);
}
\`\`\`

If the helper is absent, use standard WebMCP directly. \`document.modelContext\`
is canonical; \`navigator.modelContext\` is deprecated:

\`\`\`js
const ctx = document.modelContext;
const tool = (await ctx.getTools()).find((candidate) => candidate.name === NAME);
if (!tool) throw new Error(\`WebMCP tool not found: \${NAME}\`);
const codex = typeof ctx.codexExecuteTool === "function" ||
  typeof ctx.codexGetTools === "function";
const result = await ctx.executeTool(tool, codex ? ARGS : JSON.stringify(ARGS));
\`\`\`

The helper handles live discovery, partial registries, and pending calls. If a
call returns \`state: "pending"\`, read \`an.result(id)\` on the next evaluation;
never replay a write. For Claude Code or Cowork, \`javascript_tool\` runs this
page-world code with top-level \`await\`; for Codex open the page with
\`cua.createBrowserTab("iab", url, { visible: true })\`, then use CDP
\`Runtime.evaluate\` with \`awaitPromise: true\`; Puppeteer and Playwright MCP can
use their page evaluator. Playwright isolated worlds cannot see
\`document.modelContext\`. Keep evaluator output small, batch dependent calls,
and do not navigate inside a batch.

Tool descriptors are page-local. Do not copy them into the host, hand-build
authenticated HTTP requests, or replace named tools with clicks, typing, DOM
automation, or screenshots. UI automation remains appropriate for canvas work
without a named tool or when requested. If both bridges are unavailable after
one discovery and one independent evaluator check, use hosted MCP/CLI before
changing state.

For a fresh signed-out loopback connection, generate the bridge token locally,
start the durable bridge with it, and pass that same token once as the page
tool's \`bridgeToken\`; the page never returns it. Reuse a matching running
bridge without the token. Account-backed or private Design work requires a
signed-in session or the authenticated Design MCP connector. After canvas edits,
call \`an.call("get-visual-edit-prompt", {}, { waitMs: 2_000 })\` and apply the
returned handoff. The page tool may show an approval dialog; let the user
approve it and never bypass that consent.

## Core Model

- Each screen is a URL-backed iframe, not copied HTML.
- Each screen keeps URL metadata: \`connectionId\`, \`routeId\`, \`path\`,
  \`url\`, \`bridgeUrl\`, title, and viewport size.
- The owner edits through the local bridge. Shared
  \`/visual-edit/:designId?share=1\` links render a sanitized inert snapshot,
  refreshed on route or DOM changes; guests never reach the owner's localhost.
  Guest edits stay pending until an owner or editor applies them to source.
- Authorized viewers and commenters on private designs can edit the shared
  Visual Edit canvas and submit pending changes without writing design files.
  The owner or editor applies those source changes.
- **The \`/visual-edit\` skill needs no Design account sign-in.**
  \`open-visual-edit\` mints a five-minute, single-use capability for the exact
  \`/visual-edit/:designId\` local-editor route. The MCP host redeems it outside
  model-visible text, then opens the existing editor with localhost edit access.
  A public \`/visual-edit/:designId\` route enables browser-only DOM editing of
  public localhost snapshots; handoffs stay pending until applied. The owner
  sees **Apply edits** when a recipient has pending changes.
  This capability is not an account session: \`/_agent-native/session\` remains
  signed out, and account-backed save/share/generate actions remain denied.
- Hosted MCP highlights \`get-visual-edit-pending\`; pass the visual-edit
  design ID for a tab-free handoff. It returns a revision; after applying,
  call \`acknowledge-visual-edit-pending\` with that revision, then pull again.
  \`empty\` means no edits; \`session-ended\` means edits were lost;
  \`unknown\` means the marker was unreadable, not proof of no change.
- Browser hosts can use page-local \`get-visual-edit-prompt\`.
- The \`open-visual-edit\` action is owned by Design. From another app, use the
  hosted MCP server at \`https://design.agent-native.com/mcp\` or the page's
  WebMCP helper, not \`pnpm action\` in the target app. The page path works
  signed out only for loopback apps in public mode, using a short-lived
  capability-scoped principal; hosted MCP uses its normal OAuth identity.
- Ordinary public links stay read-only. Public \`/visual-edit/:designId\` and
  authorized private shares allow DOM-only edits, never source writes. Guest
  Interact is blocked; snapshots strip active content and owner-local resources,
  and persisted writes stay role-gated. Loopback is not a trust boundary because
  tunnels can proxy remote callers.
- The live editor is same-origin through the local bridge proxy. This boots
  CSR apps and root-relative assets, but it is still a localhost editing proxy:
  app-origin cookies, WebSockets/HMR, SSE, and non-GET app API calls may need a
  future dev-server/plugin integration for perfect parity with the app's own
  origin.
- The canvas is the editing view; Interact runs the normal URL with rails and a
  device bar. Interact preserves navigation, scrolling, links, and controls;
  the canvas pans/zooms and suppresses native frame interaction.
- While a localhost screen has pending live visual edits, do not switch back to
  Interact until the user either applies the edits to source or explicitly
  aborts/discards the preview.
- Alt-drag duplicates a localhost frame and its URL metadata. Change the copy's
  path/query for another state; preserve the order of named or numbered flows.
  Shorthand like \`localhost:1234/onboarding/1\` means
  \`http://localhost:1234/onboarding/1\`.

## Useful Canvas Sets

Use a focused batch of 3-7 frames by default: one ordered frame per requested
route/query state, repeat routes at requested desktop/tablet/mobile viewports,
and include URL-addressable empty, loading, error, modal-open, or selected-item
states. Keep the Screens section readable so Layers remains useful while
editing. Do not expand beyond 7 frames unless the user explicitly asks for an
exhaustive audit or a complete route inventory.

Do not expand every discovered route or every viewport unless the user asks for
an exhaustive audit. Preserve the user's labels and sequence so the canvas
reads like the workflow they described.

## Select And Reprompt

When a chat message begins with \`[Reprompt selection]\`, the selected subtree is
a hard write boundary. The only mutation path is \`propose-node-rewrite\` with
the exact \`repromptId\`, target, and \`baseVersionHash\` captured in
\`design-reprompt-pending:<designId>:<fileId>\`. Never use \`apply-visual-edit\`,
\`apply-source-edit\`, \`write-source\`, \`write-local-file\`, \`edit-design\`, or any
other content-writing action for that request. Clarifying questions are allowed,
but a requested change must remain a proposal.

Produce one variant by default. Produce two or three only when the instruction
asks for options. A retry includes \`priorProposalId\`; keep the same target and
base version, incorporate the feedback, and call \`propose-node-rewrite\` again.
The UI previews the returned subtree without persisting it.

Use \`resolve-node-rewrite\` for the accept/reject lifecycle. Accept applies the
chosen variant as one version-checked inline/Yjs content transaction so one
undo restores the prior structure; reject clears the proposal without changing
content. For conversational resolution such as "apply the second one," call
\`view-screen\`, read the active \`design.reprompt.proposal\`, and pass its
\`proposalId\` plus the zero-based \`variantIndex\` to \`resolve-node-rewrite\`.

## Review Quality

Treat the running app as truth, preserving its component language, tokens, route
state, and content. Compare visual edits before/after at requested viewports and
check meaningful URL, hover, focus, scroll, and modal states.

## Account And Sharing Model

- The capability permits live iframe inspection, session-local edits, undo/redo,
  **Apply design updates**, and **Copy prompt**. These hand bounded source
  instructions to the coding agent; they do not persist account-owned Design data.
- Public \`/design/:id\` links stay read-only without a signed-in owner/editor
  session. Never use the local capability to upgrade that ordinary sharing
  surface.
- Prefer links returned by Design actions or \`/_agent-native/open\` deep links;
  never surface \`_session=\` tokens or hand-build capability URLs.
- Do not attempt account-backed write actions with the browser capability. The
  trusted local \`open-visual-edit\` CLI call may register its bridge, create or
  reuse its workspace-owned local design, and place screens without an account.
  Direct source-file action writes, generation, saving into an account, and
  sharing still require an authenticated action caller. If a signed-out visitor
  wants those durable account operations, send them through the framework
  sign-in return flow first.

## Required Local Bridge

The live-edit bridge is unlocked by a shared secret (the "bridge token") that
must match on two sides: the local bridge process, and the user's connection row
in Design (which the browser reads to authorize \`/live-edit-bridge\`,
\`/read-file\`, \`/write-file\`). Get them to match by letting the
\`open-visual-edit\` action mint the token, then starting the
bridge with it. This is the only ordering that works for the remote-MCP flow -
the bridge cannot push its own token to the server without a CLI auth token, so
the server mints instead and the bridge adopts.
The \`connectionId\` (usually \`localhost_...\`) only identifies the row; never
pass it as \`bridgeToken\`.

For a fresh signed-out browser flow, generate the token locally, keep it in the
host process, and pass it once as the page tool's optional \`bridgeToken\`; the
page never returns it:

\`\`\`bash
BRIDGE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
AGENT_NATIVE_BRIDGE_TOKEN="$BRIDGE_TOKEN" npx @agent-native/core@latest design connect --url http://localhost:5173 --root . --daemon
\`\`\`

Reuse an existing matching connection without \`bridgeToken\`; hosted MCP can
mint the token when page WebMCP is unavailable.

From the target app repo, make sure its dev server is running, then:

**1. Discover routes without starting a durable bridge** (one-shot, exits):

\`\`\`bash
npx @agent-native/core@latest design connect --url http://localhost:5173 --root . --json
\`\`\`

This prints the manifest (routes + capabilities). Parse it to build
\`routeManifest\` for the next step. (Skip this if the user already gave explicit
paths/URLs to place.)

Inside the agent-native monorepo itself, use the workspace CLI instead of
\`npx\` — \`npx\` installs the last published \`@agent-native/core\`, which will not
contain local changes and costs a slow install on every call:

\`\`\`bash
pnpm dev:cli design connect --url http://localhost:5173 --root templates/<app> --json
\`\`\`

**2. For the hosted MCP path, call \`open-visual-edit\`** (see Action Flow below)
with NO \`bridgeToken\`.
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
curl http://127.0.0.1:7331/health
\`\`\`

\`/health\` needs no token. The full manifest at \`/manifest.json\` is
preview-token protected, so an unauthenticated \`curl\` of it returns
\`{"ok":false,"error":"invalid or missing preview token"}\` — that response means
the bridge is up, not that it is broken.

Only use \`--json\` for the step-1 route probe. Never use \`--json\`, \`--once\`,
or \`--dry-run\` for the durable step-3 bridge: they print the manifest and exit,
so Design falls back to a non-editable live iframe.

The bridge listens on a single fixed port (7331) and refuses to start for a
second, different app. It is detached with no log file, so if \`--daemon\` reports
a timeout, check for a stale process (\`lsof -ti:7331\`) before retrying.

If local Design uses PGlite, never invoke the in-process CLI against that server:
both open the same directory and the second owner is rejected. For a signed-out
local test, start Design with \`AUTH_DISABLED=1\`, open \`/visual-edit\`, and call
the server-action \`open-visual-edit\` through \`window.__agentNativeWebMcp\` after
it registers. This keeps one PGlite owner; \`get-visual-edit-prompt\` is only the
post-edit handoff. With auth enabled, sign in to hosted Design MCP or use shared
Postgres before using the CLI action.

## Action Flow

When a browser is available, reuse the local bridge and call the Design page's
\`open-visual-edit\` WebMCP tool. For a fresh signed-out connection, pass the
locally held \`bridgeToken\`; it reads its preview manifest and challenge proof,
then sends both for validation. Hosted Design never fetches \`127.0.0.1\`. If the
page has no WebMCP, use the connected Design MCP server or its normal hosted
MCP fallback.

From another app, call the connected Design MCP tool
\`mcp__agent-native-design__open-visual-edit\` with the JSON arguments below. It
registers or refreshes the localhost bridge,
mints and stores the bridge token, creates or reuses a Design project, places
URL-backed screens, stores visual-edit context, and navigates to overview mode
in one call. Never run \`pnpm action\` from the target app's checkout: its local
registry does not contain Design actions.

Call it before starting the durable bridge: it does not contact the bridge, so
the server can mint \`bridgeToken\` for the bridge to adopt. Omit that input.

\`\`\`json
{
  "title": "Docs homepage visual edit",
  "devServerUrl": "http://localhost:5173",
  "bridgeUrl": "http://127.0.0.1:7331",
  "rootPath": "/absolute/path/to/app",
  "routeManifest": { "...": "from /manifest.json" },
  "paths": ["/", "/pricing", "/checkout?step=payment"]
}
\`\`\`

The action returns \`designId\`, \`connectionId\`, \`bridgeToken\`, \`screens\`,
\`urlPath\`, and credential-free \`openUrl\`. MCP App metadata carries the
hidden one-time launcher. Keep the ids for follow-ups
and pass the token to \`design connect\`; reusing the connection reuses its token.

### Desktop and mobile side by side

Pass \`viewports\` to place every requested route once per viewport. Frames lay
out as a grid: one row per route, one column per viewport. Presets are
\`desktop\` (1280x900), \`laptop\` (1440x900), \`tablet\` (834x1112), and \`mobile\`
(390x844); an explicit \`{ "label": "...", "width": N, "height": N }\` also works.

\`\`\`json
{
  "title": "Tasks responsive visual edit",
  "devServerUrl": "http://localhost:5173",
  "bridgeUrl": "http://127.0.0.1:7331",
  "rootPath": "/absolute/path/to/app",
  "paths": ["/tasks", "/inbox"],
  "viewports": ["desktop", "mobile"]
}
\`\`\`

Prefer this over two separate calls with \`defaultWidth\`/\`defaultHeight\`: it
keeps each route's viewports aligned in a row and titles them
\`Tasks — Desktop\` / \`Tasks — Mobile\` so the canvas reads clearly. \`viewports\`
overrides \`defaultWidth\`/\`defaultHeight\`. With no \`routes\`/\`paths\`, it expands
every route in the localhost manifest, which is usually far more frames than
the user wants — name the paths.

### Managing screens and breakpoints manually

Select a screen and use the right-rail **Screen** section to switch between
Static HTML and URL-backed modes, edit its route/path, choose a localhost
connection, add another URL screen, or remove the selected screen. URL mode
keeps the iframe live; switching to Static stores a sanitized snapshot of the
current frame, including its current client state when the page can provide it.
The same operations are available to a page-capable agent through
\`add-localhost-screens\`, \`update-screen-source\`, \`add-breakpoint\`, and
\`remove-breakpoint\`.

### Adding more page frames later

Call \`open-visual-edit\` again with the same \`designId\` and \`connectionId\` and
only the new paths. Existing frames for the same route and viewport are
refreshed in place rather than duplicated, and a frame the user has dragged or
resized keeps its position unless you explicitly pass \`x\`/\`y\`/\`width\`/\`height\`.

\`\`\`json
{
  "designId": "<existing-design-id>",
  "connectionId": "<existing-connection-id>",
  "devServerUrl": "http://localhost:5173",
  "paths": ["/settings", "/team"],
  "startY": 2200
}
\`\`\`

Do NOT add \`defaultWidth\`/\`defaultHeight\` just to restate the default size:
supplying either one marks the viewport as explicitly requested, which
overwrites frame sizes the user has already adjusted on the canvas.

For a numbered flow the user describes in chat, keep the labels and order:

\`\`\`json
{
  "designId": "<existing-design-id>",
  "connectionId": "<existing-connection-id>",
  "devServerUrl": "http://localhost:1234",
  "routes": [
    { "url": "localhost:1234/onboarding/1", "title": "Screen 1" },
    { "url": "localhost:1234/onboarding/2", "title": "Screen 2" },
    { "url": "localhost:1234/onboarding/3", "title": "Screen 3" }
  ]
}
\`\`\`

If no \`routes\` or \`paths\` are supplied, \`open-visual-edit\` uses every route
from the localhost manifest.

Fallback only when \`open-visual-edit\` is unavailable and hosted Design MCP is
authorized:

1. Register or refresh the bridge with \`connect-localhost\`, passing the
   \`/manifest.json\` result as \`routeManifest\` and \`capabilities\`.
2. Create or reuse a Design project with \`create-design\`.
3. Place URL-backed screens with \`add-localhost-screens\`.
4. Navigate to overview mode with \`navigate\`.

The fallback still targets \`https://design.agent-native.com\`; only the app and
bridge URLs are localhost. Never run \`pnpm action\` from \`templates/design\`.

## Open The Design Surface

- Use the \`link\`, \`deepLink\`, or MCP App embed returned by Design actions so the
  user sees the canvas. Prefer the MCP App; its host launcher carries the
  one-time capability. The credential-free \`openUrl\` is read-only fallback.
- Never return or open a hand-built \`/design/:id?_session=...\` URL.
- If the user is working in VS Code, the Agent-Native extension can open the
  same URL via
  \`vscode://builder.agent-native/open?url=<encoded-design-url>\`. Its
  \`Agent-Native: Open Design Canvas\` command also starts the local bridge and
  opens hosted Design in the VS Code side panel.
- Once \`open-visual-edit\` returns the expected \`screenCount\`, hand back the
  link and stop. Do not open it yourself in a browser-automation tool to
  screenshot or poll until it renders — a cold dev server can take 10-30s
  regardless of who's watching, and that wait adds nothing the response didn't
  already confirm. Reach for browser automation only if the user later reports
  the canvas is broken.

## Applying Visual Edits Back To Source

With Design closed, call hosted Design MCP's highlighted
\`get-visual-edit-pending\` for the design ID; it returns the handoff and
revision. Verify the applied source, acknowledge that revision, then pull again.
If MCP is unavailable, read the local bridge:

\`\`\`bash
npx @agent-native/core@latest design pending --root . --design-id <design-id-from-visual-edit-url>
\`\`\`

Pass the ID after \`visual-edit\` in the Design URL; the CLI prints that
design's prompt (\`null\` when empty).

Canvas edits on a localhost screen never write source directly. They stay
pending until the canvas shows **Apply design updates** (local) or **Apply edits**
(shared). An MCP App sends its prompt through the host or local Design agent;
otherwise use **Copy prompt to your agent**.

ChatGPT and Claude Code should pull, apply, acknowledge, and pull again.
Browser WebMCP hosts can call \`get-visual-edit-prompt\`. Never acknowledge
before applying the source change.

- Style, text, and drag/drop edits collect into one pending batch for a single
  apply.
- After the write lands, the target app's own dev-server HMR refreshes the
  frames — no manual reload. If frames do not refresh, the write did not land;
  say so rather than assuming.
- The separate disk-icon "Apply to source" button is the deterministic
  whole-file HTML/CSS writer. It is intentionally disabled for compiled
  \`.jsx\`/\`.tsx\` routes — those must go through the agent path above.

## Editing URLs

Keep localhost screens as URL files plus \`screenMetadata[fileId]\`. Do not
replace them with copied \`srcdoc\` HTML unless the user explicitly asks for a
frozen snapshot. To change a state, rerun \`open-visual-edit\` with the new
path/query, use the Screen settings section, call \`update-screen-source\`, or
duplicate the screen and update the copy's URL metadata.

## Local Files in the Code Tab

Once a connection is registered, the design editor's Code panel (left rail →
Code, or \`navigate --view editor --designId <id> --leftPanel code\`) shows a
local-files workspace root for that connection next to the design's own files.
Treat that root like VS Code opened at the connected project directory: file
tree, search, open/edit, and save are backed by the real local files. It lists
the connected app's text/code files through the bridge
(\`list-local-files\` / \`read-local-file\`); build output, \`node_modules\`,
\`.git\`, and secret-looking paths (\`.env*\`, key files) are always excluded.

- Browsing and reading need only editor access on the design plus the running
  bridge.
- Saving goes through \`write-local-file\`: the first save opens the
  write-consent dialog (an 8-hour, folder-scoped grant) and retries
  automatically once granted. Only text/code files are writable; secret paths
  are always blocked.
- If the agent calls \`write-local-file\` directly (not through a UI save) and it
  fails with "no write-consent grant", call \`request-localhost-write-consent\`.
  It opens the write-consent dialog in the editor, or reports \`alreadyGranted\`
  if one already exists. Granting is human-only —
  \`grant-localhost-write-consent\` is hidden from agents, so you cannot approve
  it yourself. Tell the user to click "Allow writes", then retry
  \`write-local-file\` once. Do not keep retrying blindly: the write stays
  blocked until the user approves.
- Saves are conflict-checked against the file's on-disk version — a file that
  changed since it was read fails with a version conflict instead of being
  overwritten.

## React Source Writeback

- Use compiler/debug provenance (project-relative file, line, column,
  component, and runtime multiplicity) to locate React/TSX source. Treat it as
  evidence, not as permission for a generic AST structural transform.
- Read \`positionPrecision\` on every anchor before you trust \`line\`/\`column\`.
  \`authored\` means those are the real JSX coordinates. \`transformed\` means they
  are the dev server's own output coordinates — React 19 removed \`_debugSource\`
  and exposes only an owner stack, so this is the normal case on a Vite/Next
  dev server, and the line will not match the file. \`unknown\` means no tier was
  reported. On anything but \`authored\`, use the file and component to find the
  element by its JSX shape and re-derive the line from the file you read; never
  edit at the reported line.
- A single-instance leaf text edit, literal \`className\`/\`class\` edit, or flat
  literal \`style={{ ... }}\` property may use \`apply-visual-edit\` with a
  \`local-file\` source and a complete \`target.sourceAnchor\`. Forward the
  anchor's \`positionPrecision\` with it — the action refuses a \`transformed\`
  anchor with \`status: "needsAgent"\` instead of seeking to a line that means
  something else in the authored file. Preview first (omit \`persist\`), inspect
  \`proposedDiff\`, then call with \`persist: true\`.
- Reparenting, grouping/ungrouping, wrappers, dynamic expressions, repeated
  \`.map()\` instances, shared components, breakpoint-scoped edits, and
  cross-file changes go through the coding agent with complete subject/target
  anchors and their runtime relationship. \`apply-visual-edit\` refuses these
  with \`status: "needsAgent"\` rather than guessing.
- Before each write, read the file and pass its exact \`versionHash\` to
  \`write-local-file\` with \`requireExpectedVersionHash: true\`; on conflict,
  re-read and re-plan. Keep the optimistic preview until HMR/runtime confirms
  the result. Human write consent remains mandatory and agents cannot grant it.

## Verification

For a plain "open this app" request, \`open-visual-edit\`'s own response is
the verification — see Open The Design Surface. Reach for the checks below
only to diagnose an actual report, or to confirm an applied edit landed:

- \`list-localhost-connections\` returns the expected connection and routes.
- The Design editor opens in overview mode.
- Every requested screen renders the intended localhost URL, showing real app
  content rather than an endless loading spinner.
- The screen iframe carries a \`src\`, not a \`srcdoc\`. A localhost screen with a
  \`srcdoc\` is a bug, not a slow load — check it in the browser devtools before
  reporting the canvas as working.
- Alt-dragging a screen copies the URL-backed frame, not an inline HTML clone.
- A query/path edit changes only the target screen's URL metadata and iframe.
- \`get-visual-edit-pending\` is the tab-free handoff; acknowledge its revision
  after applying. \`get-visual-edit-prompt\` is the browser equivalent.
- The Code tab shows a local-files root for the connection and opens its files.
`;
