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

import { getTemplate } from "@agent-native/shared-app-config";
import {
  createApp,
  createRouter,
  defineEventHandler,
  getCookie,
  getHeader,
  getQuery,
  proxyRequest,
  setResponseHeader,
  toNodeListener,
  type H3Event,
} from "h3";
import { listen } from "listhen";

import { extractAppFromState } from "./oauth-state.js";

const PORT = parseInt(process.env.FRAME_SERVER_PORT || "3335", 10);

function templateGatewayUrl(): string | null {
  const value =
    process.env.VITE_AGENT_NATIVE_TEMPLATE_GATEWAY_URL ||
    process.env.AGENT_NATIVE_TEMPLATE_GATEWAY_URL ||
    process.env.VITE_WORKSPACE_GATEWAY_URL ||
    process.env.WORKSPACE_GATEWAY_URL ||
    null;
  if (!value) return null;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Resolve which app backend this request should proxy to. Checked in order:
 * 1. Explicit `_app` query param.
 * 2. OAuth `state` param (system-browser callbacks have no cookie/Referer).
 * 3. Referer header — the frame page URL includes `?app=<id>`, so in-page
 *    fetches carry it. This is the dev-mode Vite plugin's primary signal
 *    and is kept here for parity so production frame routing doesn't silently
 *    diverge from dev.
 * 4. `frame_active_app` cookie — set synchronously by the Frame client on
 *    first render.
 * 5. Fallback to "mail".
 */
function resolveAppId(event: H3Event): string {
  const query = getQuery(event);
  if (typeof query._app === "string" && query._app) return query._app;
  const fromState = extractAppFromState(query.state as string | undefined);
  if (fromState) return fromState;
  const referer = getHeader(event, "referer");
  if (referer) {
    const m = referer.match(/[?&]app=([^&]+)/);
    if (m && getTemplate(m[1])) return m[1];
  }
  const cookie = getCookie(event, "frame_active_app");
  if (cookie) return cookie;
  return "mail";
}

function normalizeCustomDevUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function customDevUrlFromFrameUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeCustomDevUrl(new URL(value).searchParams.get("devUrl"));
  } catch {
    return null;
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveCustomDevUrl(event: H3Event): string | null {
  const query = getQuery(event);
  const explicit = normalizeCustomDevUrl(query._devUrl);
  if (explicit) return explicit;

  const referer = getHeader(event, "referer");
  const fromReferer = customDevUrlFromFrameUrl(referer);
  if (fromReferer) return fromReferer;

  const cookie = getCookie(event, "frame_active_dev_url");
  return normalizeCustomDevUrl(cookie ? safeDecodeURIComponent(cookie) : null);
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
    const app = getTemplate(appId);
    const customDevUrl = normalizeCustomDevUrl(query.devUrl);
    const gatewayUrl = templateGatewayUrl();
    const devUrl =
      customDevUrl ??
      (gatewayUrl && app?.devPort
        ? new URL(`/${appId}`, `${gatewayUrl}/`).toString().replace(/\/$/, "")
        : app?.devPort
          ? `http://localhost:${app.devPort}`
          : null);
    return {
      id: appId,
      name: app?.label || appId,
      devPort: app?.devPort,
      devUrl,
    };
  }),
);

// OAuth proxy — forward Google auth routes to the active app's dev server
// This ensures OAuth callbacks (which hit the frame origin) reach the app
router.all(
  "/api/google/**",
  defineEventHandler(async (event) => {
    const appId = resolveAppId(event);
    const customDevUrl = resolveCustomDevUrl(event);
    if (customDevUrl) {
      return proxyRequest(event, `${customDevUrl}${event.path}`);
    }
    const gatewayUrl = templateGatewayUrl();
    if (gatewayUrl) {
      return proxyRequest(event, `${gatewayUrl}/${appId}${event.path}`);
    }
    const app = getTemplate(appId);
    const targetPort = app?.devPort || 8085;
    return proxyRequest(event, `http://localhost:${targetPort}${event.path}`);
  }),
);

// Proxy /_agent-native routes to the active app's dev server. See
// resolveAppId() for the signal priority.
router.all(
  "/_agent-native/**",
  defineEventHandler(async (event) => {
    const appId = resolveAppId(event);
    const customDevUrl = resolveCustomDevUrl(event);
    if (customDevUrl) {
      return proxyRequest(event, `${customDevUrl}${event.path}`);
    }
    const gatewayUrl = templateGatewayUrl();
    if (gatewayUrl) {
      return proxyRequest(event, `${gatewayUrl}/${appId}${event.path}`);
    }
    const app = getTemplate(appId);
    const targetPort = app?.devPort || 8085;
    return proxyRequest(event, `http://localhost:${targetPort}${event.path}`);
  }),
);

app.use(router);

// Start the server
listen(toNodeListener(app), { port: PORT }).then(() => {
  console.log(`Frame server listening on http://localhost:${PORT}`);
});
