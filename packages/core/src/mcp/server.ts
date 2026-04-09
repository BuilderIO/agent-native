import * as jose from "jose";
import { getH3App } from "../server/framework-request-handler.js";
import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  getMethod,
  getRequestHeader,
} from "h3";
import type { ActionEntry } from "../agent/production-agent.js";

export interface MCPConfig {
  /** App name shown in MCP server info */
  name: string;
  /** App description */
  description: string;
  /** Version string (default "1.0.0") */
  version?: string;
  /** Action registry — same as agent chat and A2A */
  actions: Record<string, ActionEntry>;
  /** Handler for the ask-agent meta-tool — runs the full agent loop */
  askAgent?: (message: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Auth — reuses the same pattern as A2A (Bearer token or JWT)
// ---------------------------------------------------------------------------

function getAccessTokens(): string[] {
  const single = process.env.ACCESS_TOKEN;
  const multi = process.env.ACCESS_TOKENS;
  const tokens: string[] = [];
  if (single) tokens.push(single);
  if (multi) {
    tokens.push(
      ...multi
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    );
  }
  return tokens;
}

async function verifyAuth(authHeader: string | undefined): Promise<boolean> {
  // No auth configured → allow (dev mode)
  const accessTokens = getAccessTokens();
  const hasA2ASecret = !!process.env.A2A_SECRET;
  if (accessTokens.length === 0 && !hasA2ASecret) {
    return true;
  }

  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);

  // Try JWT via A2A_SECRET
  if (hasA2ASecret) {
    try {
      await jose.jwtVerify(
        token,
        new TextEncoder().encode(process.env.A2A_SECRET!),
      );
      return true;
    } catch {
      // Not a valid JWT — fall through to token check
    }
  }

  // Try ACCESS_TOKEN / ACCESS_TOKENS exact match
  if (accessTokens.length > 0) {
    return accessTokens.includes(token);
  }

  return false;
}

// ---------------------------------------------------------------------------
// MCP Server creation — converts ActionEntry registry to MCP tools
// ---------------------------------------------------------------------------

async function createMCPServerForRequest(config: MCPConfig) {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } =
    await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server(
    { name: config.name, version: config.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // tools/list — return all actions + ask-agent meta-tool
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = Object.entries(config.actions).map(([name, entry]) => ({
      name,
      description: entry.tool.description ?? name,
      inputSchema: entry.tool.parameters ?? {
        type: "object" as const,
        properties: {},
      },
    }));

    if (config.askAgent) {
      tools.push({
        name: "ask-agent",
        description:
          "Send a natural-language message to the app's AI agent and get a response. " +
          "Use this for complex, multi-step tasks that require the agent's reasoning " +
          "and full context about the app.",
        inputSchema: {
          type: "object" as const,
          properties: {
            message: {
              type: "string",
              description: "The message to send to the agent",
            },
          },
          required: ["message"],
        },
      });
    }

    return { tools };
  });

  // tools/call — dispatch to action registry or ask-agent
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    if (name === "ask-agent" && config.askAgent) {
      const message = args?.message ?? "";
      try {
        const result = await config.askAgent(message);
        return { content: [{ type: "text", text: result }] };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }

    const entry = config.actions[name];
    if (!entry) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await entry.run((args as Record<string, string>) ?? {});
      return { content: [{ type: "text", text: result }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// mountMCP — register MCP Streamable HTTP endpoint on H3/Nitro
// ---------------------------------------------------------------------------

/**
 * Mount an MCP remote server on an H3/Nitro app.
 *
 * Endpoint: `{routePrefix}/mcp` (default `/_agent-native/mcp`)
 *
 * Uses stateless Streamable HTTP transport — no in-memory sessions,
 * compatible with serverless deployments.
 *
 * Auth: Bearer token matching ACCESS_TOKEN/ACCESS_TOKENS or JWT via A2A_SECRET.
 * No auth required when neither is configured (dev mode).
 */
export function mountMCP(
  nitroApp: any,
  config: MCPConfig,
  routePrefix = "/_agent-native",
): void {
  getH3App(nitroApp).use(
    `${routePrefix}/mcp`,
    defineEventHandler(async (event) => {
      const method = getMethod(event);

      // Auth check
      const authHeader = getRequestHeader(event, "authorization");
      const authed = await verifyAuth(authHeader);
      if (!authed) {
        setResponseStatus(event, 401);
        return { error: "Unauthorized" };
      }

      // Stateless mode: only POST is meaningful
      if (method === "DELETE") {
        setResponseStatus(event, 204);
        return "";
      }

      if (method === "GET") {
        // SSE stream endpoint — not used in stateless mode but the SDK
        // handles it gracefully. Let it through for protocol compliance.
      }

      if (method !== "POST" && method !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      // Read body for POST (GET has no body)
      const body = method === "POST" ? await readBody(event) : undefined;

      // Create per-request stateless transport + server
      const { StreamableHTTPServerTransport } =
        await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      const server = await createMCPServerForRequest(config);
      await server.connect(transport);

      // Delegate to the transport — it writes directly to the Node response
      await transport.handleRequest(event.node.req, event.node.res, body);

      // Prevent H3 from double-writing the response
      (event as any)._handled = true;
    }),
  );

  console.log(
    `[mcp] Mounted MCP server at ${routePrefix}/mcp (${Object.keys(config.actions).length} tools${config.askAgent ? " + ask-agent" : ""})`,
  );
}
