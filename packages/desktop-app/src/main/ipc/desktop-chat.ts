import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";

import { createPtyWebSocketServer } from "@agent-native/core/terminal/server";
import {
  getDesktopVisibleApps,
  getDesktopTemplateGatewayAppUrl,
  isDefaultDesktopTemplateDevTarget,
  type AppConfig,
} from "@shared/app-registry";
import { IPC } from "@shared/ipc-channels";
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  session,
  type IpcMainInvokeEvent,
} from "electron";

import * as AppStore from "../app-store";
import { readCookieHeaderForUrl } from "../cookie-header";
import {
  DesktopSurfaceMcpBridge,
  type DesktopSurfaceMcpRegistration,
} from "../desktop-surface-mcp";

const RELAY_ROOT = "/desktop-chat";
const DESKTOP_TERMINAL_INFO_ROOT = "/desktop-terminal-info";
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
const RESTRICTED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-length",
  "cookie2",
]);
const RESTRICTED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-encoding",
  "content-length",
]);
const RELAY_FAILURE_MESSAGE =
  "Desktop app chat relay failed. Update or restart the desktop app, then try again.";

interface RelayState {
  port: number;
  secret: string;
}

interface RelayPath {
  appId: string;
  targetPath: string;
}

let relayPromise: Promise<RelayState> | null = null;
let desktopTerminalPromise: ReturnType<typeof createDesktopTerminal> | null =
  null;
let ipcRegistered = false;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlInlineTable(headers: Record<string, string>): string {
  return `{${Object.entries(headers)
    .map(([key, value]) => `${tomlString(key)}=${tomlString(value)}`)
    .join(",")}}`;
}

export function desktopTerminalMcpArgs(
  command: string,
  registration: DesktopSurfaceMcpRegistration,
  claudeConfigPath: string,
): string[] {
  if (command === "claude") {
    return ["--mcp-config", claudeConfigPath];
  }
  if (command === "codex") {
    return [
      "-c",
      `mcp_servers.agent-native-desktop.url=${tomlString(registration.url)}`,
      "-c",
      `mcp_servers.agent-native-desktop.http_headers=${tomlInlineTable({
        Authorization: `Bearer ${registration.bearerToken}`,
      })}`,
    ];
  }
  return [];
}

