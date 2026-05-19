---
title: "External Agents: Claude, ChatGPT, Codex, Cursor, Cowork"
description: "Connect Claude, ChatGPT, Codex, Cursor, Claude Cowork, or any MCP-compatible host to a hosted agent-native app — then round-trip artifacts back into the running UI with MCP Apps and deep links."
search: "Claude ChatGPT Claude Code Codex Cursor Claude Cowork MCP Apps agent-native connect local agent tools external agents"
---

# External Agents

An agent-native app is reachable by any MCP-compatible host — Claude, Claude Desktop, Claude Code, ChatGPT custom MCP apps, Codex, Cursor, Claude Cowork, VS Code GitHub Copilot, Goose, Postman, MCPJam, and future clients that implement the standard. External agents are great at producing artifacts (a draft, an event, a dashboard) but they often live in a terminal or another app. Without a bridge, the user gets a wall of JSON and has to go find the thing.

The external-agent bridge closes the loop. First you connect your own agent to a **hosted** app — one command, no token copying where we can write the client config, or a standard remote MCP endpoint everywhere else. Then the agent does the work over MCP and hands the user either an inline **MCP App** UI in compatible hosts or a single **"Open in &lt;app&gt; →"** link that opens the real app focused on exactly what was produced. It reuses the existing `navigate` / `application_state` contract the UI already drains every 2s (see [Context Awareness](/docs/context-awareness)) — there is no second navigation mechanism.

## Connect Claude Code, Codex, Cursor, and Cowork {#connect}

The first-party hosted apps live at `mail.agent-native.com`, `calendar.agent-native.com`, `analytics.agent-native.com`, and so on. This flow connects supported local agent clients on your machine — Claude Code, Claude Code CLI, Codex, and Claude Cowork — to a hosted agent-native app over MCP. Cursor can use the same MCP endpoint via the no-CLI/manual config path below.

If you have the Agent-Native CLI installed, run:

```bash
agent-native connect https://mail.agent-native.com
```

Or run the same command through npm without installing anything globally:

```bash
npx @agent-native/core connect https://mail.agent-native.com
```

This opens your browser at the app. You are already logged in, so you just click **Authorize** once. The command then asks which local agent clients should receive MCP config. All clients are preselected the first time; after you choose, the selection is saved to `~/.agent-native/connect.json` so the next run can reuse it with Enter, or you can edit the checked items.

| Local client                  | Config written by `connect`                                 |
| ----------------------------- | ----------------------------------------------------------- |
| Claude Code / Claude Code CLI | `.mcp.json` or `~/.claude.json`, depending on `--scope`     |
| Codex                         | `~/.codex/config.toml` under `[mcp_servers.<app>]`          |
| Claude Cowork                 | `~/.cowork/mcp.json` using the Claude Code MCP server shape |

There is no token to copy and no local server to run. Restart the agent client after connecting so it picks up the new MCP server.

Use `--client codex` (or `--client claude-code`, `--client claude-code-cli`, `--client cowork`, `--client all`) to skip the picker for scripts or one-off installs.

Connect every first-party hosted app at once with:

```bash
npx @agent-native/core connect --all
```

The client picker appears once and the same selection is used for every hosted app.

The connection is **per-user, scoped, and revocable**. The browser session you authorized with is the identity the agent acts as; nothing exposes the deployment's shared secret.

### No-CLI alternative {#no-cli}

