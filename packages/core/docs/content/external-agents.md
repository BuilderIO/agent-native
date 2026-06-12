---
title: "External Agents: Claude, ChatGPT, Codex, Cursor, Cowork"
description: "Connect Claude, ChatGPT, Codex, Cursor, Claude Cowork, or any MCP-compatible host to a hosted agent-native app — then round-trip artifacts back into the running UI with MCP Apps and deep links."
search: "Claude ChatGPT Claude Code Codex Cursor Claude Cowork MCP Apps agent-native connect local agent tools external agents"
---

# External Agents

An agent-native app is reachable by any MCP-compatible host — Claude, Claude Desktop, Claude Code, ChatGPT custom MCP apps, Codex, Cursor, Claude Cowork, VS Code GitHub Copilot, Goose, Postman, MCPJam, and future clients that implement the standard. External agents are great at producing artifacts (a draft, an event, a dashboard) but they often live in a terminal or another app. Without a bridge, the user gets a wall of JSON and has to go find the thing.

The external-agent bridge closes the loop. First you connect your own agent to a **hosted** app — either by pasting the app's remote MCP URL into a chat host like Claude or ChatGPT, or by running the developer CLI flow for local coding agents. Then the agent does the work over MCP and hands the user either an inline **MCP App** UI in compatible hosts or a single **"Open in &lt;app&gt; →"** link that opens the real app focused on exactly what was produced. It reuses the existing `navigate` / `application_state` contract the UI already drains every 2s (see [Context Awareness](/docs/context-awareness)) — there is no second navigation mechanism.

## Easy setup {#easy-setup}

Add one remote MCP connector to the host where you want to use Agent-Native.

For workspace or cross-app work, use Dispatch:

```text
https://dispatch.agent-native.com/_agent-native/mcp
```

Dispatch is the single gateway for Mail, Calendar, Analytics, Brain, and your
workspace apps. In Dispatch's **Agents** page, choose whether the gateway can
reach all apps or only selected apps. The connected host then gets
`list_apps`, `ask_app`, and `open_app`, filtered to that granted set.

For one intentionally isolated app, use that app directly:

```text
https://mail.agent-native.com/_agent-native/mcp
https://<your-app>.agent-native.com/_agent-native/mcp
```

Every hosted app also has a helper page at
`https://<app>/_agent-native/mcp/connect` with the copyable URL and
host-specific tabs for Claude, ChatGPT, Cursor, Claude Code, Codex, and Other.

### Claude and ChatGPT OAuth {#oauth}

Claude / Claude Desktop: add a custom connector, paste the MCP URL, click
**Connect**, sign in with your Agent-Native account, approve the MCP scopes,
and enable the connector in a chat. Claude Code uses the same URL: add it as a
remote HTTP MCP server, run `/mcp`, then choose **Authenticate**.

ChatGPT: use a workspace where custom MCP connectors or developer-mode apps are
enabled, create a custom connector/app, paste the same MCP URL, choose OAuth,
scan/discover tools, sign in with Agent-Native, approve the scopes, and enable
the connector in a chat.

OAuth grants are per host and per user. The host stores the tokens and
mediates tool/resource calls, so inline MCP App previews never receive raw
OAuth tokens. ChatGPT can keep a reviewed or published connector's tool
snapshot until you refresh/review it again, so rescan the connector after MCP
tool or MCP App metadata changes. If you still have old per-app connectors
enabled alongside Dispatch, refresh or reconnect each stale connector; updating
Dispatch does not rewrite ChatGPT or Claude's cached Calendar/Mail/etc.
snapshots. The scopes are:

| Scope       | What it enables                                      |
| ----------- | ---------------------------------------------------- |
| `mcp:read`  | Read-only tools and tool/resource discovery          |
| `mcp:write` | Drafting, updating, and other mutating actions       |
| `mcp:apps`  | Inline MCP Apps, charts, dashboards, drafts, and UIs |

Cursor, Goose, Postman, MCPJam, and VS Code GitHub Copilot use the same remote
MCP URL through their own MCP-server UIs when their build supports remote OAuth
MCP servers.

### Quick test prompt {#quick-test}

After connecting, try one of these:

```text
Use Agent-Native Analytics to generate a weekly conversion-rate bar chart and show it inline.
```

```text
Use Agent-Native Mail to draft a short follow-up email to me, but do not send it.
```

In hosts that support MCP Apps, Analytics can render real dashboard and analysis routes inline, and Mail can render the real compose UI inline for draft review. In hosts that do not render MCP Apps, the same tool call still returns a deep link such as **Open draft in Mail →** or **Open dashboard in Analytics →**.

