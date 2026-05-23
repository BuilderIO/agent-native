---
name: external-agents
description: >-
  Connect external agents and MCP hosts (Claude, Claude Desktop, Claude Code,
  ChatGPT custom MCP apps, Codex, Cursor, Claude Cowork, VS Code GitHub
  Copilot, Goose, Postman, MCPJam) to an agent-native app over MCP, and
  round-trip artifacts back into the UI with MCP Apps and deep links. Use when
  adding an action's `link` builder or `mcpApp`, wiring the
  `/_agent-native/open` route, exposing an "ingest" action to MCP/A2A, or
  scaffolding apps from an external agent.
---

# External Agents (MCP bridge + deep links)

## Rule

An agent-native app is reachable by any MCP-compatible host (Claude, Claude
Desktop, Claude Code, ChatGPT custom MCP apps, Codex, Cursor, Cowork, VS Code
GitHub Copilot, Goose, Postman, MCPJam, and future standard clients). Keep
setup simple: for workspace or cross-app access, add one remote MCP connector:
`https://dispatch.agent-native.com/_agent-native/mcp`. Dispatch's Agents page
controls whether that single connector reaches all apps or only selected apps,
and Dispatch filters `list_apps`, `ask_app`, and `open_app` to the granted set.
For a deliberately isolated app, add that app directly at
`https://<app>.agent-native.com/_agent-native/mcp` or
`https://<your-host>/_agent-native/mcp`.

OAuth-capable hosts should use the standard remote MCP OAuth flow. Claude
connectors and Claude Code `/mcp` authentication discover the protected
resource, open the Agent-Native authorization page, and store their own tokens.
ChatGPT custom MCP connectors use the same URL: choose OAuth, scan/discover
tools, sign in, and approve the scopes. Local stdio proxying and older clients
can still use `npx @agent-native/core connect <url>`, which mints a per-user,
scoped, revocable token from a logged-in browser session; no shared secret is
copied.

Claude and ChatGPT can cache custom connector tool/resource metadata. After
changing MCP App metadata or the shared `embedApp()` shell, validate with a
fresh tool call; if the host still behaves like the old descriptor, reconnect
the Claude connector or rescan/review the ChatGPT connector.

Once connected, every action that produces or lists a navigable resource SHOULD
return a deep link from a `link` builder, so the external agent can surface an
**"Open in <app> →"** link that drops the user back into the running UI at the
right view and record. Actions can also declare `mcpApp` so hosts that support
MCP Apps render an inline interactive preview. The link is a pure pointer —
the record-focusing write is always scoped to the **browser session**, never
the agent's token.

## Why

External agents are great at producing artifacts (a draft, an event, a
dashboard) but they live in a terminal, chat host, or another app. Without a
bridge, the user gets a wall of JSON and has to go find the thing. MCP Apps
give compatible hosts an inline review/edit surface; the deep-link bridge
closes the loop everywhere else by handing the user a single link that opens
the real app focused on exactly what was produced. It reuses the existing
`navigate` / `application_state` contract the UI already drains every 2s (see
**context-awareness**) — we never invent a second navigation mechanism.

## How

### 1. Connect to hosted apps

Use one connector for normal workspace access:

```text
https://dispatch.agent-native.com/_agent-native/mcp
```

Then open Dispatch → Agents to choose whether the gateway exposes every app or
only selected app IDs. External agents call `list_apps` to see the granted set,
`ask_app` to route a natural-language task over A2A to a granted app, and
`open_app` to return a deep link or inline app preview.

Use a direct app URL only when you intentionally want one isolated app:

```text
https://mail.agent-native.com/_agent-native/mcp
https://<your-app>.agent-native.com/_agent-native/mcp
```

Claude / Claude Desktop: add a custom connector with the URL, click Connect,
then sign in and approve `mcp:read`, `mcp:write`, and `mcp:apps`. Claude Code:
add the same remote HTTP URL, restart if needed, run `/mcp`, and choose
Authenticate. ChatGPT: create a custom MCP connector/app, paste the same URL,
choose OAuth, scan/discover tools, then sign in and approve scopes. Each host
stores its own OAuth tokens; MCP App iframes never receive raw tokens because
the host mediates tool and resource calls over the authenticated MCP
connection.

