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
GitHub Copilot, Goose, Postman, MCPJam, and future standard clients). The
**recommended** way to connect OAuth-capable remote MCP hosts is the standard
remote MCP OAuth flow. For cross-app / first-party usage, prefer the unified
Dispatch gateway: point the host at
`https://dispatch.agent-native.com/_agent-native/mcp`, authorize once, then
manage which apps are exposed from Dispatch's Agents page. Dispatch overrides
the generic `list_apps`, `ask_app`, and `open_app` tools so the single MCP URL
only lists and routes to granted apps. For a deliberately isolated single-app
connection, point the host at `https://<app>/_agent-native/mcp`; it discovers
`/.well-known/oauth-protected-resource`, dynamically registers a public client,
and completes authorization-code + PKCE in the browser. For local stdio
proxying and fallback clients, keep using the one-command hosted flow —
`npx @agent-native/core connect <url>` — which mints a per-user, scoped,
revocable token from a logged-in browser session; no shared secret is copied.
Once connected, every action that produces or lists a navigable resource SHOULD
return a deep link from a `link` builder, so the external agent can surface an
**"Open in <app> →"** link that drops the user back into the running UI at the
right view and record. Actions can also declare `mcpApp` so hosts that support
MCP Apps render an inline interactive UI. The link is a pure pointer — the
record-focusing write is always scoped to the **browser session**, never the
agent's token.

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

The first-party hosted apps live at `mail.agent-native.com`,
`calendar.agent-native.com`, etc. For most cross-app work, connect Dispatch
once instead of adding every app one-by-one:

```bash
claude mcp add --transport http agent-native https://dispatch.agent-native.com/_agent-native/mcp
```

Then open Dispatch → Agents to choose whether the unified MCP gateway exposes
all apps or only selected app IDs. External agents call `list_apps` to see the
granted set, `ask_app` to route a natural-language task over A2A to a granted
app, and `open_app` to produce a deep link to a granted app.

For an intentionally isolated single-app connection, configure that app's
remote HTTP endpoint directly:

```bash
claude mcp add --transport http agent-native-mail https://mail.agent-native.com/_agent-native/mcp
```

Then use the host's MCP auth UI (for Claude Code, `/mcp` → Authenticate). The
server responds to unauthenticated MCP requests with `WWW-Authenticate:
Bearer resource_metadata="https://<app>/.well-known/oauth-protected-resource"`
and supports:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/.well-known/openid-configuration`
- `/_agent-native/mcp/oauth/register`
- `/_agent-native/mcp/oauth/authorize`
- `/_agent-native/mcp/oauth/token`

The issued access token is audience-bound to the exact MCP URL and carries
`mcp:read`, `mcp:write`, and/or `mcp:apps`. Tool calls, `resources/read`, and
MCP App iframe-initiated tool calls all run through the same
`runWithRequestContext` identity scoping. The iframe never receives OAuth
tokens; the host mediates calls through the authenticated MCP connection.

The CLI can write supported local client configs for you. For Claude Code and
Claude Code CLI it writes the same URL-only remote HTTP entry and the user then
authenticates in `/mcp`; for Codex, Cowork, local stdio proxying, and hosts
that do not support MCP OAuth yet, it uses the browser-authorized bearer-token
fallback. Cursor and other hosts can also use the same MCP endpoint via the
no-CLI/manual config path:

```bash
npx @agent-native/core connect https://mail.agent-native.com
# or connect the unified Dispatch gateway once:
npx @agent-native/core connect https://dispatch.agent-native.com
# legacy: connect every first-party hosted app as separate MCP resources:
npx @agent-native/core connect --all
```

For OAuth-native Claude clients, restart Claude Code after the config write,
run `/mcp`, and choose Authenticate. For fallback clients, the command opens
the browser at the app; the user is already logged in and clicks **Authorize**
once. No token to copy, no local server. The fallback connection is **per-user,
scoped, and revocable**. The no-CLI equivalent is the in-app **Connect** page
served at `https://<app>/_agent-native/mcp/connect`: it shows the remote MCP
URL with a copy button and a tab strip — **Claude · ChatGPT · Cursor · Claude
Code · Codex · Other** — with the exact paste-URL steps or copy-able
`claude mcp add` / `npx @agent-native/core connect` snippet for each host, plus
a collapsible static-token mint for clients without remote-OAuth support.
Point non-developer teammates there instead of telling them to install a CLI.

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

For OAuth callers that request `mcp:apps`, the advertised `tools/list` catalog
is intentionally compact so ChatGPT/Claude app hosts do not ingest every
internal action schema. The model sees app-facing builtins (`list_apps`,
`open_app`, app-only `create_embed_session`) and actions with `mcpApp`.
Stdio/static-token developer clients still get the full connected action
surface, and `publicAgent.expose` remains the opt-in for safe read/ingest tools
outside the compact MCP Apps catalog. If a UI-capable host should be able to
call a new action from an MCP App conversation, mark it with `mcpApp`; use
`publicAgent` for non-UI read/ingest handoff tools instead of relying on
incidental full-surface discovery.

### 1b. Fast-path expectations for MCP Apps hosts

Keep ChatGPT/Claude paths short. For a known app-facing intent, the external
agent should call the specific action that creates or opens the thing, then let
the MCP App widget launch the iframe. Do **not** route simple UI handoffs
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
      frameDomains: ["https:", "http://localhost:*", "http://127.0.0.1:*"],
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
its launch target, calls the app-only `create_embed_session` helper, exchanges
a one-time SQL ticket at `/_agent-native/embed/start`, and loads the target
route in an iframe with a short-lived browser session. `open_app({ app, path,
embed: true })` is the generic escape hatch for routes like full dashboards,
filtered inboxes, calendar drafts, analyses, or extension pages, and should be
used liberally when the full app is the clearest review/edit surface.

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

- Do connect to a hosted app with `npx @agent-native/core connect <url>` (or
  `--all`) — it mints a per-user, revocable token; no shared secret copied.
- Do add a `link` builder to any action that produces or lists a navigable
  resource (draft, event, dashboard, document).
- Do add `mcpApp` when a UI-capable MCP host should render an inline review or
  edit surface, while keeping the `link` fallback.
- Do use `embedApp()` / `open_app({ embed: true })` when the right UI is the
  existing React app at a specific route, including full app routes and focused
  component routes like an Analytics chart embed.
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
