import { defineConfig, createLogger } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import http from "http";
import { extractAppFromState } from "./src/oauth-state.js";

// Custom logger that suppresses proxy ECONNREFUSED noise during startup.
// When dev:all starts, template backends aren't ready yet — the frame polls
// and gets ECONNREFUSED until they come up. These are harmless (the frontend
// retries), but flood the terminal with hundreds of identical lines.
const logger = createLogger();
const _loggerError = logger.error.bind(logger);
logger.error = (msg, opts) => {
  if (
    opts?.error?.code === "ECONNREFUSED" ||
    (typeof msg === "string" && msg.includes("ECONNREFUSED"))
  )
    return;
  _loggerError(msg, opts);
};

// Import app registry to resolve ports by app ID. DEFAULT_APPS is built from
// the TEMPLATES array in templates.ts, so we parse that file directly —
// index.ts only has `id: t.name` dynamically, not literal ids.
const templatesPath = path.resolve(
  __dirname,
  "../shared-app-config/templates.ts",
);
import fs from "fs";
const templatesSrc = fs.readFileSync(templatesPath, "utf8");
const portMap = new Map<string, number>();
const re = /name:\s*"([^"]+)"[\s\S]*?devPort:\s*(\d+)/g;
let m: RegExpExecArray | null;
while ((m = re.exec(templatesSrc)) !== null) {
  portMap.set(m[1], Number(m[2]));
}

/** Extract the app ID from the request (Referer, state param, or cookie) */
function getAppPort(req: IncomingMessage): number {
  const url = req.url || "";
  const queryStart = url.indexOf("?");
  const queryStr = queryStart >= 0 ? url.slice(queryStart + 1) : "";
  const params = new URLSearchParams(queryStr);

  // 1. Explicit _app query param
  const explicitApp = params.get("_app");
  if (explicitApp) {
    const port = portMap.get(explicitApp);
    if (port) return port;
  }

  // 2. OAuth state param (needed for system-browser callbacks — no Referer, no cookie)
  const stateApp = extractAppFromState(params.get("state") || undefined);
  if (stateApp) {
    const port = portMap.get(stateApp);
    if (port) return port;
  }

  // 3. Referer header (contains ?app=<id>) — used during normal in-webview calls
  const referer = req.headers.referer || "";
  const refMatch = referer.match(/[?&]app=([^&]+)/);
  if (refMatch) {
    const port = portMap.get(refMatch[1]);
    if (port) return port;
  }

  // 4. frame_active_app cookie — fallback for in-webview requests without Referer
  const cookie = req.headers.cookie || "";
  const cookieMatch = cookie.match(/(?:^|;\s*)frame_active_app=([^;]+)/);
  if (cookieMatch) {
    const port = portMap.get(cookieMatch[1]);
    if (port) return port;
  }

  // Default to mail
  return 8085;
}

/**
 * Custom proxy middleware — Vite 8's built-in proxy uses http-proxy-3, which
 * silently ignores the `router` option. We need per-request target resolution
 * (for OAuth callbacks and multi-app routing), so we implement forwarding
 * manually using node's http module.
 */
function framePlugin(): Plugin {
  const PROXY_PREFIXES = ["/_agent-native", "/api/"];

  function forward(
    req: IncomingMessage,
    res: ServerResponse,
    port: number,
    next: (err?: unknown) => void,
  ) {
    const headers = { ...req.headers };
    // Preserve the frame's host so apps generate redirect_uris pointing at 3334
    // rather than their own dev port. Without this, OAuth redirect_uris break.
    headers["x-forwarded-host"] = req.headers.host || `localhost:3334`;
    headers["x-forwarded-proto"] = "http";
    headers.host = `localhost:${port}`;

    const proxyReq = http.request(
      {
        host: "localhost",
        port,
        method: req.method,
        path: req.url,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        // App server isn't up yet — return 503 without flooding logs
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end(`App server on port ${port} is not running`);
        return;
      }
      next(err);
    });

    req.pipe(proxyReq);
  }

  return {
    name: "frame-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        const shouldProxy = PROXY_PREFIXES.some((p) => url.startsWith(p));
        if (!shouldProxy) return next();
        const port = getAppPort(req);
        forward(req, res, port, next);
      });
    },
  };
}

export default defineConfig({
  root: ".",
  customLogger: logger,
  plugins: [framePlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared/app-registry": path.resolve(
        __dirname,
        "../shared-app-config/index.ts",
      ),
    },
  },
  server: {
    port: 3334,
    strictPort: true,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist/client",
  },
});
