import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { IncomingMessage } from "http";
import { Buffer } from "node:buffer";

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

// Import app registry to resolve ports by app ID
const configPath = path.resolve(__dirname, "../shared-app-config/index.ts");
// Quick parse: extract { id, devPort } pairs from DEFAULT_APPS
import fs from "fs";
const configSrc = fs.readFileSync(configPath, "utf8");
const portMap = new Map<string, number>();
const re = /id:\s*"([^"]+)"[\s\S]*?devPort:\s*(\d+)/g;
let m: RegExpExecArray | null;
while ((m = re.exec(configSrc)) !== null) {
  portMap.set(m[1], Number(m[2]));
}

/**
 * Extract the app ID from an OAuth state parameter without verifying the HMAC.
 * Used for routing-only purposes — security is still enforced by the app's
 * callback handler which verifies the HMAC signature. This is the only way
 * to route OAuth callbacks from the system browser, which has neither the
 * Referer header (Google strips it) nor the frame_active_app cookie.
 */
function extractAppFromState(state: string | undefined): string | undefined {
  if (!state) return undefined;
  try {
    const dotIdx = state.lastIndexOf(".");
    if (dotIdx === -1) return undefined;
    const data = state.slice(0, dotIdx);
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString());
    return typeof parsed.app === "string" ? parsed.app : undefined;
  } catch {
    return undefined;
  }
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

export default defineConfig({
  root: ".",
  customLogger: logger,
  plugins: [react(), tailwindcss()],
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
    proxy: {
      // Proxy framework routes to the active app's dev server (dynamic by app ID)
      "/_agent-native": {
        target: "http://localhost:8085",
        changeOrigin: true,
        router: (req: IncomingMessage) => `http://localhost:${getAppPort(req)}`,
      },
      // Proxy app API routes
      "/api": {
        target: "http://localhost:8085",
        changeOrigin: true,
        router: (req: IncomingMessage) => `http://localhost:${getAppPort(req)}`,
      },
    },
  },
  build: {
    outDir: "dist/client",
  },
});