function removeDesktopTerminalConfig(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.warn(
      "[desktop-terminal] Could not remove temporary MCP config:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

function reportDesktopTerminalCleanupFailure(error: unknown): void {
  console.warn(
    "[desktop-terminal] Could not close the desktop surface bridge:",
    error instanceof Error ? error.message : "unknown error",
  );
}

async function createDesktopTerminal() {
  const token = randomUUID().replaceAll("-", "");
  const surfaceMcp = new DesktopSurfaceMcpBridge({
    listApps: () =>
      getDesktopVisibleApps(AppStore.loadApps())
        .filter((appConfig) => appConfig.enabled !== false)
        .map(({ id, name }) => ({ id, name })),
    openApp: (request) => {
      const win = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed(),
      );
      if (!win) throw new Error("The desktop shell is not available.");
      win.webContents.send(IPC.DESKTOP_CHAT_OPEN_APP, request);
    },
  });
  let claudeConfigPath: string | undefined;
  try {
    const surfaceMcpUrl = await surfaceMcp.start();
    const surfaceMcpRegistration = surfaceMcp.register();
    claudeConfigPath = path.join(
      app.getPath("temp"),
      `agent-native-desktop-${randomUUID()}.json`,
    );
    fs.writeFileSync(
      claudeConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            "agent-native-desktop": {
              type: "http",
              url: surfaceMcpUrl,
              headers: {
                Authorization: `Bearer ${surfaceMcpRegistration.bearerToken}`,
              },
            },
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const terminal = await createPtyWebSocketServer({
      appDir: app.getPath("home"),
      authCheck: (request) => {
        try {
          const url = new URL(
            request.url ?? "",
            `http://${request.headers.host ?? "127.0.0.1"}`,
          );
          return url.searchParams.get("token") === token;
        } catch {
          // coercion-ok: malformed websocket URLs are authentication denials, never success.
          return false;
        }
      },
      getCommandArgs: (command) =>
        desktopTerminalMcpArgs(
          command,
          surfaceMcpRegistration,
          claudeConfigPath!,
        ),
      logPrefix: "[desktop-terminal]",
    });
    const close = () => {
      terminal.close();
      void surfaceMcp.close().catch(reportDesktopTerminalCleanupFailure);
      removeDesktopTerminalConfig(claudeConfigPath);
    };
    app.once("before-quit", close);
    return { terminal, token };
  } catch (error) {
    removeDesktopTerminalConfig(claudeConfigPath);
    try {
      await surfaceMcp.close();
    } catch (closeError) {
      reportDesktopTerminalCleanupFailure(closeError);
    }
    throw error;
  }
}

function ensureDesktopTerminal() {
  desktopTerminalPromise ??= createDesktopTerminal().catch((error) => {
    desktopTerminalPromise = null;
    throw error;
  });
  return desktopTerminalPromise;
}

export function desktopTerminalInfo(port: number, token: string) {
  return {
    available: true,
    wsUrl: `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`,
  };
}

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

export function shouldForwardRequestHeader(
  name: string,
  value: string | string[] | undefined,
  blockedHeaders: ReadonlySet<string> = RESTRICTED_REQUEST_HEADERS,
): boolean {
  const normalizedName = name.toLowerCase();
  return (
    value !== undefined &&
    !blockedHeaders.has(normalizedName) &&
    normalizedName !== "host" &&
    normalizedName !== "origin" &&
    normalizedName !== "referer" &&
    normalizedName !== "cookie"
  );
}

export function shouldForwardResponseHeader(
  name: string,
  value: string | string[] | undefined,
  blockedHeaders: ReadonlySet<string> = RESTRICTED_RESPONSE_HEADERS,
): boolean {
  return shouldForwardRequestHeader(name, value, blockedHeaders);
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
  const cookieHeader = await readCookieHeaderForUrl(
    appSession,
    targetUrl.toString(),
  );

  const upstream = net.request({
    url: targetUrl.toString(),
    method: request.method ?? "GET",
    session: appSession,
    redirect: "follow",
  });
  upstream.setHeader("Origin", targetUrl.origin);
  upstream.setHeader("Referer", `${targetUrl.origin}/`);
  if (cookieHeader) upstream.setHeader("Cookie", cookieHeader);

  if (
    request.headers["content-length"] !== undefined ||
    request.headers["transfer-encoding"] !== undefined
  ) {
    upstream.chunkedEncoding = true;
  }

  const blockedHeaders = new Set(RESTRICTED_REQUEST_HEADERS);
  for (const connectionToken of (
    requestHeaderValue(request.headers.connection) ?? ""
  ).split(",")) {
    const normalizedToken = connectionToken.trim().toLowerCase();
    if (normalizedToken) blockedHeaders.add(normalizedToken);
  }

  for (const [name, value] of Object.entries(request.headers)) {
    if (!shouldForwardRequestHeader(name, value, blockedHeaders)) continue;
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
      if (shouldForwardResponseHeader(name, value)) {
        headers[name] = value;
      }
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, headers);
    upstreamResponse.on("error", (error) => response.destroy(error));
    upstreamResponse.on("data", (chunk) => response.write(chunk));
    upstreamResponse.on("end", () => response.end());
  });
  upstream.on("error", (error) => {
    console.warn("[desktop-chat] upstream relay request failed", {
      appId: relayPath.appId,
      method: request.method ?? "GET",
      targetOrigin: targetUrl.origin,
      targetPath: targetUrl.pathname,
      errorCode:
        error instanceof Error && "code" in error
          ? String((error as NodeJS.ErrnoException).code ?? "")
          : "",
      reason: error instanceof Error ? error.message : "unknown error",
    });
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    sendError(request, response, 502, RELAY_FAILURE_MESSAGE);
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
      if (parsed.pathname === `${DESKTOP_TERMINAL_INFO_ROOT}/${secret}`) {
        void ensureDesktopTerminal()
          .then(({ terminal, token }) => {
            response.writeHead(200, {
              ...corsHeaders(request),
              "Content-Type": "application/json; charset=utf-8",
            });
            response.end(
              JSON.stringify(desktopTerminalInfo(terminal.port, token)),
            );
          })
          .catch((error) => {
            console.warn("[desktop-terminal] failed to start", error);
            sendError(
              request,
              response,
              503,
              "The desktop terminal could not be started.",
            );
          });
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
        sendError(request, response, 502, RELAY_FAILURE_MESSAGE);
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
      if (appId === undefined || appId === null) {
        const relay = await ensureRelay();
        return `http://127.0.0.1:${relay.port}${DESKTOP_TERMINAL_INFO_ROOT}/${relay.secret}`;
      }
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