## Advanced setup: local agents {#connect}

Use this flow for local agent clients on your machine — Claude Code, Claude Code CLI, Codex, and Claude Cowork. (Cursor uses the paste-URL flow above; it does not need this CLI path.)

Run the connect command through npm:

```bash
npx @agent-native/core@latest connect https://dispatch.agent-native.com
```

The command asks which local agent clients should receive MCP config. All clients are preselected the first time; after you choose, the selection is saved to `~/.agent-native/connect.json` so the next run can reuse it with Enter, or you can edit the checked items.

For Claude Code and Claude Code CLI, `connect` writes a standard remote HTTP MCP entry with no static headers. Restart Claude Code, run `/mcp`, and choose **Authenticate**; Claude completes the OAuth flow and stores its own tokens. For Codex and Claude Cowork, `connect` uses the compatibility device-code flow: it opens your browser at the app, you click **Authorize** once, and the command writes a scoped bearer-token entry. If you choose a mix of clients, it does both.

Keep the `connect` command running until the browser approval completes. If the
waiting process is stopped early, the approval can succeed in the browser but
the local client config will not receive the token.

If you previously connected Claude Code through the old bearer-token flow, just run the same `npx @agent-native/core@latest connect ... --client claude-code` command again. The CLI replaces the legacy `Authorization` headers with the URL-only OAuth entry and tells you to re-authenticate from `/mcp`.

| Local client                  | Config written by `connect`                             | Auth flow                                       |
| ----------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Claude Code / Claude Code CLI | `.mcp.json` or `~/.claude.json`, depending on `--scope` | Standard remote MCP OAuth in Claude's `/mcp` UI |
| Codex                         | `~/.codex/config.toml` under `[mcp_servers.<app>]`      | Browser-authorized bearer fallback              |
| Claude Cowork                 | `~/.cowork/mcp.json` using the Claude Code MCP shape    | Browser-authorized bearer fallback              |

Restart the agent client after connecting so it picks up the new MCP server; OAuth-native clients may then prompt you to authenticate from their MCP UI.

When troubleshooting local MCP config, redact `Authorization`, `http_headers`,
and token values before sharing logs. Do not use raw curl as a substitute for a
host MCP session; after connecting, use the host-exposed tools or restart the
client if the new server is not visible yet.

Use `--client codex` (or `--client claude-code`, `--client claude-code-cli`, `--client cowork`, `--client all`) to skip the picker for scripts or one-off installs.

First-party app skills install the instructions and the hosted MCP connector together with the Agent Native CLI:

```bash
npx @agent-native/core@latest skills add assets              # alias: image-generation
```

The Vercel/open Skills CLI path is also available when you only want portable
instructions:

```bash
npx skills add BuilderIO/agent-native --skill assets
```

The raw `skills` CLI installs `SKILL.md` files only; local MCP clients still
need a connector such as `npx @agent-native/core@latest connect https://assets.agent-native.com`.

| Skill    | Alias              | For                    |
| -------- | ------------------ | ---------------------- |
| `assets` | `image-generation` | image/video generation |

The default client is `codex`; add `--client claude-code` or `--client all` for others. Inline hosts (ChatGPT, Claude.ai, Claude Desktop main chat) render the picker / variant grid in chat; CLI/link-only hosts (Codex, Claude Code, Claude Desktop "Code" tab) return an "Open in … →" link where the user picks in the browser and pastes a handoff summary back.

When you truly need an isolated app instead of Dispatch's workspace gateway,
run the same command with that app's host:

```bash
npx @agent-native/core@latest connect https://mail.agent-native.com
```

`connect --all` still exists for legacy per-app client setups, but new
workspace setups should prefer the single Dispatch connector.

The connection is **per-user, scoped, and revocable**. In the OAuth path, the host stores the tokens after `/mcp` authentication; in the fallback path, the browser session you authorized with is the identity the agent acts as. Nothing exposes the deployment's shared secret.

### Re-authenticating after a 401 {#reconnect}

Once connected, auth should persist long-term — access tokens last 30 days by default (override with `MCP_OAUTH_ACCESS_TOKEN_TTL` on the server, e.g. `7d` or `12h`) with a sliding 365-day refresh window, so random 401s should be rare. When one does happen, use the lightweight reconnect command rather than reinstalling:

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com
```

`reconnect` finds any MCP config entry whose URL ends in `/_agent-native/mcp` for the given host (matching by URL regardless of connector name), then refreshes or replaces the auth material without touching your installed skills or re-running the full install flow. Pass the base app URL (e.g. `https://plan.agent-native.com`) — the `/_agent-native/mcp` suffix is inferred.

