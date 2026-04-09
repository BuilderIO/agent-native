import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { IncomingMessage } from "http";

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

/** Extract the app ID from the request's Referer or cookie */
function getAppPort(req: IncomingMessage): number {
  // Try Referer header (contains ?app=<id>)
  const referer = req.headers.referer || "";
  const refMatch = referer.match(/[?&]app=([^&]+)/);
  if (refMatch) {
    const port = portMap.get(refMatch[1]);
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
