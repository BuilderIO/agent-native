import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { createPtyWebSocketServer } from "@agent-native/core/terminal/server";
import {
  getDesktopVisibleApps,
  getDesktopTemplateGatewayAppUrl,
  isDefaultDesktopTemplateDevTarget,
  type AppConfig,
} from "@shared/app-registry";
import { IPC, type DesktopTerminalContext } from "@shared/ipc-channels";
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

interface DesktopTerminalMcpServer {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

function desktopTerminalMcpServerId(appId: string): string {
  return `desktop_app_${appId.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function desktopAppMcpUrl(baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("mcp", base).toString();
}

function desktopAppMcpConnectTokenUrl(baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("mcp/connect/token", base).toString();
}

function hashTerminalToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function readTerminalBearer(value: string | undefined): string | undefined {
  return /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(value ?? "")?.[1];
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

const TERMINAL_MCP_REQUEST_HEADERS = new Set([
  "accept",
  "cache-control",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
]);
const TERMINAL_MCP_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "last-event-id",
  "location",
  "mcp-session-id",
  "retry-after",
]);

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export interface DesktopTerminalMcpRegistration {
  url: string;
  bearerToken: string;
}

const PI_TERMINAL_EXTENSION_SOURCE = String.raw`
export default function (pi) {
  const rawServers = process.env.AGENT_NATIVE_TERMINAL_MCP_SERVERS || "{}";
  const servers = JSON.parse(rawServers);
  const sessions = {};
  const sessionInitializations = {};
  let nextRequestId = 1;
  const activeContext = process.env.AGENT_NATIVE_ACTIVE_APP_CONTEXT;
  const serverNames = Object.keys(servers);

  function parseBody(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      // coercion-ok: JSON parsing falls through to the documented SSE response format.
    }
    const data = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    return data && data !== "[DONE]" ? JSON.parse(data) : null;
  }

  async function readResponsePayload(response, requestId) {
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/event-stream") || !response.body) {
      return parseBody(await response.text());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), {
          stream: !chunk.done,
        });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";
        for (const event of events) {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data || data === "[DONE]") continue;
          const payload = JSON.parse(data);
          if (requestId == null || payload?.id === requestId) return payload;
        }
        if (chunk.done) return parseBody(buffer);
      }
    } finally {
      await reader.cancel().catch(() => {
        // coercion-ok: cancellation is best-effort after the response is consumed.
      });
      reader.releaseLock();
    }
  }

  async function request(server, body, signal, sessionId) {
    const headers = {
      ...server.headers,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const payload = await readResponsePayload(response, body.id);
    if (!response.ok) {
      const message =
        payload && payload.error && payload.error.message
          ? payload.error.message
          : "MCP request failed (" + response.status + ").";
      throw new Error(message);
    }
    return {
      payload,
      sessionId: response.headers.get("mcp-session-id") || sessionId,
    };
  }

  async function getSessionId(serverName, server, signal) {
    if (sessions[serverName]) return sessions[serverName];
    if (sessionInitializations[serverName]) {
      return sessionInitializations[serverName];
    }
    const initialization = (async () => {
      const initialized = await request(
        server,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "agent-native-desktop-pi", version: "1.0.0" },
          },
        },
        signal,
      );
      const sessionId = initialized.sessionId;
      await request(
        server,
        { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
        signal,
        sessionId,
      );
      if (sessionId) sessions[serverName] = sessionId;
      return sessionId;
    })();
    sessionInitializations[serverName] = initialization;
    try {
      return await initialization;
    } finally {
      if (sessionInitializations[serverName] === initialization) {
        delete sessionInitializations[serverName];
      }
    }
  }

  async function callMcp(serverName, method, params, signal) {
    const server = servers[serverName];
    if (!server) throw new Error("Unknown Agent-Native MCP server: " + serverName);
    const sessionId = await getSessionId(serverName, server, signal);
    const result = await request(
      server,
      { jsonrpc: "2.0", id: nextRequestId++, method, params },
      signal,
      sessionId,
    );
    if (result.payload && result.payload.error) {
      throw new Error(result.payload.error.message || "MCP request failed.");
    }
    return result.payload && result.payload.result
      ? result.payload.result
      : result.payload;
  }

  function resultFor(value) {
    const content =
      value && Array.isArray(value.content)
        ? value.content.filter((item) => item && (item.type === "text" || item.type === "image"))
        : [];
    return {
      content:
        content.length > 0
          ? content
          : [{ type: "text", text: JSON.stringify(value) }],
      details: value,
    };
  }

  pi.on("before_agent_start", (event) => ({
    systemPrompt:
      event.systemPrompt +
      "\n\nThis Pi session is embedded in Agent-Native desktop. The active app context is exposed by the agent-native-desktop MCP server. Available MCP servers: " +
      serverNames.join(", ") +
      (activeContext ? ". Current context: " + activeContext : "."),
  }));

  pi.registerTool({
    name: "agent_native_app",
    label: "Agent-Native app",
    description:
      "List or call tools on the active Agent-Native desktop app. List tools before calling an app operation, and use agent-native-desktop to read the active app context.",
    promptSnippet: "List or call tools on the active Agent-Native app",
    promptGuidelines: [
      "Use agent_native_app to operate the active Agent-Native app through its MCP server.",
      "Call list_tools before call_tool when you do not already know the app tool schema.",
    ],
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["list_tools", "call_tool"],
          description: "Whether to list available tools or call one.",
        },
        server: {
          type: "string",
          description: "MCP server name from the available server list.",
        },
        tool: {
          type: "string",
          description: "Tool name returned by list_tools.",
        },
        arguments: {
          type: "object",
          additionalProperties: true,
          description: "Arguments for the selected MCP tool.",
        },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, signal) {
      const server = params.server || "agent-native-desktop";
      if (params.operation === "list_tools") {
        return resultFor(await callMcp(server, "tools/list", {}, signal));
      }
      if (!params.tool) throw new Error("tool is required for call_tool.");
      return resultFor(
        await callMcp(
          server,
          "tools/call",
          { name: params.tool, arguments: params.arguments || {} },
          signal,
        ),
      );
    },
  });
}
`;

/**
 * Main-process capability relay. Provider CLIs see only a loopback bearer;
 * app auth stays here and is never serialized into their config or argv.
 */
export class DesktopTerminalMcpRelay {
  private readonly bearerToken = randomBytes(32).toString("base64url");
  private readonly bearerHash = hashTerminalToken(this.bearerToken);
  private readonly activeRequests = new Map<
    AbortController,
    { request: IncomingMessage; response: ServerResponse }
  >();
  private server?: ReturnType<typeof createServer>;
  private url?: string;

  constructor(
    private readonly upstreamUrl: string,
    private readonly upstreamHeaders: Readonly<Record<string, string>>,
  ) {}

  async start(): Promise<DesktopTerminalMcpRegistration> {
    if (this.url) return this.registration();
    const upstream = new URL(this.upstreamUrl);
    if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
      throw new Error("The app MCP endpoint must use HTTP or HTTPS.");
    }
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("The app MCP relay did not receive a TCP address.");
    }
    this.server = server;
    this.url = `http://127.0.0.1:${address.port}/mcp`;
    return this.registration();
  }

  async close(): Promise<void> {
    for (const [controller, { request, response }] of this.activeRequests) {
      controller.abort();
      request.destroy();
      response.destroy();
    }
    const server = this.server;
    this.server = undefined;
    this.url = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private registration(): DesktopTerminalMcpRegistration {
    if (!this.url) throw new Error("The app MCP relay is not ready.");
    return { url: this.url, bearerToken: this.bearerToken };
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let requestPath: string;
    try {
      requestPath = new URL(
        request.url ?? "/",
        "http://desktop-terminal.invalid",
      ).pathname;
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (
      !isLoopbackAddress(request.socket.remoteAddress) ||
      requestPath !== "/mcp"
    ) {
      response.writeHead(404).end();
      return;
    }
    const bearer = readTerminalBearer(request.headers.authorization);
    if (!bearer || hashTerminalToken(bearer) !== this.bearerHash) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (!["DELETE", "GET", "POST"].includes(request.method ?? "")) {
      response.writeHead(405, { allow: "DELETE, GET, POST" }).end();
      return;
    }

    const controller = new AbortController();
    this.activeRequests.set(controller, { request, response });
    const abort = () => controller.abort();
    const abortResponse = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once("aborted", abort);
    response.once("close", abortResponse);
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (!TERMINAL_MCP_REQUEST_HEADERS.has(name.toLowerCase())) continue;
        const normalized = headerValue(value);
        if (normalized) headers.set(name, normalized);
      }
      headers.set("origin", new URL(this.upstreamUrl).origin);
      for (const [name, value] of Object.entries(this.upstreamHeaders)) {
        headers.set(name, value);
      }
      const body =
        request.method === "POST" ? await readRequestBody(request) : undefined;
      const upstream = await fetch(this.upstreamUrl, {
        method: request.method,
        headers,
        ...(body ? { body: body as unknown as BodyInit } : {}),
        redirect: "manual",
        signal: controller.signal,
      });
      const responseHeaders: Record<string, string> = {};
      for (const name of TERMINAL_MCP_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders[name] = value;
      }
      response.writeHead(upstream.status, responseHeaders);
      if (!upstream.body) {
        response.end();
        return;
      }
      await pipeline(
        Readable.fromWeb(upstream.body as unknown as NodeReadableStream),
        response,
      );
    } catch (error) {
      if (controller.signal.aborted || response.writableEnded) return;
      console.warn("[desktop-terminal] app MCP relay failed:", {
        upstreamOrigin: new URL(this.upstreamUrl).origin,
        error: error instanceof Error ? error.message : "unknown error",
      });
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end("The active app MCP connection failed.");
    } finally {
      this.activeRequests.delete(controller);
      request.removeListener("aborted", abort);
      response.removeListener("close", abortResponse);
    }
  }
}

function readMcpAuthHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const headers = value as Record<string, unknown>;
  const authHeaders: Record<string, string> = {};
  for (const name of ["Authorization", "X-Agent-Native-Owner-Email"]) {
    if (typeof headers[name] === "string" && headers[name].trim()) {
      authHeaders[name] = headers[name].trim();
    }
  }
  return authHeaders;
}

export async function getDesktopAppMcpAuthorization(
  appConfig: AppConfig,
  baseUrl: string,
): Promise<Record<string, string>> {
  const tokenUrl = desktopAppMcpConnectTokenUrl(baseUrl);
  const origin = new URL(baseUrl).origin;
  const cookieHeader = await readCookieHeaderForUrl(
    session.fromPartition(`persist:app-${appConfig.id}`),
    tokenUrl,
  );
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: origin,
      Referer: `${origin}/`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({ label: "Desktop terminal", ttlDays: 1 }),
    redirect: "manual",
  });
  const text = (await response.text()).trim();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `${appConfig.name} returned an invalid MCP authorization response.`,
    );
  }
  const object =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  if (!response.ok) {
    const message =
      typeof object.error === "string" && object.error.trim()
        ? object.error.trim()
        : `MCP authorization failed (${response.status}).`;
    throw new Error(
      `Could not connect the terminal to ${appConfig.name}: ${message}`,
    );
  }
  const authHeaders = readMcpAuthHeaders(
    object.mcpServerEntry &&
      typeof object.mcpServerEntry === "object" &&
      !Array.isArray(object.mcpServerEntry)
      ? (object.mcpServerEntry as Record<string, unknown>).headers
      : undefined,
  );
  if (Object.keys(authHeaders).length > 0) return authHeaders;
  if (typeof object.token === "string" && object.token.trim()) {
    return { Authorization: `Bearer ${object.token.trim()}` };
  }
  throw new Error(
    `Sign in to ${appConfig.name} before using its tools from the terminal.`,
  );
}