In Claude Code, the equivalent UI path is: run `/mcp` and choose **Authenticate** (or **Reconnect**) for the relevant connector.

Never reinstall the skill from scratch just to fix a 401 — `reconnect` is the right tool.

### Connect page fallback {#connect-page-fallback}

For MCP clients that cannot add a remote OAuth URL directly, open the app in your browser and use its **Connect** affordance (served at `https://<app>/_agent-native/mcp/connect`). While logged in, click **Connect / Authorize**. The page hands you either a one-click deep link that configures a detected agent, or a ready-to-paste `.mcp.json` block:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "http",
      "url": "https://mail.agent-native.com/_agent-native/mcp",
      "headers": { "Authorization": "Bearer <minted-token>" },
    },
  },
}
```

Restart the agent client after connecting so it picks up the new MCP server.

Use this manual bearer block for MCP clients that cannot complete the standard remote MCP OAuth flow, or for one-off debugging when you explicitly want to paste a token.

### Standard remote MCP OAuth {#standard-oauth}

Hosted agent-native apps also support the standard remote MCP OAuth flow. For clients that implement MCP OAuth, add the remote HTTP server URL with no static headers:

```bash
claude mcp add --transport http agent-native \
  https://dispatch.agent-native.com/_agent-native/mcp
```

This is the same URL-only entry that `npx @agent-native/core@latest connect https://dispatch.agent-native.com --client claude-code` writes for you. Then run `/mcp` in Claude Code and choose **Authenticate**. The client discovers auth from the MCP server's `401 WWW-Authenticate` challenge, fetches `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, dynamically registers a public OAuth client, opens the app's authorization page, and stores the resulting token securely. ChatGPT developer-mode connectors use the same server URL:

```text
https://dispatch.agent-native.com/_agent-native/mcp
```

The OAuth flow is authorization-code + PKCE with refresh-token rotation. Access tokens are audience-bound to the exact MCP resource URL and carry the signed user/org identity, so tool calls, `resources/read`, and MCP App iframe-initiated `tools/call` all run through the same `runWithRequestContext` tenant scoping as the existing connect-minted JWT path. The iframe never receives raw OAuth tokens; the host mediates calls through the authenticated MCP connection.

Current scopes are:

| Scope       | Allows                                                                    |
| ----------- | ------------------------------------------------------------------------- |
| `mcp:read`  | read-only MCP actions and ordinary tool/resource discovery                |
| `mcp:write` | mutating actions and the `ask-agent` meta-tool                            |
| `mcp:apps`  | MCP Apps resource listing/reading and inline UI rendering where supported |

When the client requests no explicit scope, the app grants all three so the connector behaves like the browser-authorized Connect flow. Keep the bearer-token Connect page and `npx @agent-native/core@latest connect --token <token>` fallback around for local dev, fallback hosts, and clients where you need a ready-to-paste config block.

## Catalog tiers {#catalog-tiers}

The tool catalog your agent sees depends on both the deployment context and how
you connected.

### Connector tier (hosted multi-tenant, default) {#connector-tier}

On hosted multi-tenant deployments (e.g. `plan.agent-native.com`) the server
activates a curated **connector catalog** when `AGENT_NATIVE_CONNECTOR_CATALOG=1`
is set. External MCP clients see only the template-declared allow-list of
app-level actions (create/get/update plan, sharing, upload, navigate, automations,
tool-search) plus the four builtin cross-app tools (`list_apps`, `open_app`,
`ask_app`, `create_embed_session`). Tools outside the list — `db-exec`,
`db-patch`, `seed-*`, the extension suite, browser-session tools, agent-engine
management, and context-xray tools — are not advertised and calls to them are
rejected with "Unknown tool".

This keeps the context window of every connected external agent small (~20–30
tools vs. ~105) and removes footguns that are only safe for single-tenant
local development.

### Full tier (local / dev, or per-token opt-up) {#full-tier}

Local and dev deployments that do not have `AGENT_NATIVE_CONNECTOR_CATALOG=1`
always serve the full action surface. When the env flag is set, individual
callers can still opt up by minting their token with `--full-catalog`:

```bash
npx @agent-native/core@latest connect https://plan.agent-native.com --full-catalog
```

This embeds a `catalog_scope: "full"` claim in the minted JWT. On subsequent
requests the MCP server bypasses the connector-catalog filter for that token
and serves the complete action surface — identical to the local/dev experience.

`AGENT_NATIVE_MCP_FULL_CATALOG=1` (process env on the server) is a
deployment-wide override that disables the filter for all callers. Use it for
single-tenant hosted instances that need the full surface without per-token
opt-up.