For local stdio proxying, Codex/Cowork compatibility, or clients without
remote MCP OAuth, use the hosted connect fallback:

```bash
npx @agent-native/core connect https://dispatch.agent-native.com
# or, for an isolated app:
npx @agent-native/core connect https://mail.agent-native.com
```

The command opens the app in the browser, the user clicks **Authorize**, and a
per-user, scoped, revocable token is written to the selected client config. The
no-CLI equivalent is `https://<app>/_agent-native/mcp/connect`, which shows
the copyable MCP URL, Claude / ChatGPT / Cursor / Claude Code / Codex / Other
steps, and static-token fallback for clients that need it.

Re-running `agent-native connect <url> --client claude-code` over an older
Claude bearer-token entry is the migration path: the CLI replaces
`Authorization` headers with URL-only OAuth config and tells the user to
authenticate from `/mcp`.

Under the hood: a logged-in browser session mints an `A2A_SECRET`-signed JWT
carrying the caller's `sub` + `org_domain` and a unique `jti`, so tool runs
stay tenant-scoped via `runWithRequestContext`. The existing
`/_agent-native/mcp` endpoint accepts it like any bearer — no new endpoint.
The same Connect page lists and revokes minted tokens by `jti`; treat them
like personal access tokens. Nothing exposes the deployment's shared secret.

### 1a. Generic cross-app verbs + scaffolding

Once connected, on top of the per-action tools the MCP server also exposes a
stable verb set (see `packages/core/src/mcp/builtin-tools.ts`) so an external
agent has a predictable surface without guessing per-app action names:

- `list_apps` — workspace apps + their URLs / running state.
- `open_app({ app, view?, path?, params?, embed? })` — returns a deep link or
  direct same-origin app route (no user-data side effects); surfaces as an
  "Open …" link and, with `embed: true`, an inline full-app MCP App in capable
  hosts.
- `ask_app({ app, message })` — routes a natural-language task to that app's
  in-app agent (delegates to the existing `ask-agent` meta-tool).
- `create_workspace_app({ name, template })` — scaffolds + boots a new app via
  the workspace path (rejects non-allow-listed templates), returns its running
  URL + deep link.
- `list_templates` — the allow-listed templates only.

A same-named template action overrides a builtin (template-over-core
precedence). Disable the set with `MCPConfig.builtinCrossAppTools: false`.

The advertised `tools/list` and `resources/list` catalogs are intentionally
tiny by default for ChatGPT/Claude-style app hosts, including OAuth MCP Apps
callers and generic authenticated remote HTTP/static-token callers. The model
sees the generic app-facing verbs (`list_apps`, `open_app`, `ask_app`, and
app-only `create_embed_session`) and routes UI through
`open_app({ embed: true })`. Stdio/code clients that explicitly identify as
developer clients keep the full connected action surface, and
`publicAgent.expose` remains the opt-in for safe read/ingest tools outside the
compact MCP Apps catalog. Do not rely on action-specific `mcpApp` resources
appearing in ChatGPT/Claude discovery by default; use `open_app` for the
first-class app embed path. If a specific
action truly must remain visible in that compact app-host catalog, set
`mcpApp.compactCatalog: true` as a rare escape hatch.

### 1b. Fast-path expectations for MCP Apps hosts

Keep ChatGPT/Claude paths short. For a known app-facing intent, the external
agent should call the specific action that creates or opens the thing, then let
the MCP App launch the route. Do **not** route simple UI handoffs
through `ask_app`, broad `list_resources`, or generic app-agent delegation just
to find a screen.

Expected shape:

- Email draft: `manage_draft` → inline Mail compose route. The widget calls
  `create_embed_session` itself.
- Dashboard/filter/search: `open_app({ path, embed: true })` or the dashboard
  action with `mcpApp` → inline full app/dashboard route.
- Calendar invite: `manage-event-draft` → inline Calendar event draft route.
- Forms/content/slides/design/clips: create/search action with `mcpApp` →
  inline editor/player route.