export function desktopTerminalMcpArgs(
  command: string,
  registration: DesktopSurfaceMcpRegistration,
  claudeConfigPath: string,
  appMcpServers: Readonly<Record<string, DesktopTerminalMcpServer>> = {},
  piExtensionPath?: string,
): string[] {
  const mcpServers: Record<string, DesktopTerminalMcpServer> = {
    "agent-native-desktop": {
      type: "http",
      url: registration.url,
      headers: { Authorization: `Bearer ${registration.bearerToken}` },
    },
    ...appMcpServers,
  };
  if (command === "claude") {
    return ["--mcp-config", claudeConfigPath];
  }
  if (command === "codex") {
    const args: string[] = [];
    for (const [serverId, server] of Object.entries(mcpServers)) {
      args.push("-c", `mcp_servers.${serverId}.url=${tomlString(server.url)}`);
      args.push(
        "-c",
        `mcp_servers.${serverId}.http_headers=${tomlInlineTable(server.headers)}`,
      );
    }
    return args;
  }
  if (command === "builder") {
    return [
      "code",
      "--configJson",
      JSON.stringify({ isLocal: true, mcpServers }),
    ];
  }
  if (command === "pi" && piExtensionPath) {
    return ["--extension", piExtensionPath];
  }
  return [];
}

