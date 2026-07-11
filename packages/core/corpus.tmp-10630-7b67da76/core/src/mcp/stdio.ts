/**
 * MCP **stdio** transport for the `agent-native mcp serve` command.
 *
 * This is the binary external coding agents (Claude Code, Claude Cowork,
 * Codex) actually launch — they speak MCP over a child process's stdio, not
 * HTTP. We expose the agent-native app's MCP surface over stdio in two modes:
 *
 *   - **proxy (default)** — connect an MCP `Client` over
 *     `StreamableHTTPClientTransport` to the *already-running* local app's
 *     `http://127.0.0.1:<port>/_agent-native/mcp`, and run a stdio `Server`
 *     that forwards tools and optional MCP App resources to it. The live app
 *     is the single source of truth: HMR'd actions, the real registry, correct
 *     per-request deep links, and tenant scoping all come for free. If the
 *     app isn't running, we wait briefly for it (the workspace gateway boots
 *     it lazily on first request).
 *
 *   - **standalone (`--standalone`)** — no running server, no HMR. Build the
 *     MCP server in-process from `autoDiscoverActions(cwd)` +
 *     `createMCPServerForRequest`, connected straight to a
 *     `StdioServerTransport`. Useful in CI / when nothing is serving.
 *
 * Node-only: imports `node:*` and the SDK stdio/http transports. Never part
 * of the serverless bundle.
 */

import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";

import { resolveLocalAppOrigin } from "./workspace-resolve.js";

export interface RunMCPStdioOptions {
  /** App id to bridge to (workspace). Optional in a single-app project. */
  appId?: string;
  /** Explicit port of the running app's dev server. Overrides discovery. */
  port?: number;
  /** Skip the HTTP proxy and build the server in-process from disk. */
  standalone?: boolean;
  /** Working directory (defaults to process.cwd()). */
  cwd?: string;
  /** Env (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Max ms to wait for the running app before failing (proxy mode). */
  waitForAppMs?: number;
}

const MCP_SUBPATH = "/_agent-native/mcp";

function log(msg: string): void {
  // stderr only — stdout is the MCP protocol channel and must stay clean.
  process.stderr.write(`[mcp] ${msg}\n`);
}

/**
 * Owner identity the installer wrote into the client config's env. Passed
 * through to the HTTP MCP endpoint as a JWT/identity bearer (when present)
 * so tool runs stay tenant-scoped. For local dev with a static ACCESS_TOKEN
 * the email is informational; for hosted JWT auth the token already carries
 * `sub`, so we only add an `X-Agent-Native-Owner-Email` hint header.
 */
function authHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Agent-Native-MCP-Client": "agent-native-mcp-proxy",
  };
  // Default to the compact/connector catalog + tool-search like every other
  // client. The local CLI no longer auto-pulls the full ~105-tool catalog;
  // opt in explicitly with AGENT_NATIVE_MCP_FULL_CATALOG=1 when you really want
  // every tool schema loaded up front.
  if (env.AGENT_NATIVE_MCP_FULL_CATALOG === "1") {
    headers["X-Agent-Native-MCP-Full-Catalog"] = "1";
  }
  const token = env.ACCESS_TOKEN || env.AGENT_NATIVE_MCP_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const owner = env.AGENT_NATIVE_OWNER_EMAIL;
  if (owner) headers["X-Agent-Native-Owner-Email"] = owner;
  return headers;
}

