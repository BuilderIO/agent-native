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
scope: dev
metadata:
  internal: true
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
then sign in and approve `mcp:read`, `mcp:write`, `mcp:apps`, and
`offline_access`. Claude Code:
add the same remote HTTP URL, restart if needed, run `/mcp`, and choose
Authenticate. ChatGPT: create a custom MCP connector/app, paste the same URL,
choose OAuth, scan/discover tools, then sign in and approve scopes. Each host
stores its own OAuth tokens; MCP App iframes never receive raw tokens because
the host mediates tool and resource calls over the authenticated MCP
connection.

For local stdio proxying, Codex/Cowork compatibility, or clients without
remote MCP OAuth, use the hosted connect fallback:

```bash
npx @agent-native/core@latest connect https://dispatch.agent-native.com
# or, for an isolated app:
npx @agent-native/core@latest connect https://mail.agent-native.com
```

The command opens the app in the browser, the user clicks **Authorize**, and a
per-user, scoped, revocable token is written to the selected client config. The
no-CLI equivalent is `https://<app>/_agent-native/mcp/connect`, which shows
the copyable MCP URL, Claude / ChatGPT / Cursor / Claude Code / Codex / Other
steps, and static-token fallback for clients that need it.

Re-running `npx @agent-native/core@latest connect <url> --client claude-code` over an older
Claude bearer-token entry is the migration path: the CLI replaces
`Authorization` headers with URL-only OAuth config and tells the user to
authenticate from `/mcp`.

To re-authenticate an already-installed local/fallback client without
reinstalling skills or connectors, use:

```bash
npx -y @agent-native/core@latest reconnect https://dispatch.agent-native.com --client codex
# or:
npx -y @agent-native/core@latest connect reconnect https://dispatch.agent-native.com --client codex
```

With no URL, `reconnect` searches local client configs for the existing Agent
Native MCP entry. With a URL, it reconnects only the clients that already have
that MCP URL; pass `--client` to limit which configs it searches. Pass
`--name <serverName>` only when you need to force a custom server name.

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
`open_app({ embed: true })`. Stdio/code clients use the same compact surface
unless they explicitly opt into the full catalog, and
`publicAgent.expose` remains the action-level opt-in for safe read/ingest tools
outside the compact MCP Apps catalog. Apps can set
`externalAgents.authenticatedReads: "auto"` to automatically advertise every
action that is GET + `readOnly` + `publicAgent.requiresAuth`, instead of
maintaining a long connector allow-list. This policy never includes writes by
default; use `writes: "ask_app_only"` to keep mutations behind `ask_app`, and
use `denyActions` for defense-in-depth vetoes. `tool-search` remains available
for discovery, but a searched action still needs to be in the connector
catalog, included by the authenticated-read policy, or enabled by the explicit
full-catalog opt-in before `tools/call` can execute it. Do not rely on
action-specific `mcpApp` resources appearing in ChatGPT/Claude discovery by
default; use `open_app` for the
first-class app embed path. If a specific
action truly must remain visible in that compact app-host catalog, set
`mcpApp.compactCatalog: true` as a rare escape hatch.

Generic core `db-schema` and `db-query` are intentionally not automatic
external reads. They remain available to the in-app agent through the normal
scoped SQL path, but broad schema/SQL access is too powerful to infer from
read-only metadata alone. If an app needs direct external querying, expose an
app-owned bounded GET action or add an explicit table/column allow-list with
row, byte, timeout, and audit limits. Keep `db-exec` and `db-patch` outside
automatic external-agent exposure.

