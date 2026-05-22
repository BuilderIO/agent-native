---
title: "MCP Protocol"
description: "Expose your agent-native app as a remote MCP server so Claude, ChatGPT, Claude Code, Cursor, and other AI tools can call your app's actions directly."
---

# MCP Protocol

Every agent-native app automatically exposes a remote MCP (Model Context Protocol) server. This lets external AI tools like Claude, ChatGPT custom MCP apps, Claude Code, Cursor, Codex, VS Code GitHub Copilot, and Windsurf discover and call your app's actions directly — no extra code needed.

If your goal is to connect Claude, ChatGPT, Claude Code, Codex, Cursor, or Claude Cowork to a hosted agent-native app, start with [External Agents](/docs/external-agents). It documents the one-command `agent-native connect https://mail.agent-native.com` flow, standard remote MCP OAuth for Claude Code, bearer fallback config for older clients, manual remote MCP setup for hosts we do not write directly, MCP Apps inline UIs, and deep links back into the UI. This page is the lower-level MCP server reference.

## Overview {#overview}

MCP is the standard protocol for connecting AI tools to external capabilities. When you deploy an agent-native app, it auto-mounts an MCP endpoint alongside the existing A2A endpoint. Any MCP-compatible client can connect and use your app's tools.

Key concepts:

- **Auto-mounted** — every app gets `/_agent-native/mcp` for free, no setup required
- **Streamable HTTP** — uses the modern MCP transport over standard HTTP (POST + SSE)
- **Same actions** — the exact same action registry that powers agent chat and A2A
- **`ask-agent` tool** — a meta-tool that delegates to the full agent loop for complex tasks
- **MCP Apps** — actions can advertise inline HTML UIs through the official `io.modelcontextprotocol/ui` extension
- **Standard remote MCP OAuth** — OAuth 2.1 discovery, dynamic client registration, authorization-code + PKCE, refresh-token rotation
- **Bearer auth fallback** — uses `ACCESS_TOKEN`, `ACCESS_TOKENS`, or connect-minted JWTs for clients that cannot run OAuth

## MCP vs A2A {#mcp-vs-a2a}

Both protocols are auto-mounted. Use whichever fits your use case:

|                    | MCP                                                                      | A2A                                          |
| ------------------ | ------------------------------------------------------------------------ | -------------------------------------------- |
| **Best for**       | External tools calling your app                                          | Agent-to-agent communication                 |
| **Protocol**       | MCP Streamable HTTP                                                      | JSON-RPC 2.0                                 |
| **Tool discovery** | `tools/list`                                                             | Agent card at `/.well-known/agent-card.json` |
| **Endpoint**       | `/_agent-native/mcp`                                                     | `/_agent-native/a2a`                         |
| **Supported by**   | Claude, ChatGPT, Claude Code, Cursor, Codex, Cowork, and other MCP hosts | Other agent-native apps                      |
| **Execution**      | Direct tool calls (no extra LLM)                                         | Full agent loop (LLM reasoning)              |

You can also use the `ask-agent` MCP tool to get the best of both worlds — call it from Claude Code and let your app's agent reason through complex tasks.

## Manual MCP client config {#claude-code}

For the recommended one-command setup, use [External Agents](/docs/external-agents). If you are hand-writing MCP config for an OAuth-capable client, add your app as a remote MCP server with no static headers:

```jsonc
// ~/.claude/mcp_servers.json
{
  "mail": {
    "type": "http",
    "url": "https://mail.example.com/_agent-native/mcp",
  },
}
```

Then run `/mcp` in Claude Code and choose **Authenticate**. For clients that cannot perform remote MCP OAuth, use the Connect page or a static bearer-token entry with `headers.Authorization`.

Then in Claude Code, you can use your app's tools naturally:

```
> draft an email to John about the Q3 report

Claude Code calls: draft-email(to: "john@example.com", subject: "Q3 Report", body: "...")
```

## Connecting from other MCP clients {#other-clients}

Any MCP client that supports Streamable HTTP transport can connect. The endpoint is:

```
POST https://your-app.example.com/_agent-native/mcp
```

The server supports the standard MCP handshake: `initialize` → `initialized` → `tools/list` → `tools/call`.