async function probeOrigin(origin: string, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetch(`${origin}${MCP_SUBPATH}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Any HTTP response (even 401/405/406) means the server is up.
    return res.status > 0;
  } catch {
    return false;
  }
}

/**
 * Proxy mode: stdio Server ⇄ HTTP Client to the running app.
 *
 * We register the standard handlers on the stdio server and forward them
 * verbatim to the upstream HTTP MCP server via the SDK `Client`. The upstream
 * owns tool definitions, results, MCP App resources, and the appended
 * deep-link block / `_meta`, so nothing is duplicated here.
 */
async function runProxy(opts: RunMCPStdioOptions): Promise<void> {
  const { origin, appId } = await resolveLocalAppOrigin({
    cwd: opts.cwd,
    env: opts.env,
    appId: opts.appId,
    port: opts.port,
  });
  const env = opts.env ?? process.env;
  const target = `${origin}${MCP_SUBPATH}`;

  // Wait for the app to come up. The workspace gateway lazily boots an app's
  // dev server on first request, so a fresh `mcp serve` may briefly race the
  // boot. Hit the gateway path too so the lazy start is triggered.
  const deadline = Date.now() + (opts.waitForAppMs ?? 60_000);
  let up = await probeOrigin(origin);
  if (!up) {
    log(`Waiting for ${appId} at ${origin} …`);
    while (!up && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 750));
      up = await probeOrigin(origin);
    }
  }
  if (!up) {
    throw new Error(
      `Timed out waiting for the local app at ${origin}. Start it with ` +
        `\`agent-native dev\` (or \`agent-native workspace-dev\`), or run ` +
        `\`agent-native mcp serve --standalone\` to build the server from disk.`,
    );
  }

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } =
    await import("@modelcontextprotocol/sdk/server/stdio.js");
  const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListResourceTemplatesRequestSchema,
  } = await import("@modelcontextprotocol/sdk/types.js");

  // --- Upstream HTTP client -------------------------------------------------
  const clientTransport = new StreamableHTTPClientTransport(new URL(target), {
    requestInit: { headers: authHeaders(env) },
  });
  const client = new Client(
    { name: "agent-native-mcp-proxy", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);
  log(`Proxying stdio ⇄ ${target} (app: ${appId})`);

  // --- Downstream stdio server ---------------------------------------------
  const upstreamCapabilities = client.getServerCapabilities();
  const capabilities: ServerCapabilities = { tools: {} };
  if (upstreamCapabilities?.resources) capabilities.resources = {};
  if (upstreamCapabilities?.extensions) {
    capabilities.extensions = upstreamCapabilities.extensions;
  }

  const server = new Server(
    { name: `agent-native-${appId}`, version: "1.0.0" },
    { capabilities },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request: any) => {
    return client.listTools(request.params);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    // Forward the call verbatim; the upstream appends the deep-link block.
    return client.callTool(request.params);
  });

  if (upstreamCapabilities?.resources) {
    server.setRequestHandler(
      ListResourcesRequestSchema,
      async (request: any) => {
        return client.listResources(request.params);
      },
    );

    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (request: any) => {
        return client.listResourceTemplates(request.params);
      },
    );

    server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: any) => {
        return client.readResource(request.params);
      },
    );
  }

  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  // Keep the proxy alive until the client/transport closes.
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    stdioTransport.onclose = done;
    clientTransport.onclose = done;
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });

  try {
    await client.close();
  } catch {
    // best-effort
  }
}

/**
 * Standalone mode: build the MCP server in-process from disk.
 *
 * No running server, no HMR — actions are discovered via
 * `autoDiscoverActions(cwd)` and the shared `createMCPServerForRequest`
 * builder is reused so behavior (tools, deep links, builtin cross-app tools)
 * matches the HTTP mount exactly.
 */
async function runStandalone(opts: RunMCPStdioOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;

  const { resolveLocalAppOrigin } = await import("./workspace-resolve.js");
  let appId = opts.appId ?? "app";
  let origin: string | undefined;
  try {
    const resolved = await resolveLocalAppOrigin({
      cwd,
      env,
      appId: opts.appId,
      port: opts.port,
    });
    appId = resolved.appId;
    // Origin is best-effort here (server may not be running) — still useful
    // so a `link` builder's relative deep link becomes an absolute URL.
    origin = resolved.origin;
  } catch {
    // No workspace / can't resolve — fall back to a bare app id.
  }

  const { autoDiscoverActions } = await import("../server/action-discovery.js");
  const { createMCPServerForRequest } = await import("./build-server.js");
  const { StdioServerTransport } =
    await import("@modelcontextprotocol/sdk/server/stdio.js");

  const actions = await autoDiscoverActions(cwd);
  log(
    `Standalone: discovered ${Object.keys(actions).length} action(s) in ${cwd}`,
  );

  const server = await createMCPServerForRequest(
    {
      name: appId.charAt(0).toUpperCase() + appId.slice(1),
      appId,
      description: `Agent-native ${appId} app (standalone MCP)`,
      actions,
      // No askAgent in standalone — there is no running engine/runtime here.
      // builtin cross-app tools stay on so `list_apps` / `open_app` /
      // `create_workspace_app` / `list_templates` still work from disk.
    },
    // No verified identity in standalone (no inbound auth header). Runs with
    // platform-default scope, same as a tokenless local HTTP mount.
    undefined,
    {
      origin,
      clientName: "agent-native-mcp-standalone",
      // Compact by default; opt into the full catalog with the env flag.
      fullCatalog: process.env.AGENT_NATIVE_MCP_FULL_CATALOG === "1",
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    transport.onclose = done;
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

/**
 * Entry point for `agent-native mcp serve`. Defaults to proxy mode; pass
 * `standalone: true` to build the server from disk with no running app.
 */
export async function runMCPStdio(
  opts: RunMCPStdioOptions = {},
): Promise<void> {
  if (opts.standalone) {
    await runStandalone(opts);
    return;
  }
  try {
    await runProxy(opts);
  } catch (err: any) {
    // Proxy couldn't reach a running app — surface a clear, actionable
    // message on stderr. We do NOT silently fall back to standalone: the
    // caller asked for the live registry; auto-falling-back would hide a
    // broken dev server and serve stale tools.
    log(`Proxy mode failed: ${err?.message ?? err}`);
    throw err;
  }
}