Authentication and authorization are separate gates. A verified MCP OAuth or
connect token identifies the caller and organization; `publicAgent` only opts
an action into the external protocol surface and does not grant record access.
Actions still need `accessFilter`, `resolveAccess`, or `assertAccess` so private
documents/dashboards, shares, organization boundaries, and roles are enforced.
For Slack, verified DMs are linked to an existing Agent Native org member
before execution and run with that user's context; shared channels use a
service principal, and guests/external members cannot borrow personal access.
Managed Slack OAuth and the generated app manifest both request
`users:read.email`; existing installs must reconnect/reinstall after a scope
change, while legacy bot-token installs must add the scope in Slack manually.

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
desktopUrl, vscodeUrl }`; `tools/list` adds
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
same route inline instead of opening a new tab. Keep the `link` fallback even
when adding `mcpApp` — non-UI clients still need the "Open in … →" link.

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

Do not hand-write one-off plain HTML MCP Apps for product UI; if the action
needs a custom surface, add or reuse a real app route/component first and embed
that route. For known first-party handoffs, prefer a direct action with
`mcpApp` (e.g. Mail `manage-draft`, Calendar `manage-event-draft`) over letting
the model hunt through screens; `open_app({ path, embed: true })` is the
generic escape hatch for full dashboards, filtered inboxes, analyses, or
extension pages.

The host bridges (Claude transplant vs. ChatGPT `window.openai`), embed start
tickets, extension-page `srcDoc` rendering inside chat embeds, host sizing
(`embedApp({ height })`), `sendToAgentChat`, `_meta.ui.domain` rules, and
ngrok/prod testing caveats are documented in
**`references/mcp-apps-embedding.md`**. Read it before changing the
`embedApp()` shell, the `ui://` resource, or any host-bridge behavior.

### 3. The `/_agent-native/open` route

`buildDeepLink(...)` returns the app-relative path
`/_agent-native/open?app=…&view=…&<recordId>=…`. The MCP layer turns that into
an absolute web URL (`toAbsoluteOpenUrl`, using the request origin), a
desktop `agentnative://open?…` URL (`toDesktopOpenUrl`), and a VS Code
extension URL (`toVsCodeOpenUrl`) for
`vscode://builderio.agent-native/open?url=…`. When the user clicks the web
link in any browser or inline webview, `GET /_agent-native/open`
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
the app (`pnpm dev` / `pnpm exec agent-native dev`) then point a local agent at it:

```bash
pnpm exec agent-native mcp install --client claude-code|claude-code-cli|codex|cowork|cursor|opencode|github-copilot \
  [--app <id>] [--scope user|project]
```

It provisions a token (random `ACCESS_TOKEN` into the workspace `.env` for
local dev, or a `signA2AToken` JWT for a detected hosted origin) and writes an
idempotent stdio server entry — `.mcp.json` / `~/.claude.json` for Claude Code,
the `[mcp_servers.*]` block in `~/.codex/config.toml` for Codex,
`.cursor/mcp.json` / `~/.cursor/mcp.json` for Cursor, `opencode.json` /
`~/.config/opencode/opencode.json` for OpenCode, `.vscode/mcp.json` / VS Code
user `mcp.json` for GitHub Copilot / VS Code, and the Claude-Code JSON shape
for Cowork. The entry runs `pnpm exec agent-native mcp serve --app <id>`, by
default a **thin stdio proxy** to the running local app's
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
`pnpm exec agent-native mcp install` (which provisions an identity-bearing token). A
sparse or empty `tools/list` is diagnostic, not proof of auth failure: check
OAuth scopes, compact-catalog filtering, and the client/server auth status
before telling the user they are unauthenticated.

## Do

- Do connect local/fallback clients to Dispatch with
  `npx @agent-native/core@latest connect https://dispatch.agent-native.com`;
  use `npx -y @agent-native/core@latest reconnect ...` for reauth without
  reinstalling; use a direct app URL only when the host should be isolated to
  one app.
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
  production is broken; use `pnpm exec agent-native start`, a preview deploy, or prod.
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

## Blueprint installer

To add a whole new integration the agent-native way, `agent-native add <kind>
<name|url>` prints a curated Markdown blueprint to stdout — pipe it into the
external coding agent you connected (`agent-native add provider stripe |
claude`) and it applies the changes against the live repo. A URL emits a
generic research-and-integrate blueprint instead. Seeded kinds:
`provider` / `channel` / `sandbox` / `action`. Add your own by dropping a
`.md` in `packages/core/blueprints/<kind>/`. See the Blueprint Installer doc.
