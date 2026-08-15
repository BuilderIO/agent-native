import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  getDesktopTemplateGatewayAppUrl,
  isDefaultDesktopTemplateDevTarget,
  type AppConfig,
} from "@shared/app-registry";
import { IPC } from "@shared/ipc-channels";
import { ipcMain, net, session, type IpcMainInvokeEvent } from "electron";

import * as AppStore from "../app-store";

const RELAY_ROOT = "/desktop-chat";
const RELAY_ALLOWED_PREFIX = "/_agent-native/";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

interface RelayState {
  port: number;
  secret: string;
}

interface RelayPath {
  appId: string;
  targetPath: string;
}

let relayPromise: Promise<RelayState> | null = null;
let ipcRegistered = false;

function desktopTemplateGatewayOverridesDevUrls(): boolean {
  const value =
    process.env["AGENT_NATIVE_USE_TEMPLATE_GATEWAY"] ||
    process.env["VITE_AGENT_NATIVE_USE_TEMPLATE_GATEWAY"];
  return value === "1" || value === "true";
}

function resolveDesktopTemplateGatewayUrl(appConfig: AppConfig): string | null {
  if (
    !desktopTemplateGatewayOverridesDevUrls() &&
    !isDefaultDesktopTemplateDevTarget(appConfig)
  ) {
    return null;
  }
  return getDesktopTemplateGatewayAppUrl(appConfig.id);
}

function resolveAppBaseUrl(appConfig: AppConfig): string | null {
  const isProdMode = appConfig.mode !== "dev";
  if (isProdMode && appConfig.url) return appConfig.url;
  if (!isProdMode) {
    return (
      resolveDesktopTemplateGatewayUrl(appConfig) ||
      appConfig.devUrl ||
      (appConfig.devPort ? `http://localhost:${appConfig.devPort}` : null) ||
      appConfig.url ||
      null
    );
  }
  return (
    appConfig.url ||
    appConfig.devUrl ||
    (appConfig.devPort ? `http://localhost:${appConfig.devPort}` : null) ||
    null
  );
}

function parseRelayPath(pathname: string, secret: string): RelayPath | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[0] !== RELAY_ROOT.slice(1)) return null;
  if (parts[1] !== secret) return null;

  let appId: string;
  try {
    appId = decodeURIComponent(parts[2]).trim();
  } catch {
    // coercion-ok: malformed percent-encoding cannot produce a relay target.
    return null;
  }
  if (!appId) return null;

  const targetPath = `/${parts.slice(3).join("/")}`;
  if (!targetPath.startsWith(RELAY_ALLOWED_PREFIX)) return null;
  return { appId, targetPath };
}

export function resolveTargetUrl(
  baseUrl: string,
  targetPath: string,
): URL | null {
  try {
    const target = new URL(targetPath, "http://desktop-chat.invalid");
    // Check the normalized URL, not the raw path. Otherwise
    // /_agent-native/../ can pass the prefix check before escaping the
    // relay's route boundary.
    if (!target.pathname.startsWith(RELAY_ALLOWED_PREFIX)) return null;
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    base.pathname = `${basePath}${target.pathname}` || "/";
    base.search = target.search;
    base.hash = "";
    if (base.protocol !== "http:" && base.protocol !== "https:") return null;
    return base;
  } catch {
    // coercion-ok: malformed relay URL cannot produce a relay target.
    return null;
  }
}

function requestHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function corsHeaders(request: IncomingMessage): Record<string, string> {
  const origin = requestHeaderValue(request.headers.origin) ?? "*";
  const requestedHeaders =
    requestHeaderValue(request.headers["access-control-request-headers"]) ||
    "content-type, x-agent-native-surface";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": requestedHeaders,
    "Access-Control-Allow-Methods":
      "GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE",
    "Access-Control-Expose-Headers": "content-type, cache-control, etag",
  };
}

