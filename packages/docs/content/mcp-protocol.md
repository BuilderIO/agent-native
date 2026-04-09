---
title: "MCP Protocol"
description: "Expose your agent-native app as a remote MCP server so Claude Code, Cursor, and other AI tools can call your app's actions directly."
---

# MCP Protocol

Every agent-native app automatically exposes a remote MCP (Model Context Protocol) server. This lets external AI tools like Claude Code, Cursor, and Windsurf discover and call your app's actions directly — no extra code needed.

## Overview {#overview}

MCP is the standard protocol for connecting AI tools to external capabilities. When you deploy an agent-native app, it auto-mounts an MCP endpoint alongside the existing A2A endpoint. Any MCP-compatible client can connect and use your app's tools.

Key concepts:

- **Auto-mounted** — every app gets `/_agent-native/mcp` for free, no setup required
- **Streamable HTTP** — uses the modern MCP transport over standard HTTP (POST + SSE)
- **Same actions** — the exact same action registry that powers agent chat and A2A
- **`ask-agent` tool** — a meta-tool that delegates to the full agent loop for complex tasks
- **Bearer auth** — uses `ACCESS_TOKEN` or `A2A_SECRET` for authentication

## MCP vs A2A {#mcp-vs-a2a}

Both protocols are auto-mounted. Use whichever fits your use case:

|                    | MCP                                   | A2A                                          |
| ------------------ | ------------------------------------- | -------------------------------------------- |
| **Best for**       | External tools calling your app       | Agent-to-agent communication                 |
| **Protocol**       | MCP Streamable HTTP                   | JSON-RPC 2.0                                 |
| **Tool discovery** | `tools/list`                          | Agent card at `/.well-known/agent-card.json` |
| **Endpoint**       | `/_agent-native/mcp`                  | `/_agent-native/a2a`                         |
| **Supported by**   | Claude Code, Cursor, Windsurf, Cowork | Other agent-native apps                      |
| **Execution**      | Direct tool calls (no extra LLM)      | Full agent loop (LLM reasoning)              |

You can also use the `ask-agent` MCP tool to get the best of both worlds — call it from Claude Code and let your app's agent reason through complex tasks.

## Connecting from Claude Code {#claude-code}

Add your app as a remote MCP server in Claude Code's config:

```jsonc
// ~/.claude/mcp_servers.json
{
  "mail": {
    "type": "url",
    "url": "https://mail.example.com/_agent-native/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    },
  },
}
```

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

## Tools {#tools}

All actions registered in your app are exposed as MCP tools. The mapping is direct:

| Action property    | MCP tool property |
| ------------------ | ----------------- |
| `tool.description` | `description`     |
| `tool.parameters`  | `inputSchema`     |
| Action name        | Tool name         |

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

The MCP endpoint uses the same auth as the rest of the app:

| Env var         | How it works                                                |
| --------------- | ----------------------------------------------------------- |
| `ACCESS_TOKEN`  | Bearer token — client sends `Authorization: Bearer <token>` |
| `ACCESS_TOKENS` | Comma-separated list of valid tokens                        |
| `A2A_SECRET`    | JWT-based auth — tokens are verified cryptographically      |
| _(none set)_    | No auth required (dev mode)                                 |

In production, set `ACCESS_TOKEN` or `A2A_SECRET` to secure the endpoint. In development (no auth env vars configured), all requests are allowed.

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
    "type": "url",
    "url": "https://analytics.example.com/_agent-native/mcp",
    "headers": { "Authorization": "Bearer sk-analytics-token" },
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