### Template declaration {#catalog-declaration}

Templates declare their connector catalog in `createAgentChatPlugin` options:

```ts
export default createAgentChatPlugin({
  appId: "plan",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  connectorCatalog: [
    "create-visual-plan",
    "get-visual-plan",
    "list-visual-plans",
    "update-visual-plan",
    // … other safe app-level actions
    "set-resource-visibility",
    "share-resource",
    "upload-image",
    "navigate",
    "view-screen",
    "manage-automations",
    "tool-search",
  ],
});
```

The builtin cross-app tools (`list_apps`, `open_app`, `ask_app`,
`create_embed_session`, `create_workspace_app`, `list_templates`) are always
included regardless of the declared list.

## What you can do once connected {#what-you-can-do}

Once your agent is connected, the available MCP tool surface depends on the
host and the deployment. Code/stdio developer clients on local deployments get
the app's full action surface plus the `ask-agent` meta-tool that runs the full
agent loop (the same entry point [A2A](/docs/a2a-protocol) uses). On hosted
multi-tenant deployments the connector tier is active by default (see above).
Chat hosts, including Claude and ChatGPT, get a compact app-facing catalog by
default even when they authenticate through a generic bearer/static-token path:
cross-app verbs such as `list_apps`, `open_app`, and `ask_app`, plus the
app-only embed helper. In all cases, ask the agent to do real work and it hands
back a link straight into the running app:

```
> draft an email to John about the Q3 report

Claude Code calls: manage-draft(to: "john@example.com", subject: "Q3 Report", body: "…")
→ Open draft in Mail → https://mail.agent-native.com/_agent-native/open?app=mail&view=inbox&compose=…
```

Click that link and Mail opens with the draft restored — focused exactly where you, the logged-in user, are. The agent never had to know your session; it just produced the artifact.

### MCP Apps compatibility {#mcp-apps-compatibility}

Agent-native apps also speak the official MCP Apps extension. When any action
declares `mcpApp`, the server advertises
`extensions["io.modelcontextprotocol/ui"]`, includes `_meta.ui.resourceUri` /
`_meta["ui/resourceUri"]` in `tools/list`, and serves the HTML UI through
`resources/list` + `resources/read` as `text/html;profile=mcp-app`. Resource
security metadata such as CSP and sandbox permissions lives on the resource
entries and `resources/read` content, not on the tool descriptor.