`list_apps` is fine when the model genuinely needs to choose among granted
apps. `resources/list`/`resources/read` are host plumbing for MCP Apps UI
resources; they are not a planning strategy. If a host/model repeatedly calls
large discovery tools before obvious app-facing actions, tighten action names,
descriptions, `mcpApp` metadata, or compact-catalog filtering until the direct
path is obvious.

### 2. Add a `link` builder to an action

`defineAction` accepts an optional `link` builder. When set, every MCP/A2A
result for that tool auto-appends a markdown `[label →](absoluteUrl)` block and
a structured `_meta["agent-native/openLink"] = { label, view, webUrl,
desktopUrl }`; `tools/list` adds
`annotations["agent-native/producesOpenLink"]` plus a description suffix so the
external agent knows the tool yields an openable link.

Real example — mail's `manage-draft` (`templates/mail/actions/manage-draft.ts`):

```ts
import { buildDeepLink } from "@agent-native/core/server";

function composeDeepLink(draft: Record<string, string>): string {
  return buildDeepLink({
    app: "mail",
    view: "inbox",
    compose: encodeComposeDraft(draft), // base64url JSON → compose-<id> draft
  });
}

export default defineAction({
  // ...schema, run...
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const draft = (result as { draft?: Record<string, string> }).draft;
    const id = (result as { id?: string }).id;
    if (!draft || !id) return null;
    return { url: composeDeepLink(draft), label: "Open draft in Mail", view: "inbox" };
  },
});
```

List/search actions point at a record-focused view the same way — mail's
`list-emails` returns
`{ url: buildDeepLink({ app: "mail", view: "inbox", params: { label, search } }), label: "Open list in Mail" }`.

**The `link` contract:** pure, synchronous, **no I/O, no awaits**. It runs
best-effort — a throw, `null`, or `undefined` is swallowed and **never** fails
the tool call. It only reads the call's `args` and `result`; it must not query
the DB, read app-state, or call other actions.

### 2a. Optional MCP Apps UI

For hosts that support the MCP Apps extension, an action can also advertise an
inline UI resource with `mcpApp`. This is a progressive enhancement for flows
where the external agent should hand the user an interactive surface instead of
only text — for example reviewing an email draft, editing a calendar invite, or
choosing between generated dashboard variants.

Use the real React app with `embedApp()` whenever the user needs UI. The mental
model is simple: the action's `link` target is also the MCP App embed target.
Expose the operation as a normal action/tool, return a focused deep link with
`link`, and add `mcpApp.resource = embedApp(...)` so capable hosts load that
same route inline instead of opening a new tab.

`embedApp()` supports both host bridges. Standard MCP Apps hosts use the
`ui/*` bridge; ChatGPT uses the `window.openai` compatibility bridge, reading
`toolInput` / `toolOutput` / `toolResponseMetadata` and calling
`create_embed_session` through `window.openai.callTool(...)`. Do not build a
ChatGPT-only HTML surface. Keep the action result and `link` target focused so
both bridges land on the same real app route.

That means full-app embeds can do anything the route can do once opened:
review or edit an email draft, show a filtered inbox/search, open a calendar
event or event draft, load an extension page, inspect a full analytics
dashboard or saved analysis, continue a deck in the Slides editor, or open a
Design project/editor. Prefer URL/deep-link params and the existing
`/_agent-native/open` navigation/app-state bridge over inventing a second
state protocol for MCP Apps.

On rare occasions the right target is a focused app route that renders one
shared React component instead of the whole app shell. Analytics' `/chart`
route is the model: it takes a compact `SqlPanel` payload in the URL and
renders the same chart component the dashboard uses. This is still an app
embed, not a plain HTML MCP App. Expose or call it through a normal action /
`open_app({ path, embed: true })`, keep the URL deterministic, and let
`embedApp()` render that route inline.

