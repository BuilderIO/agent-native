
import {
  MCP_LEGACY_ROUTE_PREFIX,
  MCP_PUBLIC_ROUTE_PREFIX,
} from "./route-paths.js";
import { resolveLocalAppOrigin } from "./workspace-resolve.js";

export interface RunMCPStdioOptions {
  appId?: string;
  port?: number;
  standalone?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  waitForAppMs?: number;
}

const MCP_SUBPATHS = [
  MCP_PUBLIC_ROUTE_PREFIX,
  MCP_LEGACY_ROUTE_PREFIX,
] as const;

function log(msg: string): void {
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
  if (env.AGENT_NATIVE_MCP_FULL_CATALOG === "1") {
    headers["X-Agent-Native-MCP-Full-Catalog"] = "1";
  }
  const token = env.ACCESS_TOKEN || env.AGENT_NATIVE_MCP_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const owner = env.AGENT_NATIVE_OWNER_EMAIL;
  if (owner) headers["X-Agent-Native-Owner-Email"] = owner;
  return headers;
}

async function probeOrigin(
  origin: string,
  subpath: string,
  timeoutMs = 800,
): Promise<boolean> {
  try {
    const res = await fetch(`${origin}${subpath}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function resolveMcpSubpath(origin: string): Promise<string | null> {
  for (const subpath of MCP_SUBPATHS) {
    if (await probeOrigin(origin, subpath)) return subpath;
  }
  return null;
}

async function runProxy(opts: RunMCPStdioOptions): Promise<void> {
  const { origin, appId } = await resolveLocalAppOrigin({
    cwd: opts.cwd,
    env: opts.env,
    appId: opts.appId,
    port: opts.port,
  });
  const env = opts.env ?? process.env;
  const deadline = Date.now() + (opts.waitForAppMs ?? 60_000);
  let mcpSubpath = await resolveMcpSubpath(origin);
  if (!mcpSubpath) {
    log(`Waiting for ${appId} at ${origin} …`);
    while (!mcpSubpath && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 750));
      mcpSubpath = await resolveMcpSubpath(origin);
    }
  }
  if (!mcpSubpath) {
    throw new Error(
      `Timed out waiting for the local app at ${origin}. Start it with ` +
        `\`agent-native dev\` (or \`agent-native workspace-dev\`), or run ` +
        `\`agent-native mcp serve --standalone\` to build the server from disk.`,
    );
  }
  const target = `${origin}${mcpSubpath}`;

  const { Client, StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/client");
  const { Server } = await import("@modelcontextprotocol/server");
  const { serveStdio } = await import("@modelcontextprotocol/server/stdio");

  const clientTransport = new StreamableHTTPClientTransport(new URL(target), {
    requestInit: { headers: authHeaders(env) },
  });
  const client = new Client(
    { name: "agent-native-mcp-proxy", version: "1.0.0" },
    {
      capabilities: {},
      versionNegotiation: { mode: "auto" },
    },
  );
  await client.connect(clientTransport);
  log(`Proxying stdio ⇄ ${target} (app: ${appId})`);

  const upstreamCapabilities = client.getServerCapabilities();
  const capabilities: NonNullable<
    ReturnType<typeof client.getServerCapabilities>
  > = { tools: {} };
  if (upstreamCapabilities?.resources) capabilities.resources = {};
  if (upstreamCapabilities?.extensions) {
    capabilities.extensions = upstreamCapabilities.extensions;
  }

  const stdio = serveStdio(
    () => {
      const server = new Server(
        { name: `agent-native-${appId}`, version: "1.0.0" },
        { capabilities },
      );

      server.setRequestHandler("tools/list", async (request: any) => {
        return client.listTools(request.params);
      });

      server.setRequestHandler("tools/call", async (request: any) => {
        return client.callTool(request.params);
      });

      if (upstreamCapabilities?.resources) {
        server.setRequestHandler("resources/list", async (request: any) => {
          return client.listResources(request.params);
        });

        server.setRequestHandler(
          "resources/templates/list",
          async (request: any) => {
            return client.listResourceTemplates(request.params);
          },
        );

        server.setRequestHandler("resources/read", async (request: any) => {
          return client.readResource(request.params);
        });
      }
      return server;
    },
    { legacy: "serve" },
  );

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    clientTransport.onclose = done;
    process.stdin.once("end", done);
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });

  try {
    await stdio.close();
    await client.close();
  } catch {
    // best-effort
  }
}

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
    origin = resolved.origin;
  } catch {
    // No workspace / can't resolve — fall back to a bare app id.
  }

  const { autoDiscoverActions } = await import("../server/action-discovery.js");
  const { createMCPServerForRequest } = await import("./build-server.js");
  const { serveStdio } = await import("@modelcontextprotocol/server/stdio");

  const actions = await autoDiscoverActions(cwd);
  log(
    `Standalone: discovered ${Object.keys(actions).length} action(s) in ${cwd}`,
  );

  const stdio = serveStdio(
    () =>
      createMCPServerForRequest(
        {
          name: appId.charAt(0).toUpperCase() + appId.slice(1),
          appId,
          description: `Agent-Native ${appId} app (standalone MCP)`,
          actions,
          // No askAgent in standalone — there is no running engine/runtime here.
          // builtin cross-app tools stay on so `list_apps` / `open_app` /
          // `create_workspace_app` / `list_templates` still work from disk.
        },
        undefined,
        {
          origin,
          transport: "stdio",
          clientName: "agent-native-mcp-standalone",
          fullCatalog: process.env.AGENT_NATIVE_MCP_FULL_CATALOG === "1",
        },
      ),
    { legacy: "serve" },
  );

  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await stdio.close();
}

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
    log(`Proxy mode failed: ${err?.message ?? err}`);
    throw err;
  }
}
