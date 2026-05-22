---
title: "External Agents: Claude, ChatGPT, Codex, Cursor, Cowork"
description: "Connect Claude, ChatGPT, Codex, Cursor, Claude Cowork, or any MCP-compatible host to a hosted agent-native app — then round-trip artifacts back into the running UI with MCP Apps and deep links."
search: "Claude ChatGPT Claude Code Codex Cursor Claude Cowork MCP Apps agent-native connect local agent tools external agents"
---

# External Agents

An agent-native app is reachable by any MCP-compatible host — Claude, Claude Desktop, Claude Code, ChatGPT custom MCP apps, Codex, Cursor, Claude Cowork, VS Code GitHub Copilot, Goose, Postman, MCPJam, and future clients that implement the standard. External agents are great at producing artifacts (a draft, an event, a dashboard) but they often live in a terminal or another app. Without a bridge, the user gets a wall of JSON and has to go find the thing.

The external-agent bridge closes the loop. First you connect your own agent to a **hosted** app — either by pasting the app's remote MCP URL into a chat host like Claude or ChatGPT, or by running the developer CLI flow for local coding agents. Then the agent does the work over MCP and hands the user either an inline **MCP App** UI in compatible hosts or a single **"Open in &lt;app&gt; →"** link that opens the real app focused on exactly what was produced. It reuses the existing `navigate` / `application_state` contract the UI already drains every 2s (see [Context Awareness](/docs/context-awareness)) — there is no second navigation mechanism.

## Easy setup {#easy-setup}

Add the hosted app as a remote MCP connector in your chat host, sign in, and enable it in a chat.

**Recommended for cross-app work:** connect Dispatch once:

```text
https://dispatch.agent-native.com/_agent-native/mcp
```

Dispatch exposes a unified MCP gateway with `list_apps`, `ask_app`, and `open_app`. In Dispatch's **Agents** page, choose whether that gateway can reach all apps or only selected apps. This avoids adding Mail, Calendar, Analytics, Brain, and every workspace app as separate MCP resources.

