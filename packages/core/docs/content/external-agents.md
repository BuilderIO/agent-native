---
title: "External Agents"
description: "Connect Claude Code, Cowork, and Codex to an agent-native app over MCP — with deep links that drop the user back into the running UI and live artifact round-trip."
---

# External Agents

An agent-native app is reachable by any external coding agent — Claude Code (desktop & CLI), Claude Cowork, Codex — over [MCP](/docs/mcp-protocol). External agents are great at producing artifacts (a draft, an event, a dashboard) but they live in a terminal or another app. Without a bridge, the user gets a wall of JSON and has to go find the thing.

The external-agent bridge closes the loop: the agent does the work over MCP, then hands the user a single **"Open in &lt;app&gt; →"** link that opens the real app focused on exactly what was produced. It reuses the existing `navigate` / `application_state` contract the UI already drains every 2s (see [Context Awareness](/docs/context-awareness)) — there is no second navigation mechanism.

## Overview {#overview}

- **One-command setup** — `agent-native mcp install --client <c>` writes the client config and provisions a token.
- **`link` builder** — any action that produces or lists a navigable resource returns a deep link; MCP/A2A surfaces auto-append an "Open in … →" link.
- **`/_agent-native/open` route** — a pure pointer (view + record ids + filters); the record-focusing write is always scoped to the **browser session**, never the agent's token.
- **Ingest actions** — GET + `readOnly` + `publicAgent` actions let an external agent pull **live** app state into its own context.
- **Generic cross-app verbs** — a stable verb set (`list_apps`, `open_app`, `ask_app`, `create_workspace_app`, `list_templates`) so an external agent has a predictable surface without guessing per-app action names.

## Connect an external agent {#connect}

