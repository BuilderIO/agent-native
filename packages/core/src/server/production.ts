import path from "path";
import { createServer as createNodeServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  toNodeListener,
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
  sendStream,
} from "h3";
import type { App as H3App, H3Event, EventHandler as H3EventHandler } from "h3";
import { mountAuthMiddleware } from "./auth.js";

export interface ProductionServerOptions {
  /** Port to listen on. Default: process.env.PORT || 3000 */
  port?: number | string;
  /** Path to the built SPA directory. Default: inferred from import.meta or "dist/spa" */
  spaDir?: string;
  /** App name for log messages. Default: "Agent-Native" */
  appName?: string;
  /** Production agent handler — mounted at POST /api/agent-chat */
  agent?: H3EventHandler;
  /** If set, enables session-cookie auth. All routes require the cookie. */
  accessToken?: string;
}

const MIME_MAP: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

/**
 * Start a production server that:
 * 1. Serves the built SPA static files
 * 2. Falls back to index.html for client-side routing (SPA fallback)
 * 3. Returns 404 JSON for unknown API routes
 * 4. Handles graceful shutdown on SIGTERM/SIGINT
 */
export function createProductionServer(
  app: H3App,
  options: ProductionServerOptions = {},
): void {
  const port = options.port ?? process.env.PORT ?? 3000;
  const appName = options.appName ?? "Agent-Native";

  // Mount auth middleware first (if access token provided)
  if (options.accessToken) {
    mountAuthMiddleware(app, options.accessToken);
  } else if (options.agent) {
    console.warn(
      "[agent-native] WARNING: ACCESS_TOKEN is not set. " +
        "The /api/agent-chat endpoint is publicly accessible. " +
        "Set ACCESS_TOKEN to enable authentication.",
    );
  }

  // Mount agent handler at POST /api/agent-chat (if provided)
  if (options.agent) {
    app.use("/api/agent-chat", options.agent);
  }

  // Resolve SPA directory
  const spaDir = options.spaDir ?? path.resolve(process.cwd(), "dist/spa");

  // Add SPA static file serving + fallback to H3 app
  app.use(
    defineEventHandler((event: H3Event) => {
      const url = event.node.req.url ?? "/";
      const urlPath = url.split("?")[0];

      // API routes handled by mounted router — return 404 for unmatched
      if (urlPath.startsWith("/api/") || urlPath.startsWith("/health")) {
        setResponseStatus(event, 404);
        return { error: "API endpoint not found" };
      }

      // Try to serve as a static file
      const decoded = decodeURIComponent(urlPath).replace(/\.\./g, "");
      const filePath = path.join(
        spaDir,
        decoded === "/" ? "index.html" : decoded,
      );

      if (existsSync(filePath) && statSync(filePath).isFile()) {
        setResponseHeader(event, "Content-Type", getMimeType(filePath));
        return sendStream(event, createReadStream(filePath));
      }

      // SPA fallback — serve index.html for all non-API routes
      const indexPath = path.join(spaDir, "index.html");
      if (existsSync(indexPath)) {
        setResponseHeader(event, "Content-Type", "text/html");
        return sendStream(event, createReadStream(indexPath));
      }

      setResponseStatus(event, 404);
      return { error: "Not found" };
    }),
  );

  const server = createNodeServer(toNodeListener(app));

  server.listen(Number(port), () => {
    console.log(`${appName} server running on port ${port}`);
    console.log(`  Frontend: http://localhost:${port}`);
    console.log(`  API: http://localhost:${port}/api`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully`);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