**Shortcut:** every hosted agent-native app serves a one-page connect helper at `https://<app>/_agent-native/mcp/connect` (for example [dispatch.agent-native.com/\_agent-native/mcp/connect](https://dispatch.agent-native.com/_agent-native/mcp/connect), [mail.agent-native.com/\_agent-native/mcp/connect](https://mail.agent-native.com/_agent-native/mcp/connect), [analytics.agent-native.com/\_agent-native/mcp/connect](https://analytics.agent-native.com/_agent-native/mcp/connect), or `https://<your-app>/_agent-native/mcp/connect`). It shows the MCP URL with a one-click copy button and a tab strip — Claude · ChatGPT · Cursor · Claude Code · Codex · Other — each with the exact steps or copy-able command for that host. Bookmark it and share with non-developer teammates; everything below is also reachable from that page.

Use the hosted app's MCP URL:

| App       | Remote MCP URL                                         |
| --------- | ------------------------------------------------------ |
| Dispatch  | `https://dispatch.agent-native.com/_agent-native/mcp`  |
| Mail      | `https://mail.agent-native.com/_agent-native/mcp`      |
| Analytics | `https://analytics.agent-native.com/_agent-native/mcp` |
| Any app   | `https://<app-host>/_agent-native/mcp`                 |

When the chat host asks you to authorize Agent-Native, sign in with your workspace account and approve the MCP scopes:

| Scope       | What it enables                                      |
| ----------- | ---------------------------------------------------- |
| `mcp:read`  | Read-only tools and tool/resource discovery          |
| `mcp:write` | Drafting, updating, and other mutating actions       |
| `mcp:apps`  | Inline MCP Apps, charts, dashboards, drafts, and UIs |

Each chat host stores its own authorization, so connect Claude, ChatGPT, and other hosts separately.

### Claude and Claude Desktop {#claude-chat}

1. Open Claude.
2. Go to **Customize → Connectors**.
3. Choose **Add custom connector**.
4. Paste the remote MCP URL for the app.
5. Click **Connect**.
6. Sign in with your Agent-Native account, then approve `mcp:read`, `mcp:write`, and `mcp:apps`.
7. Start a chat and enable the connector from the connector/tools menu.

For Team or Enterprise workspaces, an owner or admin may need to add the connector under organization settings first. Each user still connects their own account once, so tool calls run as the signed-in user.

### ChatGPT web {#chatgpt}

ChatGPT's full MCP connector flow is currently workspace/admin gated. Use ChatGPT web in a workspace where custom MCP connectors are enabled.

1. In ChatGPT, open **Workspace settings**.
2. Enable the setting that allows custom MCP connectors or developer-mode connectors.
3. Go to **Apps** or **Connectors**, then choose **Create** or **Add custom connector**.
4. Paste the remote MCP URL for the app.
5. Choose OAuth authentication.
6. Scan or discover tools.
7. Sign in with your Agent-Native account and approve the MCP scopes.
8. Create the connector, then select it from a new chat's tools/apps menu.

If the ChatGPT workspace does not expose custom MCP connectors, ask a workspace admin to enable them first.

#### Recovering "Connector name already exists" {#chatgpt-drafts}

ChatGPT creates a **draft** the moment you click **Create app** — even if you closed the OAuth popup before approving the scopes. The draft is not visible under **Enabled apps**, but it still owns the name, so retrying with the same name surfaces a `"Connector name already exists"` toast. Recovery is fully self-service in the ChatGPT UI:

1. Open **Settings → Apps**.
2. Scroll past **Enabled apps** and **Advanced settings** to the **Drafts** section (labeled _"Private apps you've created in developer mode"_).
3. Click the draft with the conflicting name.
4. Either press **Connect** to finish OAuth in place (no rename needed), or open the **⋯** overflow menu and choose **Delete** and re-add via **Advanced settings → Create app**.

There is no "Drafts" tab on the **Add more / app directory** dialog, so non-admins sometimes miss the section entirely — it lives further down the same Settings → Apps page that lists enabled apps.

### Cursor {#cursor}

1. Open Cursor → **Settings → MCP**.
2. Click **Add MCP Server**.
3. Paste the remote MCP URL for the app and save.
4. When Cursor prompts, sign in with your Agent-Native account and approve `mcp:read`, `mcp:write`, and `mcp:apps`.

Cursor supports remote-OAuth MCP servers, so the paste-URL flow works the same as Claude — no terminal involved. Goose, Postman, MCPJam, and VS Code GitHub Copilot accept the same URL through their own MCP-server UIs once OAuth support is enabled in your build.

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

If you have the Agent-Native CLI installed, run:

```bash
agent-native connect https://dispatch.agent-native.com
```

Or run the same command through npm without installing anything globally:

```bash
npx @agent-native/core connect https://dispatch.agent-native.com
```

The command asks which local agent clients should receive MCP config. All clients are preselected the first time; after you choose, the selection is saved to `~/.agent-native/connect.json` so the next run can reuse it with Enter, or you can edit the checked items.

For Claude Code and Claude Code CLI, `connect` writes a standard remote HTTP MCP entry with no static headers. Restart Claude Code, run `/mcp`, and choose **Authenticate**; Claude completes the OAuth flow and stores its own tokens. For Codex and Claude Cowork, `connect` uses the compatibility device-code flow: it opens your browser at the app, you click **Authorize** once, and the command writes a scoped bearer-token entry. If you choose a mix of clients, it does both.

If you previously connected Claude Code through the old bearer-token flow, just run the same `agent-native connect ... --client claude-code` command again. The CLI replaces the legacy `Authorization` headers with the URL-only OAuth entry and tells you to re-authenticate from `/mcp`.

| Local client                  | Config written by `connect`                             | Auth flow                                       |
| ----------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Claude Code / Claude Code CLI | `.mcp.json` or `~/.claude.json`, depending on `--scope` | Standard remote MCP OAuth in Claude's `/mcp` UI |
| Codex                         | `~/.codex/config.toml` under `[mcp_servers.<app>]`      | Browser-authorized bearer fallback              |
| Claude Cowork                 | `~/.cowork/mcp.json` using the Claude Code MCP shape    | Browser-authorized bearer fallback              |

Restart the agent client after connecting so it picks up the new MCP server; OAuth-native clients may then prompt you to authenticate from their MCP UI.

Use `--client codex` (or `--client claude-code`, `--client claude-code-cli`, `--client cowork`, `--client all`) to skip the picker for scripts or one-off installs.

When you truly need isolated per-app MCP resources, connect every first-party hosted app at once with:

```bash
npx @agent-native/core connect --all
```

The client picker appears once and the same selection is used for every hosted app.

The connection is **per-user, scoped, and revocable**. In the OAuth path, the host stores the tokens after `/mcp` authentication; in the fallback path, the browser session you authorized with is the identity the agent acts as. Nothing exposes the deployment's shared secret.

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
claude mcp add --transport http agent-native-mail \
  https://mail.agent-native.com/_agent-native/mcp
```

This is the same URL-only entry that `agent-native connect https://dispatch.agent-native.com --client claude-code` writes for you. Then run `/mcp` in Claude Code and choose **Authenticate**. The client discovers auth from the MCP server's `401 WWW-Authenticate` challenge, fetches `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, dynamically registers a public OAuth client, opens the app's authorization page, and stores the resulting token securely. ChatGPT developer-mode connectors use the same server URL:

```text
https://mail.agent-native.com/_agent-native/mcp
```

The OAuth flow is authorization-code + PKCE with refresh-token rotation. Access tokens are audience-bound to the exact MCP resource URL and carry the signed user/org identity, so tool calls, `resources/read`, and MCP App iframe-initiated `tools/call` all run through the same `runWithRequestContext` tenant scoping as the existing connect-minted JWT path. The iframe never receives raw OAuth tokens; the host mediates calls through the authenticated MCP connection.

Current scopes are:

| Scope       | Allows                                                                    |
| ----------- | ------------------------------------------------------------------------- |
| `mcp:read`  | read-only MCP actions and ordinary tool/resource discovery                |
| `mcp:write` | mutating actions and the `ask-agent` meta-tool                            |
| `mcp:apps`  | MCP Apps resource listing/reading and inline UI rendering where supported |

When the client requests no explicit scope, the app grants all three so the connector behaves like the browser-authorized Connect flow. Keep the bearer-token Connect page and `agent-native connect --token <token>` fallback around for local dev, fallback hosts, and clients where you need a ready-to-paste config block.

## What you can do once connected {#what-you-can-do}

Once your agent is connected, the app's full action surface is available as MCP tools, plus the `ask-agent` meta-tool that runs the full agent loop (the same entry point [A2A](/docs/a2a-protocol) uses). Ask your agent to do real work and it hands back a link straight into the running app:

```
> draft an email to John about the Q3 report

Claude Code calls: manage-draft(to: "john@example.com", subject: "Q3 Report", body: "…")
→ Open draft in Mail → https://mail.agent-native.com/_agent-native/open?app=mail&view=inbox&compose=…
```

Click that link and Mail opens with the draft restored — focused exactly where you, the logged-in user, are. The agent never had to know your session; it just produced the artifact.

### MCP Apps compatibility {#mcp-apps-compatibility}

Agent-native apps also speak the official MCP Apps extension. When any action declares `mcpApp`, the server advertises `extensions["io.modelcontextprotocol/ui"]`, includes both `_meta.ui.resourceUri` and the legacy-compatible `_meta["ui/resourceUri"]` in `tools/list`, and serves the HTML UI through `resources/list` + `resources/read` as `text/html;profile=mcp-app`.

That makes the same app surface available to every compatible host rather than building per-client shims. The current official MCP Apps client list includes Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT, and Cursor; host support still varies by plan, release channel, and client version, so check the [MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix). ChatGPT custom MCP apps are available through developer mode for Business and Enterprise/Edu workspaces on ChatGPT web; see OpenAI's [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta) notes.

Claude Code and other CLI-first clients still receive the same resources and metadata when they support MCP Apps, but the deep link remains the reliable fallback when a host chooses not to render an iframe. In practice, every agent-native app should be authored with both: MCP Apps for inline review/edit in capable hosts, and `link` for universal round-tripping back to the full app.

### First-class MCP App bridge {#mcp-app-bridge}

MCP App embeds are route embeds, not separate mini-products. `embedApp()`
starts from the action's `link` target, creates a short-lived embed session,
and launches that signed app route. Standard MCP Apps hosts can navigate the
MCP App frame itself when the host can hydrate the route directly. Claude web
uses a single-frame transplant path: the resource document fetches the signed
app HTML and hydrates it inside Claude's MCP App iframe because Claude does not
reliably allow app-owned child iframes or external frame navigation. ChatGPT
web gets a controlled route iframe because its Apps bridge gives us stable
`window.openai` host APIs and bounded height control. All paths point at the
same signed app route and render the normal route and React components. Design
embedded routes so a reload with the same signed URL reconstructs the same
view.

ChatGPT gets a dedicated compatibility path through `window.openai`: the launch
document reads `toolInput`, `toolOutput`, and `toolResponseMetadata` directly,
then calls `create_embed_session` via `window.openai.callTool(...)`. Standard
MCP Apps hosts use the `ui/*` JSON-RPC bridge. Directly hydrated routes can
call `ui/update-model-context`, `ui/message`, `ui/open-link`, and
`ui/request-display-mode` through the host bridge helpers. Claude's
transplanted route uses the same direct `ui/*` host bridge after hydration.
When the ChatGPT or explicit diagnostic iframe path is used, the wrapper
relays the same host actions over `agentNative.mcpHost.*` postMessage
requests. Keep the result shape identical for both paths: return a focused
`link` and concise structured content.

The resource shell owns the outer host size. Keep embedded app routes
internally scrollable and let the launcher report a bounded intrinsic height
rather than the full document height; otherwise host auto-resize can turn a
normal app page into a very tall chat artifact. A changed shell only affects
new MCP App resources and new tool calls. Old ChatGPT/Claude conversation
frames can keep the previous resource behavior, so verify sizing with a fresh
inline render before judging a fix.

Claude uses the single-frame transplant path by default. You can also force it
in other hosts with `embedMode: "transplant"` or `frame: "transplant"` when
debugging host module-loading behavior. You can force the nested diagnostic iframe with
`embedMode: "iframe"`, `renderMode: "iframe"`, `nested: true`, or
`frame: "iframe"`. If the iframe is blocked, `embedApp()` replaces it with an
open-app fallback: the user can retry inline, open a freshly minted embed
session through the host, or use the visible route URL. Keep the action's
`link` target useful on its own because it is still the universal escape hatch.

When testing Claude through ngrok, use a production build (`agent-native build`
then `agent-native start`) or a deployed preview/production URL. Claude's
single-frame transplant path works with production asset chunks; raw Vite dev
modules such as `/app/root.tsx` can be protected by app auth and fail dynamic
imports from the Claude resource origin.

The host bridge is deliberately small:

| Mode                   | Message type                          | Use it for                               |
| ---------------------- | ------------------------------------- | ---------------------------------------- |
| direct host route      | `ui/update-model-context`             | Hidden context for the host model        |
| direct host route      | `ui/message`                          | Post a visible user turn into the host   |
| direct host route      | `ui/open-link`                        | Open an external or app URL via the host |
| direct host route      | `ui/request-display-mode`             | Request `inline`, `fullscreen`, or `pip` |
| Claude transplant      | `ui/*`                                | Same direct host bridge after hydration  |
| ChatGPT / iframe route | `agentNative.mcpHostContext`          | Theme, locale, host platform, dimensions |
| ChatGPT / iframe route | `agentNative.embeddedAppReady`        | Confirm the route iframe loaded          |
| ChatGPT / iframe route | `agentNative.mcpHost.*` / `.response` | Wrapper relay for host requests          |

Embedded routes can use `updateMcpAppModelContext()`,
`openMcpAppHostLink()`, `requestMcpAppDisplayMode()`,
`getMcpAppHostContext()`, and `useMcpAppHostContext()` from
`@agent-native/core/client`. `sendToAgentChat()` uses the same path from
full-app embeds for auto-submitted prompts.

Display mode is best-effort. The in-app `McpAppRenderer` currently reports an
inline web host context and an inline-only display mode; external hosts may
honor larger display requests, ignore them, or reply with an unsupported-mode
error. Always keep the inline route usable.

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

For OAuth callers that request `mcp:apps`, the server intentionally advertises a compact `tools/list` catalog so app hosts do not ingest every internal action schema. The model sees app-facing builtins (`list_apps`, `open_app`, app-only `create_embed_session`) and actions with `mcpApp`. Stdio/static-token developer clients still get the full connected action surface, and `publicAgent.expose` remains the opt-in for safe read/ingest tools outside the compact app catalog. If a UI-capable host should be able to call a new action from an MCP App conversation, mark it with `mcpApp`; use `publicAgent` for non-UI read/ingest handoff tools.

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

For hosts that support the MCP Apps extension, an action can also advertise an inline UI resource with `mcpApp`. This is a progressive enhancement for flows where the external agent should hand the user an interactive surface instead of only text — for example reviewing an email draft, editing a calendar invite, or choosing between generated dashboard variants.

Use the real React app with `embedRoute()` or `embedApp()` whenever the user needs UI. The mental model is simple: the action's `link` target is also the MCP App embed target. Expose the operation as a normal action/tool, return a focused deep link with `link`, and add `mcpApp.resource = embedApp(...)` so capable hosts load that same route inline instead of opening a new tab. When both should be built from the same route, prefer `embedRoute({ title, openLabel, path })`; it returns matching `link` and `mcpApp` action fields.

That means full-app embeds can do anything the route can do once opened: review or edit an email draft, show a filtered inbox/search, open a calendar event or event draft, load an extension page, inspect a full analytics dashboard or saved analysis, continue a deck in the Slides editor, or open a Design project/editor. Prefer URL/deep-link params and the existing `/_agent-native/open` navigation/app-state bridge over inventing a second state protocol for MCP Apps.

On rare occasions the right target is a focused app route that renders one shared React component instead of the whole app shell. Analytics' `/chart` route is the model: it takes a compact `SqlPanel` payload in the URL and renders the same chart component the dashboard uses. This is still an app embed, not a plain HTML MCP App. Expose or call it through a normal action / `open_app({ path, embed: true })`, keep the URL deterministic, and let `embedApp()` render that route inline.

Do not hand-write one-off plain HTML MCP Apps for product UI; if the action needs a custom surface, add or reuse a real app route/component first and embed that route.

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...description, schema, run, link...
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

The MCP server advertises extension `io.modelcontextprotocol/ui`, adds `_meta.ui.resourceUri` plus `_meta["ui/resourceUri"]` to `tools/list`, and also emits ChatGPT Apps SDK compatibility metadata (`openai/outputTemplate`, widget CSP/description/accessibility). It exposes the HTML through `resources/list`, `resources/templates/list`, and `resources/read` using MIME `text/html;profile=mcp-app`. The stdio proxy forwards those resource handlers from the live app, so desktop and CLI clients see the same resources as HTTP clients.

Keep the existing `link` builder even when adding `mcpApp`. CLI-only clients, older hosts, and any host that does not render MCP Apps will ignore the UI metadata and still need the `"Open in … →"` link. `embedApp()` uses that link as its launch target, calls the app-only `create_embed_session` helper, exchanges a one-time SQL ticket at `/_agent-native/embed/start`, and navigates the MCP App frame to the target route with a short-lived browser session plus a bearer fallback for same-origin fetches. `open_app({ app, path, embed: true })` is the generic escape hatch for routes such as full dashboards, filtered inboxes, calendar draft views, analyses, and extension pages, and should be used liberally when the full app is the clearest review/edit surface.

`embedApp()` includes the MCP request origin in the resource CSP so the launcher
can fetch and, when explicitly requested, frame the signed first-party app
route. Only pass additional `frameDomains` for a custom MCP App that truly
embeds a third-party player.

Inside those `embedApp()` routes, `sendToAgentChat()` is embed-aware.
Auto-submitted prompts relay to the MCP host as `ui/update-model-context` plus
`ui/message`, so a button in the embedded app can intentionally continue the
Claude/ChatGPT conversation from the selected app state. `submit: false`
remains local prefill/review behavior.

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

Run your app locally (`pnpm dev` / `agent-native dev`), then point a local agent at it with one command:

```bash
agent-native mcp install --client claude-code|claude-code-cli|codex|cowork \
  [--app <id>] [--scope user|project]
```

It provisions a token (a random `ACCESS_TOKEN` into the workspace `.env` for local dev, or a signed JWT if it detects a hosted origin) and writes an idempotent stdio server entry:

- **claude-code / claude-code-cli** — an `mcpServers` entry in `.mcp.json` (project scope, default) or `~/.claude.json` (`--scope user`).
- **cowork** — the same Claude Code JSON shape in `~/.cowork/mcp.json`.
- **codex** — an `[mcp_servers.<name>]` block in `~/.codex/config.toml`.

The entry runs `agent-native mcp serve --app <id>`, which by default is a **thin stdio proxy** to the running local app's `/_agent-native/mcp` — so the live action registry, HMR, and correct deep links stay the single source of truth. Pass `--standalone` to build the registry in-process instead. When `agent-native mcp install` detects a hosted origin (a non-localhost `APP_URL` / `BETTER_AUTH_URL` / `AGENT_NATIVE_MCP_URL` in the workspace `.env`), it writes an `http` client entry pointing at `<origin>/_agent-native/mcp` with a `Bearer` JWT instead of a stdio entry.

Companion subcommands:

| Command                                   | What it does                                                        |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `agent-native mcp serve [--app <id>]`     | Run the MCP stdio transport (what client configs spawn).            |
| `agent-native mcp install --client <c>`   | Provision a token + write the client's MCP config (idempotent).     |
| `agent-native mcp uninstall --client <c>` | Remove the named MCP entry from a client's config (idempotent).     |
| `agent-native mcp status`                 | Show resolved MCP URL/port, token state, and per-client entries.    |
| `agent-native mcp token [--rotate]`       | Print (or rotate) the local `ACCESS_TOKEN` in the workspace `.env`. |

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

In plain local dev (`NODE_ENV=development` and `AGENT_MODE !== "production"`) the MCP `tools/list` deliberately exposes only the generic builtins plus actions with `publicAgent.requiresAuth === false` — the per-app ingest actions (`requiresAuth: true`) and mutating actions (no `publicAgent`) are filtered out (`filterPublicAgentActions`). The full per-app surface appears when the request is authenticated as a real caller: a deployed / `AGENT_MODE=production` app, or a local app reached through `connect` / `agent-native mcp install` (which provisions a token so the caller has an identity). So if `tools/list` looks sparse, you are hitting an unauthenticated dev endpoint — connect (or present a token) rather than assuming the action is missing.

### Switching first-party apps between prod and dev {#dev-switch}

When you already have first-party hosted apps connected and want to test local framework changes through `pnpm dev:lazy`, use the developer switcher:

```bash
pnpm dev:lazy -- --apps mail,calendar,analytics

agent-native connect dev --apps mail,calendar,analytics --client codex
```

`connect dev` rewrites the same stable MCP server names (`agent-native-mail`, `agent-native-calendar`, etc.) to the local dev-lazy gateway, so tool names do not change. It backs up the current production entries in `~/.agent-native/connect-profiles.json` before writing dev entries. The default gateway is `http://127.0.0.1:8080`; use `--gateway <url>` or `--port <n>` if your gateway moved.

Switch back with:

```bash
agent-native connect prod --apps mail,calendar,analytics --client codex
```

If `connect dev` cannot infer your local owner identity from an existing connected JWT, pass `--owner-email you@example.com`; this keeps local dev tools on the full authenticated MCP surface instead of the sparse unauthenticated dev surface.

## How it works & security {#how-it-works}

The standard OAuth path never exposes tokens to MCP Apps: the host stores OAuth access/refresh tokens and mediates tool calls and `resources/read` over the authenticated MCP connection. Embedded iframes receive app data and tool results, not bearer secrets.

Full-app embeds also avoid handing the MCP bearer token to the browser. The MCP caller mints a one-time embed ticket in SQL; the iframe launch route consumes it and sets a short-lived, iframe-safe browser session cookie. The landing URL carries a temporary `__an_embed_token` query param only long enough for the client to capture it, remove it from the address bar, and attach it to same-origin `fetch` calls when third-party cookies are blocked. Embed sessions are route-scoped; app fetches include the current embedded target, and the server rejects token reuse outside the minted route. Production `X-Frame-Options: DENY` stays in place for normal page loads and is omitted only when that embed session marker is present.

The fallback hosted `connect` flow never copies the deployment's shared secret. Instead:

- A logged-in browser session mints a **per-user, scoped, revocable** token — an `A2A_SECRET`-signed JWT carrying the caller's `sub` + `org_domain` and a unique `jti`, so every tool run stays tenant-scoped via `runWithRequestContext`.
- The existing `/_agent-native/mcp` endpoint accepts that token like any other bearer (see [MCP Protocol](/docs/mcp-protocol)) — no new endpoint, no new transport.
- The same Connect page lists every token you've minted and lets you **revoke** any of them by `jti`. Treat them like personal access tokens: one per agent client, revoke when a machine is decommissioned.
- The deep link the agent hands back carries no privileged state. The record-focusing `navigate` write is always scoped to the **browser** session, never the agent's token — so a link is safe to paste into a terminal or chat transcript.

## Do / Don't {#do-dont}

**Do**

- Connect your own agent to a hosted app with `npx @agent-native/core connect <url>` (or `--all`) — it's the frictionless path.
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

**Don't**

- Copy a deployment's shared `ACCESS_TOKEN` / `A2A_SECRET` into a client config when `connect` can mint a per-user, revocable token instead.
- Hand-format the `/_agent-native/open` URL — always go through `buildDeepLink`.
- Do I/O, awaits, DB reads, or app-state reads inside a `link` builder.
- Scope the `navigate` write to the agent token, or pass privileged state through the deep link — it's a pure pointer.
- Invent a new navigation mechanism; bridge to the existing `navigate` / `application_state` contract.
- Widen the public template allow-list when scaffolding an app from an external agent — the allow-list is authoritative and guarded.

## Related {#related}

- [MCP Protocol](/docs/mcp-protocol) — the auto-mounted MCP server and `ask-agent` meta-tool.
- [MCP Clients](/docs/mcp-clients) — the symmetric direction: your app consuming local/remote MCP servers.
- [A2A Protocol](/docs/a2a-protocol) — the `ask-agent` meta-tool and JSON-RPC peer calls.
- [Actions](/docs/actions) — defining actions, `publicAgent`, GET / `readOnly`.
- [Context Awareness](/docs/context-awareness) — the `navigate` / `application_state` contract the open route bridges to.
  </content>
  </invoke>
