---
name: external-agents
description: >-
  Connect external coding agents (Claude Code desktop & CLI, Codex, Cursor,
  Claude Cowork) to an agent-native app over MCP, and round-trip artifacts back
  into the UI with deep links. Use when adding an action's `link` builder,
  wiring the `/_agent-native/open` route, exposing an "ingest" action to
  MCP/A2A, or scaffolding apps from an external agent.
---

# External Agents (MCP bridge + deep links)

## Rule

An agent-native app is reachable by any external coding agent (Claude Code,
Codex, Cursor, Cowork) over MCP. The **recommended** way to connect to a
deployed app is the one-command hosted flow — `npx @agent-native/core connect
<url>` — which mints a per-user, scoped, revocable token from a logged-in
browser session; no shared secret is copied. Once connected, every action that
produces or lists a navigable resource SHOULD return a deep link from a `link`
builder, so the external agent can surface an **"Open in <app> →"** link that
drops the user back into the running UI at the right view and record. The link
is a pure pointer — the record-focusing write is always scoped to the
**browser session**, never the agent's token.

## Why

External agents are great at producing artifacts (a draft, an event, a
dashboard) but they live in a terminal or another app. Without a bridge, the
user gets a wall of JSON and has to go find the thing. The deep-link bridge
closes the loop: the agent does the work over MCP, then hands the user a single
link that opens the real app focused on exactly what was produced. It reuses
the existing `navigate` / `application_state` contract the UI already drains
every 2s (see **context-awareness**) — we never invent a second navigation
mechanism.

## How

### 1. Connect to a hosted app (recommended)

The first-party hosted apps live at `mail.agent-native.com`,
`calendar.agent-native.com`, etc. One command wires every detected supported
agent client (Claude Code, Codex, Cowork) to one of them. Cursor can use the
same MCP endpoint via the no-CLI/manual config path:

```bash
npx @agent-native/core connect https://mail.agent-native.com
# or connect every first-party hosted app at once:
npx @agent-native/core connect --all
```

It opens the browser at the app; the user is already logged in and clicks
**Authorize** once. No token to copy, no local server. The connection is
**per-user, scoped, and revocable**. The no-CLI equivalent is the in-app
**Connect** affordance served at `https://<app>/_agent-native/mcp/connect`,
which hands back a one-click deep link or a ready-to-paste `.mcp.json` block.

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
- `open_app({ app, view, params? })` — returns a `buildDeepLink` URL (no side
  effects); surfaces as an "Open …" link.
- `ask_app({ app, message })` — routes a natural-language task to that app's
  in-app agent (delegates to the existing `ask-agent` meta-tool).
- `create_workspace_app({ name, template })` — scaffolds + boots a new app via
  the workspace path (rejects non-allow-listed templates), returns its running
  URL + deep link.
- `list_templates` — the allow-listed templates only.

A same-named template action overrides a builtin (template-over-core
precedence). Disable the set with `MCPConfig.builtinCrossAppTools: false`.

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
`readOnly` keeps it side-effect-free and out of the screen-refresh poll;
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
- Do build the URL with `buildDeepLink(...)` — it is the single source of truth
  for the open-route format.
- Do keep `link` pure and synchronous; return `null` when there's nothing to
  open.
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
