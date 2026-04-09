/**
 * Local Dev Frame — Server
 *
 * H3-based server that provides:
 * - OAuth callback proxy to the active app's dev port
 * - App info API
 * - WebSocket PTY server proxy (delegates to core's pty-server)
 *
 * The Vite dev server proxies /ws and /api to this server.
 * In production, this serves the built client and handles everything.
 */

import {
  createApp,
  createRouter,
  defineEventHandler,
  getCookie,
  getQuery,
  proxyRequest,
  setResponseHeader,
  toNodeListener,
} from "h3";
import { Buffer } from "node:buffer";
import { listen } from "listhen";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";

const PORT = parseInt(process.env.FRAME_SERVER_PORT || "3335", 10);

/**
 * Extract the app ID from an OAuth state parameter without verifying the HMAC.
 * Used for routing-only purposes — security is still enforced by the app's
 * callback handler which verifies the HMAC signature.
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

const app = createApp();
const router = createRouter();

// CORS — allow all origins in dev
app.use(
  defineEventHandler((event) => {
    setResponseHeader(event, "Access-Control-Allow-Origin", "*");
    setResponseHeader(
      event,
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    setResponseHeader(
      event,
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With",
    );
    if (event.method === "OPTIONS") {
      return "";
    }
  }),
);

// App info endpoint
router.get(
  "/api/app-info",
  defineEventHandler((event) => {
    const query = getQuery(event);
    const appId = (query.app as string) || "mail";
    const app = DEFAULT_APPS.find((a) => a.id === appId);
    return {
      id: appId,
      name: app?.name || appId,
      devPort: app?.devPort,
      devUrl:
        app?.devUrl ||
        (app?.devPort ? `http://localhost:${app.devPort}` : null),
    };
  }),
);

// OAuth proxy — forward Google auth routes to the active app's dev server
// This ensures OAuth callbacks (which hit the frame origin) reach the app
router.all(
  "/api/google/**",
  defineEventHandler(async (event) => {
    const appId =
      (getQuery(event)._app as string) ||
      getCookie(event, "frame_active_app") ||
      "mail";
    const app = DEFAULT_APPS.find((a) => a.id === appId);
    const targetPort = app?.devPort || 8085;
    return proxyRequest(event, `http://localhost:${targetPort}${event.path}`);
  }),
);

// Proxy /_agent-native routes to the active app's dev server.
// App is resolved from ?_app= query param, then OAuth state (for callbacks
// from the system browser that lack the frame_active_app cookie), then the
// frame_active_app cookie, then "mail" as default.
router.all(
  "/_agent-native/**",
  defineEventHandler(async (event) => {
    const query = getQuery(event);
    const appId =
      (query._app as string) ||
      extractAppFromState(query.state as string | undefined) ||
      getCookie(event, "frame_active_app") ||
      "mail";
    const app = DEFAULT_APPS.find((a) => a.id === appId);
    const targetPort = app?.devPort || 8085;
    return proxyRequest(event, `http://localhost:${targetPort}${event.path}`);
  }),
);

app.use(router);

// Start the server
listen(toNodeListener(app), { port: PORT }).then(() => {
  console.log(`Frame server listening on http://localhost:${PORT}`);
});