export function desktopTerminalOpenCodeEnvironment(
  mcpServers: Readonly<Record<string, DesktopTerminalMcpServer>>,
): Record<string, string> {
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      mcp: Object.fromEntries(
        Object.entries(mcpServers).map(([serverId, server]) => [
          serverId,
          {
            type: "remote",
            url: server.url,
            enabled: true,
            oauth: false,
            headers: server.headers,
          },
        ]),
      ),
    }),
  };
}

export function stripCodexMcpConfig(config: string): string {
  const lines = config.split(/\r?\n/);
  const kept: string[] = [];
  let inMcpSection = false;
  for (const line of lines) {
    const section = /^\s*\[([^\]]+)\]/.exec(line)?.[1]?.trim();
    if (section)
      inMcpSection =
        section === "mcp_servers" || section.startsWith("mcp_servers.");
    if (inMcpSection || /^\s*mcp_servers\s*=/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function createCodexTerminalHome(): string {
  const sourceHome =
    process.env.CODEX_HOME || path.join(app.getPath("home"), ".codex");
  const terminalHome = fs.mkdtempSync(
    path.join(app.getPath("temp"), "agent-native-codex-"),
  );
  const sourceConfig = path.join(sourceHome, "config.toml");
  const terminalConfig = path.join(terminalHome, "config.toml");
  const config = fs.existsSync(sourceConfig)
    ? stripCodexMcpConfig(fs.readFileSync(sourceConfig, "utf8"))
    : "";
  fs.writeFileSync(terminalConfig, config, { mode: 0o600 });

  const sourceAuth = path.join(sourceHome, "auth.json");
  if (fs.existsSync(sourceAuth)) {
    fs.copyFileSync(sourceAuth, path.join(terminalHome, "auth.json"));
    fs.chmodSync(path.join(terminalHome, "auth.json"), 0o600);
  }
  return terminalHome;
}

function removeDesktopTerminalHome(directory: string | undefined): void {
  if (!directory) return;
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      "[desktop-terminal] Could not remove temporary Codex home:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
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
    "[desktop-terminal] Could not close a terminal capability:",
    error instanceof Error ? error.message : "unknown error",
  );
}

export function desktopTerminalWorkspacePath(): string {
  const workspacePath = path.join(
    app.getPath("userData"),
    "terminal-workspace",
  );
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

export function resolveDesktopTerminalCwd(preferredPath?: string): string {
  const candidates = [
    preferredPath,
    desktopTerminalWorkspacePath(),
    process.env.AGENT_NATIVE_PROJECT_ROOT,
    process.env.CODE_AGENTS_PROJECT_ROOT,
    process.env.INIT_CWD,
    process.env.PWD,
    process.cwd(),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (path.parse(resolved).root === resolved) continue;
    try {
      if (fs.statSync(resolved).isDirectory()) return resolved;
    } catch {
      continue;
    }
  }
  return desktopTerminalWorkspacePath();
}

function isSafeDesktopAppPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  const baseUrl = "http://desktop-app.invalid";
  return (
    URL.canParse(value, baseUrl) && new URL(value, baseUrl).origin === baseUrl
  );
}

function normalizeDesktopTerminalContext(
  value: unknown,
): DesktopTerminalContext | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The terminal app context is invalid.");
  }
  const input = value as Record<string, unknown>;
  const appId = typeof input.appId === "string" ? input.appId.trim() : "";
  if (!appId || appId.length > 80) {
    throw new Error("The terminal app context is invalid.");
  }
  const appConfig = getDesktopVisibleApps(AppStore.loadApps()).find(
    (candidate) => candidate.id === appId && candidate.enabled !== false,
  );
  if (!appConfig) {
    throw new Error("The selected desktop app is unavailable.");
  }
  const rawPath = typeof input.path === "string" ? input.path.trim() : "";
  const rawView = typeof input.view === "string" ? input.view.trim() : "";
  if (rawPath && (!isSafeDesktopAppPath(rawPath) || rawPath.length > 2_000)) {
    throw new Error("The terminal app path is invalid.");
  }
  if (rawView.length > 200) {
    throw new Error("The terminal app view is invalid.");
  }
  return {
    appId,
    ...(rawPath ? { path: rawPath } : {}),
    ...(rawView ? { view: rawView } : {}),
  };
}