Do not hand-write one-off plain HTML MCP Apps for product UI; if the action
needs a custom surface, add or reuse a real app route/component first and embed
that route.

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...schema, run, link...
  mcpApp: {
    resource: embedApp({
      title: "Review draft",
      description: "Open the generated draft in the real Mail compose UI.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
    }),
  },
});
```

The MCP server advertises extension `io.modelcontextprotocol/ui`, adds
`_meta.ui.resourceUri` plus the legacy-compatible `_meta["ui/resourceUri"]` to
`tools/list`, and also emits ChatGPT Apps SDK compatibility metadata
(`openai/outputTemplate`, widget CSP/description/accessibility). It exposes the
HTML through `resources/list`, `resources/templates/list`, and `resources/read`
using MIME `text/html;profile=mcp-app`. The stdio proxy forwards those resource
handlers from the live app, so local desktop/CLI clients see the same resources
as HTTP clients.

Keep the existing `link` builder even when adding `mcpApp`. CLI-only clients,
older hosts, and any host that does not render MCP Apps will ignore the UI
metadata and still need the "Open in … →" link. `embedApp()` uses that link as
its launch target. Same-app `open_app({ embed: true })` mints the
`/_agent-native/embed/start` ticket during the original tool call so production
hosts do not need the iframe to make a second app-only helper call; custom
actions can return `embedStartUrl` for the same fast path. The MCP layer keeps
that ticket-bearing URL in hidden metadata and strips it from model-visible
structured content and normal open-link metadata. Otherwise the resource falls
back to the app-only `create_embed_session` helper. The embed start route
exchanges a one-time SQL ticket, then launches the real app route with a
short-lived browser session. Standard hosts navigate the MCP App frame
directly. Claude web uses a single-frame transplant path that fetches the
signed app HTML and hydrates it inside Claude's MCP App iframe because Claude
does not reliably allow app-owned child iframes or external frame navigation.
ChatGPT web uses a controlled route iframe for stable `window.openai` host APIs
and bounded height control. You can force the
single-frame transplant path in other hosts with `embedMode: "transplant"` or
`frame: "transplant"` when debugging host module loading, or force the nested
diagnostic iframe with `embedMode: "iframe"` /
`renderMode: "iframe"` / `nested: true` when debugging host behavior. Pass
additional `frameDomains` only for a custom MCP App that truly embeds a
third-party frame. `open_app({ app, path, embed: true })` is the generic
escape hatch for routes like full dashboards, filtered inboxes, calendar
drafts, analyses, or extension pages, and should be used liberally when the
full app is the clearest review/edit surface.

Do not set standard `_meta.ui.domain` to an app URL. That field is
host-specific: Claude validates hash subdomains such as
`{hash}.claudemcpcontent.com`, while ChatGPT has its own widget-domain
metadata. Let hosts choose their default sandbox origin unless you are emitting
a host-specific value on purpose. `embedApp()` may still emit
`openai/widgetDomain` for ChatGPT compatibility.

Extension pages are a special case inside MCP chat embeds. The normal app uses
`/_agent-native/extensions/:id/render` as a sandboxed child iframe, but MCP
chat hosts add another ancestor frame and can block that route via
`frame-ancestors` / `X-Frame-Options`. In MCP chat bridge mode the framework
renders the extension document as sandboxed `srcDoc` inside the existing app
route iframe instead; keep `sandbox="allow-scripts allow-forms"` and do not add
`allow-same-origin`.

For Dispatch, keep the single connector path first-class: the `open_app`
resource CSP should include the exact origins of apps granted through Dispatch,
not broad sources like `https:`. This lets Claude's transplant path fetch the
signed target app HTML while keeping the connector's resource surface narrow.

Host sizing rule: the MCP resource shell owns a bounded inline height and the
embedded route should scroll internally. `embedApp({ height })` defaults to a
`560px` shell, clamps to `320-900px`, and subtracts `44px` for the wrapper bar
before sizing the route viewport. Do not re-enable host SDK auto-resize for
full-app route embeds; Claude and ChatGPT can otherwise measure the whole
document and create a huge chat iframe. After changing the shell or `ui://`
resource version, verify with a fresh tool call because old conversation frames
keep the behavior they were rendered with.

