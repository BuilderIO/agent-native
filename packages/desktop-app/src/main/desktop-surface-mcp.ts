import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const DESKTOP_SURFACE_MCP_PATH = "/mcp";

export interface DesktopSurfaceApp {
  id: string;
  name: string;
}

export interface DesktopSurfaceOpenAppRequest {
  app: string;
  path?: string;
  view?: string;
}

export interface DesktopSurfaceActiveAppContext {
  appId: string;
  appName: string;
  path?: string;
  view?: string;
}

export interface DesktopSurfaceMcpBridgeOptions {
  listApps: () => readonly DesktopSurfaceApp[];
  openApp: (request: DesktopSurfaceOpenAppRequest) => void;
  getActiveAppContext?: () => DesktopSurfaceActiveAppContext | null;
}

export interface DesktopSurfaceMcpRegistration {
  url: string;
  bearerToken: string;
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function readBearerToken(value: string | undefined): string | undefined {
  return /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(value ?? "")?.[1];
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function isSafeAppPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  return (
    URL.canParse(value, "http://desktop-app.invalid") &&
    new URL(value, "http://desktop-app.invalid").origin ===
      "http://desktop-app.invalid"
  );
}

export class DesktopSurfaceMcpBridge {
  private readonly tokenHashes = new Set<string>();
  private readonly mcpHandler = createMcpHandler(
    () => {
      const mcp = new McpServer({
        name: "agent-native-desktop",
        version: "1.0.0",
      });
      this.registerTools(mcp);
      return mcp;
    },
    {
      legacy: "stateless",
      responseMode: "json",
      onerror: (error) => {
        console.warn("[desktop-surface] MCP request failed:", error.message);
      },
    },
  );
  private readonly handleMcpNodeRequest = toNodeHandler(this.mcpHandler, {
    onerror: (error) => {
      console.warn("[desktop-surface] MCP adapter failed:", error.message);
    },
  });
  private httpServer?: HttpServer;
  private url?: string;

  constructor(private readonly options: DesktopSurfaceMcpBridgeOptions) {}

  async start(): Promise<string> {
    if (this.url) return this.url;
    const httpServer = createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      httpServer.close();
      throw new Error("Desktop surface MCP did not receive a TCP address.");
    }
    this.httpServer = httpServer;
    this.url = `http://127.0.0.1:${address.port}${DESKTOP_SURFACE_MCP_PATH}`;
    return this.url;
  }

  register(): DesktopSurfaceMcpRegistration {
    if (!this.url) throw new Error("Desktop surface MCP bridge is not ready.");
    const bearerToken = randomBytes(32).toString("base64url");
    this.tokenHashes.add(hashToken(bearerToken));
    return { url: this.url, bearerToken };
  }

  async close(): Promise<void> {
    this.tokenHashes.clear();
    await this.mcpHandler.close();
    const server = this.httpServer;
    this.httpServer = undefined;
    this.url = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private async handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (
      request.url !== DESKTOP_SURFACE_MCP_PATH ||
      !isLoopbackAddress(request.socket.remoteAddress)
    ) {
      response.writeHead(404).end();
      return;
    }
    const token = readBearerToken(request.headers.authorization);
    if (!token || !this.tokenHashes.has(hashToken(token))) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    try {
      await this.handleMcpNodeRequest(request, response);
    } catch (error) {
      console.warn(
        "[desktop-surface] MCP request failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  }

  private registerTools(mcp: McpServer): void {
    mcp.registerTool(
      "list_apps",
      {
        description:
          "List workspace apps that can be opened in the desktop sidebar.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => textResult({ apps: this.options.listApps() }),
    );
    mcp.registerTool(
      "get_active_app_context",
      {
        description:
          "Return the workspace app currently selected in the desktop shell. Use this before app work so the terminal agent follows the same app context as the desktop UI.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const activeApp = this.options.getActiveAppContext?.() ?? null;
        return textResult({
          activeApp: activeApp
            ? {
                ...activeApp,
                mcpServer: `desktop_app_${activeApp.appId.replace(/[^A-Za-z0-9_]/g, "_")}`,
              }
            : null,
          instructions: activeApp
            ? `The active workspace app is ${activeApp.appName}. Use its configured MCP tools for app operations and keep navigation in this app${activeApp.path ? ` at ${activeApp.path}` : ""}.`
            : "No workspace app is currently selected. Ask the user which app to use before making app-specific changes.",
        });
      },
    );
    mcp.registerTool(
      "open_app",
      {
        description:
          "Open a workspace app in the Agent-Native desktop sidebar. Use the app id from list_apps. This changes the desktop UI and returns after the app tab is requested.",
        inputSchema: {
          app: z.string().trim().min(1).max(80),
          path: z
            .string()
            .trim()
            .min(1)
            .max(2_000)
            .refine(isSafeAppPath, "path must be a same-origin app path")
            .optional(),
          view: z.string().trim().min(1).max(200).optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ app, path, view }) => {
        const target = this.options
          .listApps()
          .find((candidate) => candidate.id === app);
        if (!target) throw new Error(`Desktop app "${app}" is not available.`);
        this.options.openApp({
          app: target.id,
          ...(path ? { path } : {}),
          ...(view ? { view } : {}),
        });
        return textResult({
          opened: true,
          app: target.id,
          ...(path ? { path } : {}),
          ...(view ? { view } : {}),
        });
      },
    );
  }
}
