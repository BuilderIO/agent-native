---
title: "MCP Clients"
description: "Connect your agent-native app to local MCP servers (claude-in-chrome, filesystem, playwright, etc) so the agent gains their tools."
---

# MCP Clients

Agent-native apps can also act as MCP **clients** — connecting to locally installed MCP servers and exposing their tools to the agent chat. This is the symmetric counterpart to the [MCP Protocol](./mcp-protocol.md) (which makes your app an MCP server).

With one config file, every agent-native app in your workspace gains access to tools provided by MCP servers on your machine: `claude-in-chrome` for browser automation, `@modelcontextprotocol/server-filesystem` for reading files, `@modelcontextprotocol/server-playwright` for browser testing, and anything else that speaks MCP.

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
      "args": ["-y", "@modelcontextprotocol/server-playwright"],
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

The tools are registered in the agent's tool registry with the prefix `mcp__<server-id>__<tool-name>` so they can't collide with your template's actions.

## Config precedence {#precedence}

MCP configuration is resolved in this order, first match wins:

1. **Workspace root `mcp.config.json`** — detected via `agent-native.workspaceCore` in `package.json`. Shared across every app in the workspace.
2. **App-root `mcp.config.json`** — per-app override if you don't want an MCP server available in every app.
3. **`MCP_SERVERS` env var** — JSON string with the same shape, for CI/production where a file doesn't make sense.

## Production deploys: `MCP_SERVERS` {#mcp-servers-env}

For production deploys set the full config shape (or the inner server map) as an environment variable:

```bash
MCP_SERVERS='{"servers":{"playwright":{"command":"npx","args":["-y","@modelcontextprotocol/server-playwright"]}}}'
```

MCP tools only activate in Node runtimes — Cloudflare Workers and other edge targets silently skip MCP and continue with the rest of the app working normally.

## Auto-detect: `claude-in-chrome` {#autodetect}

If you have **no** `mcp.config.json` and the `claude-in-chrome-mcp` binary is on `PATH` (or in the well-known install location `~/.claude-in-chrome/bin/claude-in-chrome-mcp`), agent-native auto-registers it as a default MCP server. Set `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1` to opt out.

This means users who've installed the claude-in-chrome extension get browser control across every agent-native app they open with no config changes.

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
