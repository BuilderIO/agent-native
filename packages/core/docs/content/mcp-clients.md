---
title: "MCP Clients"
description: "Connect your agent-native app to local MCP servers (claude-in-chrome, filesystem, playwright, etc) so the agent gains their tools."
---

# MCP Clients

Agent-native apps can also act as MCP **clients** — connecting to locally installed MCP servers and exposing their tools to the agent chat. This is the symmetric counterpart to the [MCP Protocol](./mcp-protocol.md) (which makes your app an MCP server).

Looking for the other direction — connecting Claude, ChatGPT, Claude Code, Codex, Cursor, or Claude Cowork to an agent-native app? Use [External Agents](/docs/external-agents).

With one config file, every agent-native app in your workspace gains access to tools provided by MCP servers on your machine: `claude-in-chrome` for browser automation, `@modelcontextprotocol/server-filesystem` for reading files, `@playwright/mcp` for browser testing, and anything else that speaks MCP.

You can also [connect remote (HTTP) MCP servers at runtime](#remote-via-ui) — individual users or whole organizations — without editing a config file.

## Built-in browser and computer-use capabilities {#built-in-capabilities}

Agent-native includes built-in toggles for common local MCP servers. They are off by default and can be enabled per user or per organization:

| Capability         | Server id         | Command                                                                 |
| ------------------ | ----------------- | ----------------------------------------------------------------------- |
| Chrome DevTools    | `chrome-devtools` | `npx -y chrome-devtools-mcp@0.26.0 --autoConnect --no-usage-statistics` |
| Playwright Browser | `playwright`      | `npx -y @playwright/mcp@0.0.75`                                         |
| Computer Use       | `computer-use`    | `npx -y computer-use-mcp@1.8.0`                                         |

Only one browser capability can be enabled in a scope at a time. Enabling Chrome DevTools disables Playwright for that same user or org, and enabling Playwright disables Chrome DevTools.

Computer Use is macOS-only. On other platforms it is listed as unavailable and is skipped even if an old setting row contains it.

Chrome DevTools uses `--autoConnect` by default. That attaches to an eligible running Chrome instance; it does not create an isolated browser profile or sign into the user's regular profile for you. It requires Chrome 144+ with remote debugging enabled. A manual `browser-url` configuration can be added later when a deployment needs a specific debugging endpoint.

Built-ins are persisted in the framework's `settings` table under `u:<email>:mcp-builtin-capabilities` for personal toggles and `o:<orgId>:mcp-builtin-capabilities` for team toggles. When enabled, they merge into the runtime MCP manager with the same scoped visibility format as remote servers, for example `mcp__user_<emailhash>_playwright__*` or `mcp__org_<orgId>_chrome-devtools__*`.

### User-facing setup notes

Use concise, explicit setup copy for the sensitive built-ins:

- **Chrome DevTools** attaches to a running Chrome debugging target. Tell users
  it is intended for browser testing and logged-in verification, and that it
  may require enabling Chrome remote debugging before tools appear.
- **Playwright** launches an isolated browser. Recommend it for deterministic
  QA when the user's live Chrome profile is not required.
- **Computer Use** can operate local apps. Keep it off by default, explain the
  macOS Screen Recording and Accessibility prompts, and ask before taking
  sensitive actions such as purchases, financial changes, or account changes.

### Built-in endpoints

| Method | Route                        | Purpose                                                                    |
| ------ | ---------------------------- | -------------------------------------------------------------------------- |
| GET    | `/_agent-native/mcp/builtin` | List built-in capabilities, enabled scopes, merged ids, and live status.   |
| POST   | `/_agent-native/mcp/builtin` | Update a scope. Body: `{ scope, enabledIds }` or `{ scope, id, enabled }`. |

## Adding a local MCP server {#adding-a-server}

Create `mcp.config.json` at your workspace root (or at an individual app root — workspace root wins when both exist):

```jsonc
{
  "$schema": "https://agent-native.com/schema/mcp.config.json",
  "servers": {
    "claude-in-chrome": {
      "command": "claude-in-chrome-mcp",
      "args": [],
      "env": { "LOG_LEVEL": "info" },
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@0.0.75"],
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/me/projects",
      ],
    },
  },
}
```

On next app start you'll see:

```
[mcp-client] loaded config from /path/to/mcp.config.json (3 server(s))
[mcp-client] connected to claude-in-chrome: 12 tools
[mcp-client] connected to playwright: 9 tools
[mcp-client] connected to filesystem: 4 tools
```

The tools are registered in the agent's tool registry with the prefix `mcp__<server-id>__<tool-name>` so they can't collide with your template's actions. They are also included in `tool-search`, so agents can discover newly connected MCP capabilities by intent instead of needing the exact prefixed name up front.

## Config precedence {#precedence}

MCP configuration is resolved in this order, first match wins:

1. **Workspace root `mcp.config.json`** — detected via `agent-native.workspaceCore` in `package.json`. Shared across every app in the workspace.
2. **App-root `mcp.config.json`** — per-app override if you don't want an MCP server available in every app.
3. **`MCP_SERVERS` env var** — JSON string with the same shape, for CI/production where a file doesn't make sense.

## Production deploys: `MCP_SERVERS` {#mcp-servers-env}

For production deploys set the full config shape (or the inner server map) as an environment variable:

```bash
MCP_SERVERS='{"servers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@0.0.75"]}}}'
```

MCP tools only activate in Node runtimes — Cloudflare Workers and other edge targets silently skip MCP and continue with the rest of the app working normally.

## Auto-detect: `claude-in-chrome` {#autodetect}

If you have **no** `mcp.config.json` and the `claude-in-chrome-mcp` binary is on `PATH` (or in the well-known install location `~/.claude-in-chrome/bin/claude-in-chrome-mcp`), agent-native auto-registers it as a default MCP server. Set `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1` to opt out.

This means users who've installed the claude-in-chrome extension get browser control across every agent-native app they open with no config changes.

## Remote MCP servers via the settings UI {#remote-via-ui}

MCP (Model Context Protocol) servers give your agent new abilities — like connecting to Zapier, Cloudflare, Composio, or your company's internal tools. Once connected, the agent can use those tools just like its built-in ones.

### How to connect a remote MCP server

1. **Server name** — a short label for your own reference (e.g. "zapier", "slack-tools").
2. **URL** — the HTTPS endpoint the MCP server provider gave you (e.g. `https://mcp.zapier.com/s/abc123/mcp`). This is usually found in the provider's dashboard or integration docs.
3. **Description** (optional) — a note about what this server does.
4. **Headers** — authentication credentials the server requires, one per line. Most servers need an `Authorization` header. Example: `Authorization: Bearer sk-your-key-here`. The provider's docs will tell you what to put here.

Click **Test** to verify the connection before saving. If it succeeds, you'll see the number of tools available. Click **Connect** to add it.

### Personal vs Organization scope

Two scopes are supported:

- **Personal** — only the signed-in user gets the tools. Stored as a user-scope setting.
- **Team** — everyone in the active organization gets the tools. Owners and admins can add; members see the list read-only. Stored as an org-scope setting.

Adds and removes hot-reload into the running MCP manager — no process restart, and no server restart. The new `mcp__<scope>-<name>__*` tools appear to the agent on the next message and are searchable via `tool-search`.

HTTPS URLs are accepted everywhere; plain `http://` is only allowed for `localhost` during development. Optional auth goes in as a Bearer token that's sent via `Authorization: Bearer …` on every request.

Under the hood these servers are persisted in the framework's `settings` table under the key `u:<email>:mcp-servers-remote` (Personal) or `o:<orgId>:mcp-servers-remote` (Team) and merged with `mcp.config.json` on startup.

### HTTP endpoints

| Method | Route                                                 | Purpose                                                                |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/_agent-native/mcp/servers`                          | List the current user's personal + org servers with live status.       |
| POST   | `/_agent-native/mcp/servers`                          | Add a server. Body: `{ scope, name, url, headers?, description? }`.    |
| DELETE | `/_agent-native/mcp/servers/:id?scope=user\|org`      | Remove a server and reconfigure the manager.                           |
| POST   | `/_agent-native/mcp/servers/:id/test?scope=user\|org` | Dry-run the existing server's connect + list-tools.                    |
| POST   | `/_agent-native/mcp/servers/test`                     | Dry-run an arbitrary URL before persisting. Body: `{ url, headers? }`. |

Stdio servers are still a no-op outside Node runtimes, but remote HTTP MCP servers work in any environment with `fetch` — including desktop production builds.

## Shared MCP servers via a hub {#hub}

If your workspace runs multiple agent-native apps (e.g. dispatch + mail + clips), you can configure **one** app as the hub and have the others pull its org-scope MCP servers automatically. No per-app copy-paste of URLs and bearer tokens.

Dispatch is the conventional hub — it already coordinates across apps.

### 1. Enable hub-serve on the hub app (dispatch)

Set an env var in dispatch's deployment:

```bash
AGENT_NATIVE_MCP_HUB_TOKEN=<a-long-random-secret>
```

Dispatch now mounts `GET /_agent-native/mcp/hub/servers` which returns every org-scope MCP server stored in its `settings` table, with full URL + headers, authenticated by the token.

### 2. Point consuming apps at the hub

Set on every consumer (mail, clips, whatever):

```bash
AGENT_NATIVE_MCP_HUB_URL=https://dispatch.acme.com
AGENT_NATIVE_MCP_HUB_TOKEN=<the-same-secret>
```

At startup, each consumer pulls the hub's server list and merges it into its own MCP manager. The tools appear to the agent as `mcp__hub_<orgId>_<name>__*` — distinct from the consumer's own local `mcp__org_…` so there's no collision.

### 3. What gets shared

Only **org-scope** servers are shared. User-scope (Personal) servers stay with the user who added them — the hub never re-exposes personal credentials across apps.

Hub responses include the full auth headers (Bearer tokens etc). The transport is HTTPS, the endpoint requires the shared secret, and it only returns org-scope rows — treat the hub URL + token like a database credential.

### 4. Hot reload vs restart

Local UI adds in each app hot-reload via `McpClientManager.reconfigure()` — no restart. Hub-sourced servers currently re-fetch only when a local mutation triggers a reconfigure (or when the app restarts), so if you add a new server in dispatch, other apps pick it up on their next restart or next local change. Periodic background refresh is on the roadmap.

### Endpoints summary

| Method | Route                            | Purpose                                                                                                            |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/_agent-native/mcp/hub/servers` | Serve all org-scope servers with full creds (bearer-gated, only mounted when `AGENT_NATIVE_MCP_HUB_TOKEN` is set). |
| GET    | `/_agent-native/mcp/hub/status`  | Returns `{ serving, consuming, hubUrl }` for the settings UI card.                                                 |

## Status route {#status-route}

Every app exposes `GET /_agent-native/mcp/status` for tooling and onboarding:

```json
{
  "configuredServers": ["claude-in-chrome", "playwright"],
  "connectedServers": ["claude-in-chrome", "playwright"],
  "totalTools": 21,
  "tools": [
    {
      "source": "claude-in-chrome",
      "name": "mcp__claude-in-chrome__navigate",
      "description": "Navigate the browser to a URL"
    }
  ],
  "errors": {}
}
```

Use this to build "claude-in-chrome detected — your agent can now drive Chrome" onboarding hints, or debug MCP connection problems.

## Failure modes {#failures}

Individual MCP server failures never take down the agent:

- A misconfigured `command` → the server is skipped, its error appears in `/mcp/status` under `errors.<server-id>`, and every other server continues to work.
- The MCP SDK is missing from `node_modules` → all MCP functionality is skipped with a warning; agent chat keeps working with zero MCP tools.
- Running in an edge runtime → MCP client is a no-op.

Agent-native will always boot; broken MCP configuration just means fewer tools.

## Security {#security}

MCP tools run on your machine with whatever permissions the spawned process has. Treat `mcp.config.json` like any other list of executables you're willing to let the agent drive. Tools from MCP servers appear in the agent's tool-use loop just like your template's own actions, so make sure you trust every server you configure.
