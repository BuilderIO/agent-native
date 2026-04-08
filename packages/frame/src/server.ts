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
  getQuery,
  proxyRequest,
  setResponseHeader,
  toNodeListener,
} from "h3";
import { listen } from "listhen";
import { DEFAULT_APPS } from "@agent-native/shared-app-config";

const PORT = parseInt(process.env.FRAME_SERVER_PORT || "3335", 10);

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
    const query = getQuery(event);
    const appId = (query._app as string) || "mail";
    const app = DEFAULT_APPS.find((a) => a.id === appId);
    const targetPort = app?.devPort || 8085;
    const targetUrl = `http://localhost:${targetPort}`;
    return proxyRequest(event, `${targetUrl}${event.path}`);
  }),
);

// Proxy /_agent-native routes to the app's dev server for auth/session
router.all(
  "/_agent-native/**",
  defineEventHandler(async (event) => {
    const query = getQuery(event);
    const appId = (query._app as string) || "mail";
    const app = DEFAULT_APPS.find((a) => a.id === appId);
    const targetPort = app?.devPort || 8085;
    const targetUrl = `http://localhost:${targetPort}`;
    return proxyRequest(event, `${targetUrl}${event.path}`);
  }),
);

app.use(router);

// Start the server
listen(toNodeListener(app), { port: PORT }).then((listener) => {
  console.log(`Frame server listening on http://localhost:${PORT}`);
});