The framework already mounts an HTTP MCP endpoint at `/_agent-native/mcp` (see [MCP Protocol](/docs/mcp-protocol)). Every `defineAction` is exposed as an MCP tool, plus the `ask-agent` meta-tool that runs the full agent loop (the same entry point [A2A](/docs/a2a-protocol) uses). Hosted apps point an external agent at that URL with a bearer token (`ACCESS_TOKEN`, or an `A2A_SECRET` JWT carrying the caller's `sub` + `org_domain` so tool runs stay tenant-scoped).

For local Claude Code / Codex / Cowork, one command writes the client config:

```bash
agent-native mcp install --client claude-code|claude-code-cli|codex|cowork \
  [--app <id>] [--scope user|project]
```

It provisions a token (a random `ACCESS_TOKEN` into the workspace `.env` for local dev, or a signed JWT for a detected hosted deployment) and writes an idempotent stdio server entry:

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

## The `link` builder {#link-builder}

`defineAction` accepts an optional `link` builder. When set, every MCP/A2A result for that tool auto-appends a markdown `[label →](absoluteUrl)` block and a structured `_meta["agent-native/openLink"] = { label, view, webUrl, desktopUrl }`. `tools/list` adds `annotations["agent-native/producesOpenLink"]` and a description suffix so the external agent knows the tool yields an openable link and should surface it.

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

List/search actions point at a record-focused view the same way — e.g. calendar's `create-event` returns `buildDeepLink({ app: "calendar", view: "calendar", params: { eventId, date } })` with label `"Open event in Calendar"`.

### The `link` contract {#link-contract}

The `link` builder is **pure and synchronous — no I/O, no awaits**. It runs best-effort: a throw, `null`, or `undefined` is swallowed and **never** fails the tool call. It only reads the call's `args` and `result`; it must not query the DB, read app-state, or call other actions. Return `null` when there's nothing to open.

`buildDeepLink({ app, view, params?, to?, compose? })` returns the app-relative path `/_agent-native/open?app=…&view=…&<recordId>=…`. The MCP layer turns that into an absolute web URL (`toAbsoluteOpenUrl`, using the request origin) and a desktop `agentnative://open?…` URL (`toDesktopOpenUrl`); the markdown link uses the desktop URL when the client signals `target: "desktop"`.

## The `/_agent-native/open` route {#open-route}

When the user clicks the link in any browser or inline webview, `GET /_agent-native/open` (`createOpenRouteHandler`, mounted by the core routes plugin):

1. Resolves the **browser** session via `getSession` (the auth guard bypasses the exact path `/_agent-native/open`).
2. If unauthenticated, serves the configured login HTML **at the same URL**; the form's success handler reloads `window.location`, re-entering the route authenticated — no `?next=` plumbing.
3. Writes the existing one-shot `navigate` application-state command (payload = every non-reserved query param + `view`) scoped to the browser session's email with `requestSource: "deep-link"`, and decodes a `compose` base64url draft into a `compose-<id>` key.
4. 302-redirects to a safe same-origin relative path (`to=`, else `/<view>`, else a per-template `resolveOpenPath`), forwarding `f_*` filter params so lists/dashboards open pre-filtered before the `navigate` command is even drained.

Cross-origin, scheme-relative `//host`, and control-char redirects are rejected (open-redirect guard). The route can be disabled per app via `disableOpenRoute`.

### The browser-session identity rule {#identity-rule}

The link carries **no privileged state** — it is just `view` + record ids + filters. The record-focusing `navigate` write is scoped to whoever is logged into the **browser**, never the external agent's MCP token. So an agent authenticated as one identity can hand a user a link, and when that user clicks it the record opens where _the user_ is logged in. This is what makes the deep link safe to surface in a terminal or chat transcript. See [Context Awareness](/docs/context-awareness) for the `navigate` / `application_state` contract this bridges to.

## Ingest actions {#ingest}

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

## Generic cross-app verbs + scaffolding {#cross-app}

On top of the per-action tools the MCP server exposes a stable verb set so an external agent has a predictable surface without guessing per-app action names:

| Tool                                       | Side effects | Returns                                                                              |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| `list_apps`                                | none         | workspace apps + their dev URLs / running state                                      |
| `open_app({ app, view, params? })`         | none         | a `buildDeepLink` URL (surfaces as an "Open …" link)                                 |
| `ask_app({ app, message })`                | agent loop   | routes a natural-language task to that app's in-app agent (delegates to `ask-agent`) |
| `create_workspace_app({ name, template })` | scaffolds    | a new app booted via the workspace path, plus its running URL + deep link            |
| `list_templates`                           | none         | the allow-listed templates only                                                      |

`create_workspace_app` rejects any non-allow-listed template — the public template allow-list in `packages/shared-app-config/templates.ts` is authoritative and CI-guarded; an external agent cannot widen it. A same-named template action overrides a builtin (template-over-core precedence). Disable the whole set with `MCPConfig.builtinCrossAppTools: false`.

## Per-app tour {#tour}

Every allow-listed template that produces or lists a navigable resource ships a `link` builder, and the ingest-heavy ones ship a GET + `publicAgent` action:

- **Mail** — `manage-draft` returns a `compose`-encoded deep link; clicking it opens the inbox with the draft restored into a `compose-<id>`. `list-emails` / `search-emails` point at a filtered inbox view.
- **Calendar** — `create-event` returns `buildDeepLink({ app: "calendar", view: "calendar", params: { eventId, date } })`; the click lands on the calendar with that event focused on its date.
- **Analytics** — `update-dashboard` / `save-analysis` return `buildDeepLink({ app: "analytics", view: "adhoc", params: { dashboardId } })`; the agent builds a dashboard over MCP and hands back "Open dashboard in Analytics".
- **Design** — `get-design-snapshot` is the GET + `publicAgent` ingest action: it returns the **live** Yjs file contents plus the resolved tweak values so the agent continues from the tuned design, not the original tokens. `apply-tweaks` round-trips back with an "Open design" editor link.
- **Content** — `pull-document` is the GET + `publicAgent` ingest action: it flushes any open live collaborative session to SQL first so the external agent ingests exactly what the user sees, then surfaces a deep link to the document.
- **Brain** — `ask-brain` / `search-everything` return a cited answer plus a deep link to the underlying knowledge/capture, so a terminal agent's lookup links straight back into the source in the running app.

## Do / Don't {#do-dont}

**Do**

- Add a `link` builder to any action that produces or lists a navigable resource (draft, event, dashboard, document).
- Build the URL with `buildDeepLink(...)` — the single source of truth for the open-route format.
- Keep `link` pure and synchronous; return `null` when there's nothing to open.
- Make external-agent ingest actions GET + `readOnly` + `publicAgent`, and read live (Yjs) state, not the stale DB column.
- Let the open route resolve the browser session; pass record ids as deep-link params and let the UI focus them via the polled `navigate` command.

**Don't**

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