Inside embedded routes, `sendToAgentChat({ submit: true })` posts
`agentNative.submitChat`; MCP App hosts receive that as model context plus a
visible `ui/message` turn, so an inline preview can intentionally continue the
Claude/ChatGPT conversation. Hidden context stays in model context; do not put
internal app-state file instructions into the visible prompt. `submit: false`
stays local as a prefill/review path.

When testing Claude through ngrok, use a production build (`agent-native build`
then `agent-native start`) or a deployed preview/production URL. Claude's
transplant path works with production asset chunks; raw Vite dev modules such
as `/app/root.tsx` can be app-auth protected and fail dynamic imports from the
Claude resource origin.

For known first-party handoffs, prefer a direct action with `mcpApp` over
letting the model hunt through screens. Examples: Mail `manage-draft` for email
drafts, Analytics `open-traffic-dashboard` for the first-party traffic
dashboard, Calendar `manage-event-draft` for invite drafts, and create/search
actions for Forms, Content, Clips, Slides, and Design. The action should return
concise structured content plus the link; it should not dump large catalogs or
HTML.

Compatibility target: build to the standard once, not per-client shims. MCP
Apps-capable hosts should include Claude/Claude Desktop/Claude Code, ChatGPT
custom MCP apps, VS Code GitHub Copilot, Goose, Postman, MCPJam, Cursor, and
any future host that follows the extension negotiation. Host support varies by
plan, release channel, and client version, so keep the deep link fallback.

### 3. The `/_agent-native/open` route

`buildDeepLink(...)` returns the app-relative path
`/_agent-native/open?app=…&view=…&<recordId>=…`. The MCP layer turns that into
an absolute web URL (`toAbsoluteOpenUrl`, using the request origin) and a
desktop `agentnative://open?…` URL (`toDesktopOpenUrl`). When the user clicks
it in any browser or inline webview, `GET /_agent-native/open`
(`createOpenRouteHandler`, mounted by the core routes plugin, gated by
`disableOpenRoute`, customizable via `resolveOpenPath`):

1. Resolves the **browser** session via `getSession` (the auth guard bypasses
   the exact path `/_agent-native/open`).
2. If unauthenticated, serves the configured login HTML **at the same URL**
   (`getConfiguredLoginHtml`); the form's success handler reloads
   `window.location`, re-entering the route authenticated — no `?next=`
   plumbing.
3. Writes the existing one-shot `navigate` application-state command (payload =
   every non-reserved query param + `view`) scoped to the browser session's
   email with `requestSource: "deep-link"`, and decodes a `compose` base64url
   draft into a `compose-<id>` key.
4. 302-redirects to a safe same-origin relative path (`to=`, else `/<view>`,
   else `resolveOpenPath`), forwarding `f_*` filter params so lists/dashboards
   open pre-filtered before the `navigate` command is even drained.

Cross-origin, scheme-relative `//host`, and control-char redirects are rejected
(open-redirect guard). **Identity rule:** the link carries no privileged
state — it is just `view` + record ids + filters. The record-focusing
`navigate` write is scoped to whoever is logged into the browser, never the
external agent's MCP token. See **context-awareness** for the
`navigate`/`application_state` contract this bridges to.

### 4. "Ingest" actions for external agents

An action an external agent reads to pull live app state into its own context
must be: `http: { method: "GET" }` + `readOnly: true` +
`publicAgent: { expose: true, readOnly: true, requiresAuth: true }`. GET +
`readOnly` keeps it side-effect-free and out of the screen-refresh change event;
`publicAgent` is the explicit opt-in (public web routes never imply public
MCP/A2A exposure). Design/content ingest actions MUST read **live** state
(e.g. the Yjs document) — not the stale DB snapshot column — so the external
agent sees what the user actually has on screen.

### 5. Advanced: local development & manual setup

The hosted `connect` flow above is the recommended path. For local dev, run
the app (`pnpm dev` / `agent-native dev`) then point a local agent at it:

```bash
agent-native mcp install --client claude-code|claude-code-cli|codex|cowork \
  [--app <id>] [--scope user|project]
```