If you'd rather not run a command, open the app in your browser and use its **Connect** affordance (served at `https://<app>/_agent-native/mcp/connect`). While logged in, click **Connect / Authorize**. The page hands you either a one-click deep link that configures a detected agent, or a ready-to-paste `.mcp.json` block:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "mail": {
      "type": "url",
      "url": "https://mail.agent-native.com/_agent-native/mcp",
      "headers": { "Authorization": "Bearer <minted-token>" },
    },
  },
}
```

Restart the agent client after connecting so it picks up the new MCP server.

Use this manual block for MCP clients that are not yet written by `agent-native connect`, including Cursor, Claude web/Desktop connector setup, ChatGPT developer-mode custom MCP apps, VS Code GitHub Copilot, Goose, Postman, MCPJam, and any other host that accepts a remote Streamable HTTP MCP endpoint.

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

### Generic cross-app verbs {#cross-app}

On top of the per-action tools the MCP server exposes a stable verb set, so an external agent has a predictable surface without guessing per-app action names:

| Tool                                       | Side effects | Returns                                                                              |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| `list_apps`                                | none         | workspace apps + their URLs / running state                                          |
| `open_app({ app, view, params? })`         | none         | a `buildDeepLink` URL (surfaces as an "Open …" link)                                 |
| `ask_app({ app, message })`                | agent loop   | routes a natural-language task to that app's in-app agent (delegates to `ask-agent`) |
| `create_workspace_app({ name, template })` | scaffolds    | a new app booted via the workspace path, plus its running URL + deep link            |
| `list_templates`                           | none         | the allow-listed templates only                                                      |

`create_workspace_app` rejects any non-allow-listed template — the public template allow-list in `packages/shared-app-config/templates.ts` is authoritative and CI-guarded; an external agent cannot widen it. A same-named template action overrides a builtin (template-over-core precedence). Disable the whole set with `MCPConfig.builtinCrossAppTools: false`.

### Per-app tour {#tour}

Every allow-listed template that produces or lists a navigable resource ships a `link` builder, and the ingest-heavy ones ship a GET + `publicAgent` action so a connected agent can pull live state:

- **Mail** — `manage-draft` returns a `compose`-encoded deep link; clicking it opens the inbox with the draft restored into a `compose-<id>`. `list-emails` / `search-emails` point at a filtered inbox view.
- **Calendar** — `manage-event-draft` returns a `calendarDraft` + `eventDraftId` deep link; clicking it opens the New Event form prefilled for review/send. `create-event` still returns `buildDeepLink({ app: "calendar", view: "calendar", params: { eventId, date } })`; the click lands on the calendar with that event focused on its date.
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

For hosts that support the MCP Apps extension, an action can also advertise an inline HTML UI resource with `mcpApp`. This is a progressive enhancement for flows where the external agent should hand the user an interactive surface instead of only text — for example reviewing an email draft, editing a calendar invite, or choosing between generated dashboard variants.

```ts
export default defineAction({
  // ...description, schema, run, link...
  mcpApp: {
    resource: {
      title: "Review draft",
      description: "Review and send the generated email draft.",
      html: ({ actionName, requestOrigin }) => `<!doctype html>
        <html><body data-action="${actionName}" data-origin="${requestOrigin}">
          <main id="app"></main>
        </body></html>`,
      csp: { connectDomains: ["https://mail.agent-native.com"] },
      prefersBorder: true,
    },
  },
});
```

The MCP server advertises extension `io.modelcontextprotocol/ui`, adds `_meta.ui.resourceUri` plus `_meta["ui/resourceUri"]` to `tools/list`, and exposes the HTML through `resources/list` + `resources/read` using MIME `text/html;profile=mcp-app`. The stdio proxy forwards those resource handlers from the live app, so desktop and CLI clients see the same resources as HTTP clients.

Keep the existing `link` builder even when adding `mcpApp`. CLI-only clients, older hosts, and any host that does not render MCP Apps will ignore the UI metadata and still need the `"Open in … →"` link. Treat `mcpApp.resource.html` like `link`: synchronous, deterministic, and self-contained; declare external origins in `csp`. Use the full app deep link for heavyweight authenticated workflows that do not fit cleanly in an embedded iframe.

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

`GET` + `readOnly` keeps the action side-effect-free and out of the screen-refresh poll. `publicAgent` is the **explicit opt-in** — a public web route never implies public MCP/A2A exposure; see [Actions](/docs/actions). Design/content ingest actions MUST read **live** state (the Yjs collaborative document, not the stale DB snapshot column) so the external agent sees what the user actually has on screen. Content's `pull-document` flushes any open live collab session to SQL first; design's `get-design-snapshot` returns the live Yjs file contents plus the user's resolved tweak values.

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
      "type": "url",
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

The hosted `connect` flow never copies the deployment's shared secret. Instead:

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