For ChatGPT/Claude-style OAuth app hosts, the discovery surface is compact by default: `tools/list` and `resources/list` advertise the generic `open_app` embed path instead of every action-specific MCP App resource (see [Catalog tiers](#catalog-tiers)). Mark an individual action with `mcpApp.compactCatalog: true` only when it truly needs to stay visible in chat-host discovery.

That makes the same app surface available to every compatible host rather than building per-client shims. The current official MCP Apps client list includes Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT, and Cursor; host support still varies by plan, release channel, and client version, so check the [MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix). ChatGPT custom MCP apps are available through developer mode for Business and Enterprise/Edu workspaces on ChatGPT web; see OpenAI's [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta) notes.

Claude Code, Codex, and other CLI/code-editor clients still receive the same
resources and metadata when they support MCP Apps, but treat them as link-out
hosts unless you have verified inline iframe rendering in that exact surface.
The deep link remains the reliable fallback when a host chooses not to render an
iframe. In practice, every agent-native app should be authored with both: MCP
Apps for inline review/edit in capable hosts, and `link` for universal
round-tripping back to the full app. Human-selection tools can add a paste-back
step to that fallback: for example, the Assets picker opens from the fallback
link, lets the user choose media in the browser, then copies a handoff summary
that the user pastes back into the chat.

Claude and ChatGPT can cache tool and resource metadata for an existing custom
connector. After changing MCP App metadata, verify with a fresh tool call; if
the host still uses the old descriptor, reconnect the Claude connector or
rescan/review the ChatGPT connector so it refreshes the catalog.
If Claude logs a warning about `_meta.ui.csp` or `_meta.ui.permissions` living
on the tool descriptor after a deploy, that connector is using stale metadata:
delete/reconnect the Claude connector and start a fresh chat.

### First-class MCP App bridge {#mcp-app-bridge}

`embedApp()` starts from the action's `link` target, creates a short-lived embed session, and launches that signed app route. Claude web uses a single-frame transplant path; ChatGPT gets a controlled route iframe with `window.openai` host APIs. All paths render the normal React route. Directly hydrated routes call `ui/update-model-context`, `ui/message`, `ui/open-link`, and `ui/request-display-mode` through the host bridge; the ChatGPT path relays the same requests over `agentNative.mcpHost.*` postMessage. `embedApp({ height })` defaults to `560px` and clamps to `320-900px`.

See [MCP Apps](/docs/mcp-apps) for the full bridge details — transplant vs controlled-frame, embed modes, the `ui/*` and postMessage tables, `embedStartUrl`, CSP rules, extension `srcDoc` embedding, height clamping, and the complete host bridge client API.

### Generic cross-app verbs {#cross-app}

On top of the per-action tools the MCP server exposes a stable verb set, so an external agent has a predictable surface without guessing per-app action names:

| Tool                                               | Side effects | Returns                                                                                     |
| -------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `list_apps`                                        | none         | workspace apps + their URLs / running state                                                 |
| `open_app({ app, view?, path?, params?, embed? })` | none         | a deep link or same-origin route; `embed: true` renders the full app inline where supported |
| `ask_app({ app, message })`                        | agent loop   | routes a natural-language task to that app's in-app agent (delegates to `ask-agent`)        |
| `create_workspace_app({ name, template })`         | scaffolds    | a new app booted via the workspace path, plus its running URL + deep link                   |
| `list_templates`                                   | none         | the allow-listed templates only                                                             |

`create_workspace_app` rejects any non-allow-listed template — the public template allow-list in `packages/shared-app-config/templates.ts` is authoritative and CI-guarded; an external agent cannot widen it. A same-named template action overrides a builtin (template-over-core precedence). Disable the whole set with `MCPConfig.builtinCrossAppTools: false`.

The tool and resource catalogs for app hosts are compact by default — see [Catalog tiers](#catalog-tiers). `publicAgent.expose` remains the opt-in for safe read/ingest tools outside that compact catalog; set `mcpApp.compactCatalog: true` only as a rare exception for actions that must appear in chat-host discovery.

For fast ChatGPT/Claude handoffs, the ideal path is direct: call the action that creates or opens the artifact, then let the MCP App launch the route. A Mail request should call `manage_draft` and render the real compose route. A dashboard request should call `open_app({ path, embed: true })` or a dashboard action with `mcpApp` and render the full Analytics route. Calendar, Forms, Content, Slides, Design, and Clips should follow the same pattern with their draft/create/search actions. `list_apps` is useful when the model must choose among granted apps; broad `resources/list`, full-catalog discovery, or `ask_app` delegation should not be the normal route for an obvious UI handoff.

### Per-app tour {#tour}

Every allow-listed template that produces or lists a navigable resource ships a `link` builder, and the ingest-heavy ones ship a GET + `publicAgent` action so a connected agent can pull live state:

- **Mail** — `manage-draft` returns a `compose`-encoded deep link; clicking it opens the inbox with the draft restored into a `compose-<id>`. `list-emails` / `search-emails` point at a filtered inbox view.
- **Calendar** — `manage-event-draft` returns a `calendarDraft` + `eventDraftId` deep link; clicking it opens a visible draft placeholder on the calendar with the native event editor for review/send. `create-event` still returns `buildDeepLink({ app: "calendar", view: "calendar", params: { eventId, date } })`; the click lands on the calendar with that event focused on its date.
- **Analytics** — `update-dashboard` / `save-analysis` return `buildDeepLink({ app: "analytics", view: "adhoc", params: { dashboardId } })`; the agent builds a dashboard over MCP and hands back "Open dashboard in Analytics".
- **Design** — `get-design-snapshot` is the GET + `publicAgent` ingest action: it returns the **live** Yjs file contents plus the resolved tweak values so the agent continues from the tuned design, not the original tokens. `apply-tweaks` round-trips back with an "Open design" editor link.
- **Content** — `pull-document` is the GET + `publicAgent` ingest action: it flushes any open live collaborative session to SQL first so the external agent ingests exactly what the user sees, then surfaces a deep link to the document.
- **Brain** — `ask-brain` / `search-everything` return a cited answer plus a deep link to the underlying knowledge/capture, so a terminal agent's lookup links straight back into the source in the running app.

## Authoring: the `link` builder {#link-builder}

This section is for template authors. `defineAction` accepts an optional `link` builder. When set, every MCP/A2A result for that tool auto-appends a markdown `[label →](absoluteUrl)` block and a structured `_meta["agent-native/openLink"] = { label, view, webUrl, desktopUrl }`. `tools/list` adds `annotations["agent-native/producesOpenLink"]` and a description suffix so the external agent knows the tool yields an openable link and should surface it.

Build the URL with `buildDeepLink(...)` — it is the single source of truth for the open-route format. Never hand-format the `/_agent-native/open` URL.

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
    return {
      url: composeDeepLink(draft),
      label: "Open draft in Mail",
      view: "inbox",
    };
  },
});
```

List/search actions point at a record-focused view the same way — e.g. calendar's `create-event` returns `buildDeepLink({ app: "calendar", view: "calendar", params: { eventId, date } })` with label `"Open event in Calendar"`. Calendar draft actions use the same pattern: `manage-event-draft` returns `buildDeepLink({ app: "calendar", view: "calendar", to: "/", params: { eventDraftId, calendarDraft, date } })` with label `"Review invite in Calendar"`, so external agents can hand back a direct draft-review link without creating the event first.

## Authoring: optional MCP Apps UI {#mcp-apps}

Actions can advertise an inline UI resource with `mcpApp` for hosts that support the MCP Apps extension. Use `embedRoute({ title, openLabel, path })` as the convenience wrapper, or assign `embedApp(...)` to `mcpApp.resource` directly. Every MCP App is a real React route, not a separate plain-HTML widget. Always keep the `link` builder — CLI-only hosts, older clients, and non-MCP-Apps hosts use it as the fallback.

See [MCP Apps](/docs/mcp-apps) for the full authoring guide — `embedRoute` vs `embedApp`, the `mcpApp` config shape, CSP, height, the `sendToAgentChat()` embed path, and host bridge client helpers.

### The `link` contract {#link-contract}

The `link` builder is **pure and synchronous — no I/O, no awaits**. It runs best-effort: a throw, `null`, or `undefined` is swallowed and **never** fails the tool call. It only reads the call's `args` and `result`; it must not query the DB, read app-state, or call other actions. Return `null` when there's nothing to open.

`buildDeepLink({ app, view, params?, to?, compose? })` returns the app-relative path `/_agent-native/open?app=…&view=…&<recordId>=…`. The MCP layer turns that into an absolute web URL (`toAbsoluteOpenUrl`, using the request origin) and a desktop `agentnative://open?…` URL (`toDesktopOpenUrl`); the markdown link uses the desktop URL when the client signals `target: "desktop"`.