It provisions a token (random `ACCESS_TOKEN` into the workspace `.env` for
local dev, or a `signA2AToken` JWT for a detected hosted origin) and writes an
idempotent stdio server entry — `.mcp.json` / `~/.claude.json` for Claude Code,
the `[mcp_servers.*]` block in `~/.codex/config.toml` for Codex, the
Claude-Code JSON shape for Cowork. The entry runs `agent-native mcp serve
--app <id>`, by default a **thin stdio proxy** to the running local app's
`/_agent-native/mcp` (live registry + HMR + correct deep links stay the single
source of truth; `--standalone` builds the registry in-process). Companion
subcommands: `mcp uninstall`, `mcp status`, `mcp token [--rotate]`. You can
also hand-write an `http` `.mcp.json` entry with a token you supply yourself —
the unmanaged equivalent of what `connect` writes.

**Dev vs production tool surface:** in plain local dev
(`NODE_ENV=development` and `AGENT_MODE !== "production"`) the MCP `tools/list`
deliberately exposes only the generic builtins plus actions with
`publicAgent.requiresAuth === false` — per-app ingest (`requiresAuth: true`)
and mutating actions are filtered out (`filterPublicAgentActions`). The full
surface appears when authenticated as a real caller: a deployed /
`AGENT_MODE=production` app, or a local app reached through `connect` /
`agent-native mcp install` (which provisions an identity-bearing token). A
sparse `tools/list` means you are hitting an unauthenticated dev endpoint —
connect or present a token rather than assuming the action is missing.

## Do

- Do connect local/fallback clients to Dispatch with
  `npx @agent-native/core connect https://dispatch.agent-native.com`; use a
  direct app URL only when the host should be isolated to one app.
- Do add a `link` builder to any action that produces or lists a navigable
  resource (draft, event, dashboard, document).
- Do add `mcpApp` when a UI-capable MCP host should render an inline review or
  edit surface, while keeping the `link` fallback.
- Do use `embedApp()` / `open_app({ embed: true })` when the right UI is the
  existing React app at a specific route, including full app routes and focused
  component routes like an Analytics chart embed.
- Do test real ChatGPT/Claude web behavior with a fresh inline render after any
  resource-shell or host-bridge change; old frames are not proof that a new
  shell is still broken.
- Do build the URL with `buildDeepLink(...)` — it is the single source of truth
  for the open-route format.
- Do keep `link` pure and synchronous; return `null` when there's nothing to
  open.
- Do keep `link` and `mcpApp` metadata pure and synchronous; use `embedApp()`
  so the user sees the shared React UI.
- Do make external-agent read/ingest actions GET + `readOnly` + `publicAgent`,
  and read live (Yjs) state, not the stale DB column.
- Do let the open route resolve the browser session; pass record ids as deep-
  link params and let the UI focus them via the polled `navigate` command.

## Don't

- Don't copy a deployment's shared `ACCESS_TOKEN` / `A2A_SECRET` into a client
  config when `connect` can mint a per-user, revocable token instead.
- Don't hand-format the `/_agent-native/open` URL — always go through
  `buildDeepLink`.
- Don't do I/O, awaits, DB reads, or app-state reads inside a `link` builder.
- Don't replace deep links with MCP Apps; non-UI clients still need the link.
- Don't hand-write product UI in `mcpApp.resource.html`; use a real React
  route/component and embed it with `embedApp()`.
- Don't test Claude full-app embeds against raw Vite dev modules and conclude
  production is broken; use `agent-native start`, a preview deploy, or prod.
- Don't scope the `navigate` write to the agent token, or pass privileged
  state through the deep link — it's a pure pointer.
- Don't invent a new navigation mechanism; bridge to the existing
  `navigate`/`application_state` contract.
- Don't widen the public template allow-list when scaffolding an app from an
  external agent — the allow-list in `packages/shared-app-config/templates.ts`
  is authoritative and guarded.

## Related Skills

- **actions** — defining actions, `publicAgent`, GET/`readOnly`
- **context-awareness** — the `navigate` / `application_state` contract the
  open route bridges to
- **a2a-protocol** — the `ask-agent` meta-tool and JSON-RPC peer calls
- **adding-a-feature** — the four-area checklist (add a `link` builder when a
  feature produces a navigable resource)
</content>