If an action declares `mcpApp`, the server also advertises the official MCP Apps extension (`io.modelcontextprotocol/ui`) and supports `resources/list`, `resources/templates/list`, and `resources/read` for the app resource. Hosts that render MCP Apps can show the UI inline; hosts that do not can still call the tool and use the deep-link fallback. Product UIs should use `embedApp()` so the inline surface is the real React app route, or a focused route that renders a shared React component such as an Analytics chart, not a separate plain HTML implementation. The server emits both standard MCP Apps metadata and ChatGPT Apps SDK compatibility metadata so app-capable hosts can find the same `ui://` resource. The current official extension matrix includes Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT, and Cursor; host support varies by version and plan, so use the [External Agents MCP Apps notes](/docs/external-agents#mcp-apps-compatibility) for the user-facing guidance.

### MCP App embed bridge {#mcp-app-embed-bridge}

`embedApp()` is the low-level URL-first MCP App helper. It reads the action
result's open link, asks the app-only `create_embed_session` tool to mint a
route-scoped session, then launches the resulting app route. Standard hosts
hydrate the signed route by navigating the MCP App frame itself. Claude web
uses a single-frame transplant path that fetches the signed app HTML and
hydrates it inside Claude's MCP App iframe because Claude does not reliably
allow app-owned child iframes or external frame navigation. ChatGPT web keeps
the signed app URL in a controlled route iframe for stable `window.openai`
host APIs and bounded height control.
For normal action authoring, use `embedRoute()` when the action's
`link` and `mcpApp` should come from the same pure route builder. The route
itself should derive state from the URL and normal app data fetching.

The outer MCP resource reports a bounded inline height to the host and the app
route scrolls internally. Do not rely on host auto-resize measuring the full
document; in ChatGPT and Claude this can make a normal full-app route appear as
a huge chat artifact. Host conversations also keep already-rendered iframes, so
after changing the resource shell or `ui://` version, test a fresh tool call
rather than re-measuring an old frame.

Default direct embeds talk to the MCP Apps host through standard `ui/*`
JSON-RPC messages:

| Type                      | Payload shape                      |
| ------------------------- | ---------------------------------- |
| `ui/update-model-context` | `{ content?, structuredContent? }` |
| `ui/message`              | `{ role: "user", content }`        |
| `ui/open-link`            | `{ url }`                          |
| `ui/request-display-mode` | `{ mode }`                         |

Claude's transplanted route uses the same `ui/*` bridge after hydration. Test
Claude against deployed/preview URLs or a local production build served with
`agent-native start`; raw Vite dev modules can be app-auth protected and fail
dynamic imports from Claude's resource origin.

The ChatGPT controlled-frame path and any explicit `embedMode: "iframe"` /
`renderMode: "iframe"` diagnostic path use the wrapper-to-route postMessage
relay:

| Direction       | Type                                     | Payload shape                                 |
| --------------- | ---------------------------------------- | --------------------------------------------- |
| wrapper → route | `agentNative.mcpHostContext`             | `{ context, capabilities, version }`          |
| route → wrapper | `agentNative.mcpHost.updateModelContext` | `{ requestId, content?, structuredContent? }` |
| route → wrapper | `agentNative.mcpHost.openLink`           | `{ requestId, url }`                          |
| route → wrapper | `agentNative.mcpHost.requestDisplayMode` | `{ requestId, mode }`                         |
| wrapper → route | `agentNative.mcpHost.response`           | `{ requestId, ok, result?, error? }`          |

`embedApp()` includes the MCP request origin in the resource CSP so the
launcher can fetch and, when explicitly requested, frame the signed first-party
route. Pass additional `frameDomains` only for custom third-party frames.

Host-mediated open links keep the iframe from choosing its own browser target.
Model context updates are opt-in and hidden from the user-facing transcript.
`ui/message` is the portable way for an embedded app button to ask the host to
post a visible user message and continue the chat. In agent-native routes,
`sendToAgentChat()` uses `ui/update-model-context` plus `ui/message` when
called from a submitted MCP App embed, while `submit: false` remains an
in-route draft/prefill path.
Display mode requests are best-effort: a host can honor, ignore, or reject the
request. Embedded routes must remain functional in the default inline mode.

## Tools {#tools}

Stdio/static-token developer clients see all connected app actions as MCP tools. OAuth callers that request `mcp:apps` get a compact app-host catalog: app-facing builtins and actions with `mcpApp`. `publicAgent.expose` remains the opt-in for safe read/ingest tools outside that compact app catalog. This keeps ChatGPT/Claude app-host discovery small while preserving the full developer surface for local agents.

The mapping is direct:

| Action property    | MCP tool property |
| ------------------ | ----------------- |
| `tool.description` | `description`     |
| `tool.parameters`  | `inputSchema`     |
| Action name        | Tool name         |

When `mcpApp` is present, the tool entry also includes `_meta.ui.resourceUri`, `_meta["ui/resourceUri"]`, and `_meta["openai/outputTemplate"]`, and the corresponding `ui://` resource is returned as `text/html;profile=mcp-app`.

### The `ask-agent` tool {#ask-agent}

In addition to individual action tools, every MCP server includes an `ask-agent` meta-tool. This sends a natural-language message to the app's AI agent and returns the response.

Use `ask-agent` for complex tasks that benefit from the agent's reasoning and context:

```json
{
  "name": "ask-agent",
  "arguments": {
    "message": "Draft a follow-up email to the Q3 planning thread with John, summarizing the action items we discussed"
  }
}
```

The agent runs the same loop as the interactive chat — it can call multiple tools, reason about context, and produce a thoughtful response.

## Authentication {#authentication}

The MCP endpoint supports standard remote MCP OAuth plus the existing bearer-token fallback:

| Mode                        | How it works                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Standard MCP OAuth          | Client discovers auth from `WWW-Authenticate`, registers, runs PKCE, and sends `Authorization: Bearer <access-token>` |
| Connect-minted JWT          | `agent-native connect` / the Connect page mints a per-user, revocable JWT                                             |
| `ACCESS_TOKEN`              | Static bearer token — client sends `Authorization: Bearer <token>`                                                    |
| `ACCESS_TOKENS`             | Comma-separated list of valid static bearer tokens                                                                    |
| `A2A_SECRET`                | JWT-based auth — tokens are verified cryptographically                                                                |
| _(none set, loopback only)_ | No auth required for local dev probes                                                                                 |

For OAuth-capable MCP hosts, configure the remote server URL with no static headers:

```bash
claude mcp add --transport http agent-native-mail https://mail.agent-native.com/_agent-native/mcp
```

The first unauthenticated MCP request receives:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mail.agent-native.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write mcp:apps"
```

Discovery endpoints:

| Endpoint                                  | Purpose                                     |
| ----------------------------------------- | ------------------------------------------- |
| `/.well-known/oauth-protected-resource`   | RFC 9728 protected-resource metadata        |
| `/.well-known/oauth-authorization-server` | OAuth authorization server metadata         |
| `/.well-known/openid-configuration`       | OIDC-compatible metadata alias              |
| `/_agent-native/mcp/oauth/register`       | Dynamic public-client registration          |
| `/_agent-native/mcp/oauth/authorize`      | Browser authorization + consent             |
| `/_agent-native/mcp/oauth/token`          | Authorization-code and refresh-token grants |

Access tokens are signed JWTs whose audience is the exact MCP resource URL. The server accepts only tokens issued for itself and applies scopes before listing/calling tools:

| Scope       | Allows                                      |
| ----------- | ------------------------------------------- |
| `mcp:read`  | read-only actions                           |
| `mcp:write` | mutating actions and `ask-agent`            |
| `mcp:apps`  | MCP Apps resources (`ui://` HTML resources) |

Refresh tokens are stored only as hashes and are rotated on every refresh. `agent-native connect` writes this URL-only OAuth entry for Claude Code clients by default; keep the Connect page, `agent-native connect --token <token>`, and static bearer config for local stdio proxying, older clients, and emergency/debug flows.

## Custom MCP setup {#custom-setup}

The MCP server is auto-mounted by the agent-chat plugin. For most apps, no configuration is needed. If you need custom behavior, you can mount it manually in a server plugin:

```ts
// server/plugins/mcp.ts
import { mountMCP } from "@agent-native/core/mcp";
import { autoDiscoverActions } from "@agent-native/core/server";

export default defineNitroPlugin(async (nitro) => {
  const actions = await autoDiscoverActions(import.meta.url);

  mountMCP(nitro.h3App, {
    name: "My App",
    description: "Custom MCP server",
    actions,
    // Optional: provide ask-agent handler
    askAgent: async (message) => {
      // Your custom agent logic
      return "Response";
    },
  });
});
```

## Example: analytics from Claude Code {#example}

You have a deployed analytics app at `analytics.example.com`. From Claude Code:

```jsonc
// ~/.claude/mcp_servers.json
{
  "analytics": {
    "type": "http",
    "url": "https://analytics.example.com/_agent-native/mcp",
  },
}
```

Now in Claude Code:

```
> How many signups did we get last week?

Claude Code calls: run-query(sql: "SELECT count(*) FROM signups WHERE created_at > now() - interval '7 days'")
→ "1,247 signups last week"
```

For more complex analysis:

```
> Ask the analytics agent to prepare a full breakdown of Q3 signups by source, with trends

Claude Code calls: ask-agent(message: "Prepare a full breakdown of Q3 signups by source, with trends")
→ The analytics agent runs multiple queries, reasons about the data, and returns a formatted report
```