### The `/_agent-native/open` route {#open-route}

When the user clicks the link in any browser or inline webview, `GET /_agent-native/open` (`createOpenRouteHandler`, mounted by the core routes plugin):

1. Resolves the **browser** session via `getSession` (the auth guard bypasses the exact path `/_agent-native/open`).
2. If unauthenticated, serves the configured login HTML **at the same URL**; the form's success handler reloads `window.location`, re-entering the route authenticated — no `?next=` plumbing.
3. Writes the existing one-shot `navigate` application-state command (payload = every non-reserved query param + `view`) scoped to the browser session's email with `requestSource: "deep-link"`, and decodes a `compose` base64url draft into a `compose-<id>` key.
4. 302-redirects to a safe same-origin relative path (`to=`, else `/<view>`, else a per-template `resolveOpenPath`), forwarding `f_*` filter params so lists/dashboards open pre-filtered before the `navigate` command is even drained.

Cross-origin, scheme-relative `//host`, and control-char redirects are rejected (open-redirect guard). The route can be disabled per app via `disableOpenRoute`.

#### The browser-session identity rule {#identity-rule}

The link carries **no privileged state** — it is just `view` + record ids + filters. The record-focusing `navigate` write is scoped to whoever is logged into the **browser**, never the external agent's MCP token. So an agent authenticated as one identity can hand a user a link, and when that user clicks it the record opens where _the user_ is logged in. This is what makes the deep link safe to surface in a terminal or chat transcript. See [Context Awareness](/docs/context-awareness) for the `navigate` / `application_state` contract this bridges to.

### Ingest actions {#ingest}

An action an external agent reads to pull live app state into its own context must be:

```ts
export default defineAction({
  description: "…",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ id }) => {
    /* read LIVE state, not the stale DB snapshot column */
  },
});
```

`GET` + `readOnly` keeps the action side-effect-free and out of the screen-refresh change event. `publicAgent` is the **explicit opt-in** — a public web route never implies public MCP/A2A exposure; see [Actions](/docs/actions). Design/content ingest actions MUST read **live** state (the Yjs collaborative document, not the stale DB snapshot column) so the external agent sees what the user actually has on screen. Content's `pull-document` flushes any open live collab session to SQL first; design's `get-design-snapshot` returns the live Yjs file contents plus the user's resolved tweak values.

## Advanced: local development & manual setup {#advanced}

The hosted `connect` flow above is the recommended path. The options below are for local development and hand-rolled setups.

### Local development {#local-dev}