function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  message: string,
): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, {
    ...corsHeaders(request),
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  relayPath: RelayPath,
): Promise<void> {
  const appConfig = AppStore.loadApps().find(
    (candidate) => candidate.id === relayPath.appId,
  );
  if (!appConfig) {
    sendError(request, response, 404, "Desktop app not found");
    return;
  }

  const baseUrl = resolveAppBaseUrl(appConfig);
  const targetUrl = baseUrl
    ? resolveTargetUrl(baseUrl, relayPath.targetPath)
    : null;
  if (!targetUrl) {
    sendError(request, response, 502, "Desktop app has no reachable URL");
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  const appSession = session.fromPartition(`persist:app-${appConfig.id}`);
  const cookies = await appSession.cookies.get({ url: targetUrl.toString() });
  const cookieHeader = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  const upstream = net.request({
    url: targetUrl.toString(),
    method: request.method ?? "GET",
    session: appSession,
    redirect: "follow",
  });
  upstream.setHeader("Origin", targetUrl.origin);
  upstream.setHeader("Referer", `${targetUrl.origin}/`);
  if (cookieHeader) upstream.setHeader("Cookie", cookieHeader);

  for (const [name, value] of Object.entries(request.headers)) {
    if (
      HOP_BY_HOP_HEADERS.has(name) ||
      name === "host" ||
      name === "origin" ||
      name === "referer" ||
      name === "cookie" ||
      value === undefined
    ) {
      continue;
    }
    const headerValue = requestHeaderValue(value);
    if (headerValue !== undefined) upstream.setHeader(name, headerValue);
  }

  request.on("data", (chunk: Buffer | string) => upstream.write(chunk));
  request.on("end", () => upstream.end());
  request.on("aborted", () => upstream.abort());
  response.on("close", () => {
    if (!response.writableEnded) upstream.abort();
  });

  upstream.on("response", (upstreamResponse) => {
    const headers: Record<string, string | string[]> = {
      ...corsHeaders(request),
    };
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name) && value !== undefined) {
        headers[name] = value;
      }
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, headers);
    upstreamResponse.on("error", (error) => response.destroy(error));
    upstreamResponse.on("data", (chunk) => response.write(chunk));
    upstreamResponse.on("end", () => response.end());
  });
  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    sendError(request, response, 502, "Desktop app chat relay failed");
  });
}

function ensureRelay(): Promise<RelayState> {
  if (relayPromise) return relayPromise;

  const secret = randomUUID().replaceAll("-", "");
  relayPromise = new Promise<RelayState>((resolve, reject) => {
    const server = createServer((request, response) => {
      let parsed: URL;
      try {
        parsed = new URL(request.url ?? "/", "http://desktop-chat.invalid");
      } catch {
        sendError(request, response, 400, "Invalid relay URL");
        return;
      }
      const relayPath = parseRelayPath(parsed.pathname, secret);
      if (!relayPath) {
        sendError(request, response, 404, "Desktop chat relay route not found");
        return;
      }
      relayPath.targetPath += parsed.search;
      void proxyRequest(request, response, relayPath).catch((error) => {
        console.warn("[desktop-chat] relay request failed:", error);
        sendError(request, response, 502, "Desktop app chat relay failed");
      });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Desktop chat relay did not receive a TCP address"));
        return;
      }
      resolve({ port: address.port, secret });
    });
  }).catch((error) => {
    relayPromise = null;
    throw error;
  });

  return relayPromise;
}

export function registerDesktopChatIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.handle(
    IPC.DESKTOP_CHAT_GET_API_URL,
    async (_event: IpcMainInvokeEvent, appId: unknown) => {
      if (typeof appId !== "string" || !appId.trim()) return null;
      const appConfig = AppStore.loadApps().find(
        (candidate) => candidate.id === appId,
      );
      if (!appConfig || !resolveAppBaseUrl(appConfig)) return null;
      const relay = await ensureRelay();
      return `http://127.0.0.1:${relay.port}${RELAY_ROOT}/${relay.secret}/${encodeURIComponent(appId)}/_agent-native/agent-chat`;
    },
  );
  ipcMain.handle(
    IPC.DESKTOP_CHAT_GET_TERMINAL_INFO_URL,
    async (_event: IpcMainInvokeEvent, appId: unknown) => {
      if (typeof appId !== "string" || !appId.trim()) return null;
      const appConfig = AppStore.loadApps().find(
        (candidate) => candidate.id === appId,
      );
      if (!appConfig || !resolveAppBaseUrl(appConfig)) return null;
      const relay = await ensureRelay();
      return `http://127.0.0.1:${relay.port}${RELAY_ROOT}/${relay.secret}/${encodeURIComponent(appId)}/_agent-native/agent-terminal-info`;
    },
  );
}