function contextFromTerminalQuery(
  searchParams: URLSearchParams,
): DesktopTerminalContext | null {
  const appId = searchParams.get("appId")?.trim();
  if (!appId) return null;
  const pathValue = searchParams.get("path")?.trim();
  const view = searchParams.get("view")?.trim();
  return {
    appId,
    ...(pathValue ? { path: pathValue } : {}),
    ...(view ? { view } : {}),
  };
}

async function createDesktopTerminalSession(
  command: string,
  rawContext: DesktopTerminalContext | null,
) {
  const context = normalizeDesktopTerminalContext(rawContext);
  const appConfig = context
    ? getDesktopVisibleApps(AppStore.loadApps()).find(
        (candidate) => candidate.id === context.appId,
      )
    : undefined;
  if (context && !appConfig) {
    throw new Error("The selected desktop app is unavailable.");
  }
  const appContext = context
    ? {
        appId: context.appId,
        appName: appConfig!.name,
        ...(context.path ? { path: context.path } : {}),
        ...(context.view ? { view: context.view } : {}),
      }
    : null;
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
    getActiveAppContext: () => appContext,
  });
  let appMcpRelay: DesktopTerminalMcpRelay | undefined;
  let claudeConfigPath: string | undefined;
  let piExtensionPath: string | undefined;
  let codexHome: string | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    removeDesktopTerminalConfig(claudeConfigPath);
    removeDesktopTerminalConfig(piExtensionPath);
    removeDesktopTerminalHome(codexHome);
    try {
      await appMcpRelay?.close();
      await surfaceMcp.close();
    } catch (error) {
      reportDesktopTerminalCleanupFailure(error);
    }
  };
  try {
    const surfaceMcpUrl = await surfaceMcp.start();
    const surfaceMcpRegistration = surfaceMcp.register();
    const appMcpServers: Record<string, DesktopTerminalMcpServer> = {};
    if (appConfig) {
      const baseUrl = resolveAppBaseUrl(appConfig);
      if (!baseUrl) {
        throw new Error(`The ${appConfig.name} app has no reachable URL.`);
      }
      const authHeaders = await getDesktopAppMcpAuthorization(
        appConfig,
        baseUrl,
      );
      appMcpRelay = new DesktopTerminalMcpRelay(
        desktopAppMcpUrl(baseUrl),
        authHeaders,
      );
      const appMcpRegistration = await appMcpRelay.start();
      appMcpServers[desktopTerminalMcpServerId(appConfig.id)] = {
        type: "http",
        url: appMcpRegistration.url,
        headers: {
          Authorization: `Bearer ${appMcpRegistration.bearerToken}`,
        },
      };
    }
    const surfaceMcpServer: DesktopTerminalMcpServer = {
      type: "http",
      url: surfaceMcpUrl,
      headers: {
        Authorization: `Bearer ${surfaceMcpRegistration.bearerToken}`,
      },
    };
    const mcpServers = {
      "agent-native-desktop": surfaceMcpServer,
      ...appMcpServers,
    };
    if (command === "claude") {
      claudeConfigPath = path.join(
        app.getPath("temp"),
        `agent-native-desktop-${randomUUID()}.json`,
      );
      fs.writeFileSync(
        claudeConfigPath,
        JSON.stringify({ mcpServers }, null, 2),
        { mode: 0o600 },
      );
    }
    if (command === "pi") {
      piExtensionPath = path.join(
        app.getPath("temp"),
        `agent-native-desktop-${randomUUID()}.mcp.ts`,
      );
      fs.writeFileSync(piExtensionPath, PI_TERMINAL_EXTENSION_SOURCE, {
        mode: 0o600,
      });
    }
    if (command === "codex") codexHome = createCodexTerminalHome();
    return {
      commandArgs: desktopTerminalMcpArgs(
        command,
        surfaceMcpRegistration,
        claudeConfigPath ?? "",
        appMcpServers,
        piExtensionPath,
      ),
      environment: {
        MCP_SERVERS: JSON.stringify({ servers: mcpServers }),
        AGENT_NATIVE_TERMINAL_MCP_SERVERS: JSON.stringify(mcpServers),
        ...(appContext
          ? { AGENT_NATIVE_ACTIVE_APP_CONTEXT: JSON.stringify(appContext) }
          : {}),
        AGENT_NATIVE_CODE_AGENT_MCP_SERVER_ALLOWLIST:
          Object.keys(mcpServers).join(","),
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
        ...(command === "opencode"
          ? desktopTerminalOpenCodeEnvironment(mcpServers)
          : {}),
      },
      cwd: resolveDesktopTerminalCwd(appConfig?.localPath),
      onClose: close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function createDesktopTerminal() {
  const token = randomUUID().replaceAll("-", "");
  const terminal = await createPtyWebSocketServer({
    appDir: resolveDesktopTerminalCwd(),
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
    getSessionSetup: (
      command: string,
      context: DesktopTerminalContext | null,
    ) => createDesktopTerminalSession(command, context),
    logPrefix: "[desktop-terminal]",
  } as Parameters<typeof createPtyWebSocketServer>[0]);
  app.once("before-quit", () => terminal.close());
  return { terminal, token };
}

function ensureDesktopTerminal() {
  desktopTerminalPromise ??= createDesktopTerminal().catch((error) => {
    desktopTerminalPromise = null;
    throw error;
  });
  return desktopTerminalPromise;
}

export function desktopTerminalInfo(
  port: number,
  token: string,
  context: DesktopTerminalContext | null = null,
) {
  const query = [`token=${encodeURIComponent(token)}`];
  if (context) {
    query.push(`appId=${encodeURIComponent(context.appId)}`);
    if (context.path) query.push(`path=${encodeURIComponent(context.path)}`);
    if (context.view) query.push(`view=${encodeURIComponent(context.view)}`);
  }
  return {
    available: true,
    wsUrl: `ws://127.0.0.1:${port}/ws?${query.join("&")}`,
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
        const context = contextFromTerminalQuery(parsed.searchParams);
        void ensureDesktopTerminal()
          .then(({ terminal, token }) => {
            response.writeHead(200, {
              ...corsHeaders(request),
              "Content-Type": "application/json; charset=utf-8",
            });
            response.end(
              JSON.stringify(
                desktopTerminalInfo(terminal.port, token, context),
              ),
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
    async (_event: IpcMainInvokeEvent, rawContext: unknown) => {
      let context: DesktopTerminalContext | null;
      try {
        context = normalizeDesktopTerminalContext(rawContext);
      } catch (error) {
        console.warn(
          "[desktop-chat] Ignoring invalid terminal context.",
          error,
        );
        return null;
      }
      if (context) {
        const appConfig = getDesktopVisibleApps(AppStore.loadApps()).find(
          (candidate) => candidate.id === context?.appId,
        );
        if (!appConfig || !resolveAppBaseUrl(appConfig)) return null;
      }
      const relay = await ensureRelay();
      const url = new URL(
        `http://127.0.0.1:${relay.port}${DESKTOP_TERMINAL_INFO_ROOT}/${relay.secret}`,
      );
      if (context) {
        url.searchParams.set("appId", context.appId);
        if (context.path) url.searchParams.set("path", context.path);
        if (context.view) url.searchParams.set("view", context.view);
      }
      return url.toString();
    },
  );
}