Run your app locally (`pnpm dev` / `npx @agent-native/core@latest dev`), then point a local agent at it with one command:

```bash
npx @agent-native/core@latest mcp install --client claude-code|claude-code-cli|codex|cowork \
  [--app <id>] [--scope user|project]
```

It provisions a token (a random `ACCESS_TOKEN` into the workspace `.env` for local dev, or a signed JWT if it detects a hosted origin) and writes an idempotent stdio server entry:

- **claude-code / claude-code-cli** — an `mcpServers` entry in `.mcp.json` (project scope, default) or `~/.claude.json` (`--scope user`).
- **cowork** — the same Claude Code JSON shape in `~/.cowork/mcp.json`.
- **codex** — an `[mcp_servers.<name>]` block in `~/.codex/config.toml`.

The entry runs `npx @agent-native/core@latest mcp serve --app <id>`, which by default is a **thin stdio proxy** to the running local app's `/_agent-native/mcp` — so the live action registry, HMR, and correct deep links stay the single source of truth. Pass `--standalone` to build the registry in-process instead. When `npx @agent-native/core@latest mcp install` detects a hosted origin (a non-localhost `APP_URL` / `BETTER_AUTH_URL` / `AGENT_NATIVE_MCP_URL` in the workspace `.env`), it writes an `http` client entry pointing at `<origin>/_agent-native/mcp` with a `Bearer` JWT instead of a stdio entry.

Companion subcommands:

| Command                                                    | What it does                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `npx @agent-native/core@latest mcp serve [--app <id>]`     | Run the MCP stdio transport (what client configs spawn).            |
| `npx @agent-native/core@latest mcp install --client <c>`   | Provision a token + write the client's MCP config (idempotent).     |
| `npx @agent-native/core@latest mcp uninstall --client <c>` | Remove the named MCP entry from a client's config (idempotent).     |
| `npx @agent-native/core@latest mcp status`                 | Show resolved MCP URL/port, token state, and per-client entries.    |
| `npx @agent-native/core@latest mcp token [--rotate]`       | Print (or rotate) the local `ACCESS_TOKEN` in the workspace `.env`. |

Restart the client after `install` so it picks up the new MCP server.

### Manual `.mcp.json` HTTP entry {#manual-entry}

You can also write the MCP client config by hand against any deployed endpoint with a token you supply yourself (an `ACCESS_TOKEN`, or an `A2A_SECRET`-signed JWT carrying the caller's `sub` + `org_domain` so tool runs stay tenant-scoped):

```jsonc
// .mcp.json
{
  "mcpServers": {
    "analytics": {
      "type": "http",
      "url": "https://analytics.agent-native.com/_agent-native/mcp",
      "headers": { "Authorization": "Bearer <ACCESS_TOKEN-or-JWT>" },
    },
  },
}
```

This is the unmanaged equivalent of what `connect` writes for you. See [MCP Protocol](/docs/mcp-protocol) for the full auth env-var matrix.

### Dev vs production tool surface {#dev-vs-prod}

In plain local dev (`NODE_ENV=development` and `AGENT_MODE !== "production"`) the MCP `tools/list` deliberately exposes only the generic builtins plus actions with `publicAgent.requiresAuth === false` — the per-app ingest actions (`requiresAuth: true`) and mutating actions (no `publicAgent`) are filtered out (`filterPublicAgentActions`). Stdio/code clients that use the `agent-native` proxy identify themselves and get the full developer catalog after auth. Chat-style remote HTTP callers stay on the compact app-facing catalog by default, even when authenticated, so ChatGPT/Claude cannot dump a huge full action catalog into the conversation.

### Switching first-party apps between prod and dev {#dev-switch}

When you already have first-party hosted apps connected and want to test local framework changes through `pnpm dev:lazy`, use the developer switcher:

```bash
pnpm dev:lazy -- --apps mail,calendar,analytics

npx @agent-native/core@latest connect dev --apps mail,calendar,analytics --client codex
```

`connect dev` rewrites the same stable MCP server names (`agent-native-mail`, `agent-native-calendar`, etc.) to the local dev-lazy gateway, so tool names do not change. It backs up the current production entries in `~/.agent-native/connect-profiles.json` before writing dev entries. The default gateway is `http://127.0.0.1:8080`; use `--gateway <url>` or `--port <n>` if your gateway moved.

Switch back with:

```bash
npx @agent-native/core@latest connect prod --apps mail,calendar,analytics --client codex
```

If `connect dev` cannot infer your local owner identity from an existing connected JWT, pass `--owner-email you@example.com`; this keeps local dev tools on the full authenticated MCP surface instead of the sparse unauthenticated dev surface.

## How it works & security {#how-it-works}

The standard OAuth path never exposes tokens to MCP Apps: the host stores OAuth access/refresh tokens and mediates tool calls and `resources/read` over the authenticated MCP connection. Embedded iframes receive app data and tool results, not bearer secrets.

Full-app embeds also avoid handing the MCP bearer token to the browser. The MCP caller mints a one-time embed ticket in SQL; the iframe launch route consumes it and sets a short-lived, iframe-safe browser session cookie. The landing URL carries a temporary `__an_embed_token` query param only long enough for the client to capture it, remove it from the address bar, and attach it to same-origin `fetch` calls when third-party cookies are blocked. Embed sessions are route-scoped; app fetches include the current embedded target, and the server rejects token reuse outside the minted route. App pages intentionally do not emit `X-Frame-Options` or CSP `frame-ancestors`, so Builder, Design, and MCP app hosts can iframe them. Browser iframe navigations also opt into COEP/CORP when needed for cross-origin isolated hosts.

The fallback hosted `connect` flow never copies the deployment's shared secret. Instead:

- A logged-in browser session mints a **per-user, scoped, revocable** token — an `A2A_SECRET`-signed JWT carrying the caller's `sub` + `org_domain` and a unique `jti`, so every tool run stays tenant-scoped via `runWithRequestContext`.
- The existing `/_agent-native/mcp` endpoint accepts that token like any other bearer (see [MCP Protocol](/docs/mcp-protocol)) — no new endpoint, no new transport.
- The same Connect page lists every token you've minted and lets you **revoke** any of them by `jti`. Treat them like personal access tokens: one per agent client, revoke when a machine is decommissioned.
- The deep link the agent hands back carries no privileged state. The record-focusing `navigate` write is always scoped to the **browser** session, never the agent's token — so a link is safe to paste into a terminal or chat transcript.

## Do / Don't {#do-dont}

**Do**

- Connect your own agent to Dispatch with `npx @agent-native/core@latest connect https://dispatch.agent-native.com`; use a direct app URL only when you want one isolated app.
- Add a `link` builder to any action that produces or lists a navigable resource (draft, event, dashboard, document).
- Build the URL with `buildDeepLink(...)` — the single source of truth for the open-route format.
- Keep `link` pure and synchronous; return `null` when there's nothing to open.
- Make external-agent ingest actions GET + `readOnly` + `publicAgent`, and read live (Yjs) state, not the stale DB column.
- Let the open route resolve the browser session; pass record ids as deep-link params and let the UI focus them via the polled `navigate` command.
- Revoke a minted connect token by `jti` when an agent client is decommissioned.
- Test MCP Apps with the lightweight fixtures around `embedApp()` and
  `McpAppRenderer`; they cover CSP, host context, app launch, and bridge
  message behavior without needing a real external host.
- When validating ChatGPT or Claude web, trigger a fresh tool call after shell
  changes and measure the visible iframe. Previously rendered frames in the
  same conversation may still show cached height or launch behavior.
- Keep ChatGPT/Claude app-host catalogs compact. Use Dispatch and
  `open_app({ embed: true })` for full-app previews; only mark a specific
  action `mcpApp.compactCatalog: true` when it must appear directly in the
  compact host discovery surface.

**Don't**

- Copy a deployment's shared `ACCESS_TOKEN` / `A2A_SECRET` into a client config when `connect` can mint a per-user, revocable token instead.
- Hand-format the `/_agent-native/open` URL — always go through `buildDeepLink`.
- Do I/O, awaits, DB reads, or app-state reads inside a `link` builder.
- Scope the `navigate` write to the agent token, or pass privileged state through the deep link — it's a pure pointer.
- Invent a new navigation mechanism; bridge to the existing `navigate` / `application_state` contract.
- Widen the public template allow-list when scaffolding an app from an external agent — the allow-list is authoritative and guarded.

## Related {#related}

- [MCP Apps](/docs/mcp-apps) — authoring MCP App UIs, the embed bridge, and host bridge API.
- [MCP Protocol](/docs/mcp-protocol) — the auto-mounted MCP server and `ask-agent` meta-tool.
- [MCP Clients](/docs/mcp-clients) — the symmetric direction: your app consuming local/remote MCP servers.
- [A2A Protocol](/docs/a2a-protocol) — the `ask-agent` meta-tool and JSON-RPC peer calls.
- [Actions](/docs/actions) — defining actions, `publicAgent`, GET / `readOnly`.
- [Context Awareness](/docs/context-awareness) — the `navigate` / `application_state` contract the open route bridges to.
