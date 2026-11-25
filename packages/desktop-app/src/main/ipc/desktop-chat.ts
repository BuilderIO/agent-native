import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import {
  MemoryTombstoneError,
  readMirroredMemory,
} from "@agent-native/core/resources/shared-memory";
import { createPtyWebSocketServer } from "@agent-native/core/terminal/pty-server";
import {
  getDesktopVisibleApps,
  getDesktopTemplateGatewayAppUrl,
  isDefaultDesktopTemplateDevTarget,
  type AppConfig,
} from "@shared/app-registry";
import {
  IPC,
  type CodeAgentBuilderActivationRequest,
  type CodeAgentBuilderActivationResult,
  type CodeAgentBuilderConnectOpenRequest,
  type CodeAgentBuilderConnectOpenResult,
  type CodeAgentBuilderConnectionResult,
  type CodeAgentBuilderConnectionStatus,
  type DesktopTerminalContext,
} from "@shared/ipc-channels";
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";

import * as AppStore from "../app-store";
import { readCookieHeaderForUrl } from "../cookie-header";
import type { CaptureActiveDesktopBrowserScreenshot } from "../desktop-browser-screenshot";
import type { DesktopIdentityApp } from "../desktop-identity";
import {
  DesktopSurfaceMcpBridge,
  type DesktopSurfaceMcpRegistration,
} from "../desktop-surface-mcp";

const RELAY_ROOT = "/desktop-chat";
const BUILDER_GATEWAY_RELAY_ROOT = "/desktop-builder";
const BUILDER_GATEWAY_RELAY_PUBLIC_KEY = "desktop-relay";
const BUILDER_MESSAGES_PATH = "/_agent-native/builder/desktop/messages";
const BUILDER_STATUS_PATH = "/_agent-native/connection-status/builder";
const DISPATCH_SESSION_PATH = "/_agent-native/auth/session";
const BUILDER_PROVISION_PATH = "/_agent-native/builder/provision";
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
const DESKTOP_APP_MCP_AUTH_TIMEOUT_MS = 10_000;

interface RelayState {
  port: number;
  secret: string;
}

interface RelayPath {
  appId: string;
  targetPath: string;
}

let relayPromise: Promise<RelayState> | null = null;
let relayServer: Server | null = null;
// Read per request, never captured: a runner holding an older value is refused.
let builderRelayBearer = randomBytes(32).toString("base64url");
// The Dispatch session the current bearer was issued for. Cookie values rotate
// within one account, so the account is the identity and the fingerprint only
// short-circuits the lookup.
interface BuilderRelaySession {
  fingerprint: string;
  account: string;
}
type DispatchAccountRead =
  | { state: "account"; email: string }
  | { state: "signed-out" }
  | { state: "unreadable" };
let builderRelaySession: BuilderRelaySession | null = null;
let resolveBuilderDispatchApp: (() => DesktopIdentityApp | null) | undefined;
let lastBuilderRelayAccountKey: string | null = null;
let desktopTerminalPromise: ReturnType<typeof createDesktopTerminal> | null =
  null;
let ipcRegistered = false;
let captureActiveBrowserScreenshot:
  | CaptureActiveDesktopBrowserScreenshot
  | undefined;

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
  "if-none-match",
  "last-event-id",
  "mcp-method",
  "mcp-name",
  "mcp-protocol-version",
  "mcp-session-id",
]);
const TERMINAL_MCP_PARAM_HEADER_PATTERN =
  /^mcp-param-[!#$%&'*+\-.^_`|~0-9a-z]+$/;
const TERMINAL_MCP_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "etag",
  "last-event-id",
  "location",
  "mcp-protocol-version",
  "mcp-session-id",
  "retry-after",
  "vary",
  "www-authenticate",
]);

export function shouldForwardTerminalMcpRequestHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    TERMINAL_MCP_REQUEST_HEADERS.has(lower) ||
    TERMINAL_MCP_PARAM_HEADER_PATTERN.test(lower)
  );
}

export function shouldForwardTerminalMcpResponseHeader(name: string): boolean {
  return TERMINAL_MCP_RESPONSE_HEADERS.has(name.toLowerCase());
}

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

export const PI_TERMINAL_EXTENSION_SOURCE = String.raw`
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

  function readSharedPersonalMemoryPrompt() {
    const promptFile = process.env.AGENT_NATIVE_MEMORY_PROMPT_FILE;
    if (!promptFile) return "";
    try {
      return require("node:fs").readFileSync(promptFile, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return "";
      console.error("[desktop-chat] Could not read shared memory:", error);
      return "";
    }
  }

  pi.on("before_agent_start", (event) => ({
    systemPrompt:
      event.systemPrompt +
      "\n\nThis Pi session is embedded in Agent-Native desktop. The active app context is exposed by the agent-native-desktop MCP server. Available MCP servers: " +
      serverNames.join(", ") +
      (activeContext ? ". Current context: " + activeContext : ".") +
      readSharedPersonalMemoryPrompt(),
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
        if (!shouldForwardTerminalMcpRequestHeader(name)) continue;
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
    signal: AbortSignal.timeout(DESKTOP_APP_MCP_AUTH_TIMEOUT_MS),
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
    process.env.AGENT_NATIVE_PROJECT_ROOT,
    process.env.CODE_AGENTS_PROJECT_ROOT,
    desktopTerminalWorkspacePath(),
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
  captureScreenshot?: CaptureActiveDesktopBrowserScreenshot,
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
    captureActiveBrowserScreenshot: captureScreenshot,
  });
  let appMcpRelay: DesktopTerminalMcpRelay | undefined;
  let claudeConfigPath: string | undefined;
  let piExtensionPath: string | undefined;
  let codexHome: string | undefined;
  let closed = false;
  const memoryOwner = await bindDesktopSessionMemoryOwner();
  const close = async () => {
    if (closed) return;
    closed = true;
    memoryOwner.release();
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
      if (baseUrl) {
        try {
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
        } catch (error) {
          console.warn("[desktop-terminal] app tools unavailable", {
            appId: appConfig.id,
            reason: error instanceof Error ? error.message : "unknown error",
          });
        }
      }
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
        ...desktopTerminalMemoryEnvironment(
          memoryOwner.file,
          memoryOwner.memoryDir,
        ),
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
      bindTerminate: memoryOwner.bindTerminate,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function createDesktopTerminal(
  captureScreenshot?: CaptureActiveDesktopBrowserScreenshot,
) {
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
    ) => createDesktopTerminalSession(command, context, captureScreenshot),
    logPrefix: "[desktop-terminal]",
  } as Parameters<typeof createPtyWebSocketServer>[0]);
  app.once("before-quit", () => terminal.close());
  return { terminal, token };
}

function ensureDesktopTerminal() {
  desktopTerminalPromise ??= createDesktopTerminal(
    captureActiveBrowserScreenshot,
  ).catch((error) => {
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

  await proxyRequestToTarget(request, response, {
    appId: appConfig.id,
    targetUrl,
    appSession,
    cookieHeader,
  });
}

interface ProxyRequestTarget {
  appId: string;
  targetUrl: URL;
  appSession: Electron.Session;
  cookieHeader: string;
  allowedHeaders?: ReadonlySet<string>;
  redirect?: "follow" | "error" | "manual";
}

async function proxyRequestToTarget(
  request: IncomingMessage,
  response: ServerResponse,
  target: ProxyRequestTarget,
): Promise<void> {
  const {
    appId,
    targetUrl,
    appSession,
    cookieHeader,
    allowedHeaders,
    redirect = "follow",
  } = target;

  const upstream = net.request({
    url: targetUrl.toString(),
    method: request.method ?? "GET",
    session: appSession,
    redirect,
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
    if (allowedHeaders && !allowedHeaders.has(name.toLowerCase())) continue;
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
      appId,
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

function isTrustedBuilderDispatchApp(
  identityApp: DesktopIdentityApp | null | undefined,
): identityApp is DesktopIdentityApp {
  if (
    !identityApp ||
    identityApp.id !== "dispatch" ||
    identityApp.identityAuthority !== true
  ) {
    return false;
  }
  try {
    const origin = new URL(identityApp.origin);
    return origin.protocol === "https:" && origin.origin === identityApp.origin;
  } catch {
    // coercion-ok: an invalid app origin never becomes a relay target.
    return false;
  }
}

function isBuilderConnectionStatus(
  value: unknown,
): value is CodeAgentBuilderConnectionStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.configured === "boolean" &&
    typeof status.builderEnabled === "boolean" &&
    typeof status.connectUrl === "string" &&
    typeof status.appHost === "string" &&
    typeof status.apiHost === "string" &&
    typeof status.publicKeyConfigured === "boolean" &&
    typeof status.privateKeyConfigured === "boolean"
  );
}

function hasManagedBuilderConnection(
  status: CodeAgentBuilderConnectionStatus,
): boolean {
  return (
    status.configured &&
    status.credentialSource !== "env" &&
    (!status.envManaged || status.credentialSource != null)
  );
}

function builderUnavailable(error: string): CodeAgentBuilderConnectionResult {
  return { state: "unavailable", error };
}

export function getDesktopBuilderConnectionStatus(
  connectAttemptId?: string,
): Promise<CodeAgentBuilderConnectionResult> {
  return checkBuilderConnection(connectAttemptId);
}

async function checkBuilderConnection(
  connectAttemptId: string | undefined,
  observeCookieHeader?: (cookieHeader: string) => void,
): Promise<CodeAgentBuilderConnectionResult> {
  const identityApp = resolveBuilderDispatchApp?.();
  if (!isTrustedBuilderDispatchApp(identityApp)) {
    return builderUnavailable("The signed-in Dispatch session is unavailable.");
  }

  const statusUrl = new URL(BUILDER_STATUS_PATH, identityApp.origin);
  if (connectAttemptId) {
    statusUrl.searchParams.set("_an_connect_attempt", connectAttemptId);
  }
  let cookieHeader: string;
  try {
    cookieHeader = await readCookieHeaderForUrl(
      identityApp.session,
      statusUrl.toString(),
    );
  } catch {
    return builderUnavailable("Could not read the signed-in Dispatch session.");
  }
  if (!cookieHeader) {
    return builderUnavailable(
      "Sign in to Agent-Native Desktop to use Builder.io.",
    );
  }
  observeCookieHeader?.(cookieHeader);

  try {
    const statusResponse = await fetch(statusUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader,
        Origin: identityApp.origin,
        Referer: `${identityApp.origin}/`,
        "x-agent-native-preview-origin": identityApp.origin,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(DESKTOP_APP_MCP_AUTH_TIMEOUT_MS),
    });
    if (!statusResponse.ok) {
      return builderUnavailable(
        statusResponse.status === 401 || statusResponse.status === 403
          ? "Sign in to Agent-Native Desktop to use Builder.io."
          : `Could not check Builder.io connection status (HTTP ${statusResponse.status}).`,
      );
    }
    const body: unknown = await statusResponse.json();
    if (!isBuilderConnectionStatus(body)) {
      return builderUnavailable("Dispatch returned an invalid Builder status.");
    }
    let connectUrl: URL;
    try {
      connectUrl = new URL(body.connectUrl);
    } catch {
      return builderUnavailable(
        "Dispatch returned an invalid Builder connect URL.",
      );
    }
    if (
      connectUrl.protocol !== "https:" ||
      connectUrl.origin !== identityApp.origin ||
      !connectUrl.pathname.endsWith("/_agent-native/builder/connect")
    ) {
      return builderUnavailable(
        "Dispatch returned an untrusted Builder connect URL.",
      );
    }
    return {
      state: hasManagedBuilderConnection(body) ? "connected" : "disconnected",
      status: body,
    };
  } catch (error) {
    return builderUnavailable(
      error instanceof Error && error.name === "TimeoutError"
        ? "Builder connection status timed out."
        : "Could not check Builder.io connection status.",
    );
  }
}

export async function activateDesktopBuilderAccount(
  input: CodeAgentBuilderActivationRequest,
): Promise<CodeAgentBuilderActivationResult> {
  const identityApp = resolveBuilderDispatchApp?.();
  if (!isTrustedBuilderDispatchApp(identityApp)) {
    return {
      ok: false,
      code: "session_unavailable",
      message: "The signed-in Dispatch session is unavailable.",
    };
  }
  if (
    !input ||
    typeof input.provisioningToken !== "string" ||
    !input.provisioningToken.trim() ||
    (input.scope !== undefined &&
      input.scope !== "org" &&
      input.scope !== "personal") ||
    (input.connectToken !== undefined &&
      input.connectToken !== null &&
      typeof input.connectToken !== "string")
  ) {
    return {
      ok: false,
      code: "invalid_request",
      message: "Builder account activation could not be started.",
    };
  }
  const targetUrl = new URL(BUILDER_PROVISION_PATH, identityApp.origin);
  for (const [key, value] of [
    ["signupSource", "agent-native"],
    ["agentNativeFlow", input.flow],
    ["agentNativeConnectSource", input.source],
  ] as const) {
    if (typeof value === "string" && value.trim()) {
      targetUrl.searchParams.set(key, value.trim().slice(0, 120));
    }
  }
  let cookieHeader: string;
  try {
    cookieHeader = await readCookieHeaderForUrl(
      identityApp.session,
      targetUrl.toString(),
    );
  } catch {
    cookieHeader = "";
  }
  if (!cookieHeader) {
    return {
      ok: false,
      code: "unauthorized",
      message: "Sign in to Agent-Native Desktop to use Builder.io.",
    };
  }

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        Origin: identityApp.origin,
        Referer: `${identityApp.origin}/`,
        "x-agent-native-preview-origin": identityApp.origin,
      },
      body: JSON.stringify({
        provisioningToken: input.provisioningToken,
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.connectToken ? { connectToken: input.connectToken } : {}),
      }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(DESKTOP_APP_MCP_AUTH_TIMEOUT_MS),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: "invalid_response", message: null };
    }
    if (
      response.ok &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>).ok === true
    ) {
      return {
        ok: true,
        ...((body as Record<string, unknown>).scope === "org" ||
        (body as Record<string, unknown>).scope === "personal"
          ? {
              scope: (body as Record<string, unknown>).scope as
                | "org"
                | "personal",
            }
          : {}),
      };
    }
    const result =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    return {
      ok: false,
      code:
        typeof result.code === "string"
          ? result.code
          : `http_${response.status}`,
      message: typeof result.message === "string" ? result.message : null,
    };
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "network_error",
      message: null,
    };
  }
}

export async function openDesktopBuilderConnect(
  input: CodeAgentBuilderConnectOpenRequest,
): Promise<CodeAgentBuilderConnectOpenResult> {
  if (
    !input ||
    typeof input.connectAttemptId !== "string" ||
    !/^[A-Za-z0-9-]{16,80}$/.test(input.connectAttemptId) ||
    (input.scope !== undefined &&
      input.scope !== "org" &&
      input.scope !== "personal")
  ) {
    return { ok: false, error: "Builder sign-in could not be opened." };
  }
  const connection = await getDesktopBuilderConnectionStatus(
    input.connectAttemptId,
  );
  if (connection.state === "unavailable") {
    return { ok: false, error: connection.error };
  }

  const identityApp = resolveBuilderDispatchApp?.();
  if (!isTrustedBuilderDispatchApp(identityApp)) {
    return {
      ok: false,
      error: "The signed-in Dispatch session is unavailable.",
    };
  }
  try {
    const connectUrl = new URL(connection.status.connectUrl);
    if (
      connectUrl.protocol !== "https:" ||
      connectUrl.origin !== identityApp.origin ||
      !connectUrl.pathname.endsWith("/_agent-native/builder/connect") ||
      !connectUrl.searchParams.has("_an_connect")
    ) {
      return {
        ok: false,
        error: "Dispatch returned an untrusted Builder connect URL.",
      };
    }
    connectUrl.searchParams.set("_an_connect_attempt", input.connectAttemptId);
    if (input.scope) connectUrl.searchParams.set("scope", input.scope);
    connectUrl.searchParams.set("signupSource", "agent-native");
    for (const [key, value] of [
      ["agentNativeFlow", input.flow],
      ["agentNativeConnectSource", input.source],
    ] as const) {
      if (typeof value === "string" && value.trim()) {
        connectUrl.searchParams.set(key, value.trim().slice(0, 120));
      }
    }
    await shell.openExternal(connectUrl.toString());
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Couldn't open Builder sign-in: ${error.message}`
          : "Couldn't open Builder sign-in.",
    };
  }
}

function sessionFingerprint(cookieHeader: string): string {
  return createHash("sha256").update(cookieHeader).digest("hex");
}

async function readDispatchAccount(
  identityApp: DesktopIdentityApp,
  cookieHeader: string,
): Promise<DispatchAccountRead> {
  try {
    const response = await fetch(
      new URL(DISPATCH_SESSION_PATH, identityApp.origin),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: cookieHeader,
          Origin: identityApp.origin,
          Referer: `${identityApp.origin}/`,
          "x-agent-native-preview-origin": identityApp.origin,
          "X-Agent-Native-Session-Check": "cookie-only",
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(DESKTOP_APP_MCP_AUTH_TIMEOUT_MS),
      },
    );
    if (
      !response.ok &&
      (response.status >= 500 ||
        response.status === 408 ||
        response.status === 429)
    ) {
      return { state: "unreadable" };
    }
    if (!response.ok) return { state: "signed-out" };
    const body: unknown = await response.json();
    const email =
      body && typeof body === "object" && "email" in body ? body.email : null;
    return typeof email === "string" && email.trim()
      ? { state: "account", email: email.trim().toLowerCase() }
      : { state: "signed-out" };
  } catch {
    return { state: "unreadable" };
  }
}

type DispatchSessionVerdict =
  | "same"
  | "different"
  | "signed-out"
  | "unverifiable";

// Decides from the cookie header itself, the same one a request would forward,
// so no owner note has to land first.
async function compareDispatchSession(
  identityApp: DesktopIdentityApp,
  bound: BuilderRelaySession,
  cookieHeader: string,
): Promise<DispatchSessionVerdict> {
  if (sessionFingerprint(cookieHeader) === bound.fingerprint) return "same";
  const read = await readDispatchAccount(identityApp, cookieHeader);
  if (read.state === "unreadable") return "unverifiable";
  if (read.state === "signed-out") return "signed-out";
  return read.email === bound.account ? "same" : "different";
}

// Hands the current bearer to a session only when it is the session the bearer
// already serves; any other session first rotates it, so earlier runners are
// refused rather than carried over.
const memoryOwnerFiles = new Map<string, string>();
let currentMemoryAccount: string | null = null;

const memorySessions = new Set<(account: string | null) => void>();
const memorySessionTerminators = new Map<string, () => void>();

function terminateMemorySession(file: string): void {
  console.error(
    "[desktop-chat] Ending a terminal whose memory access cannot be revoked",
  );
  const terminate = memorySessionTerminators.get(file);
  memorySessionTerminators.delete(file);
  terminate?.();
}

export function setDesktopMemoryAccount(rawAccount: string | null): void {
  const account = rawAccount?.trim().toLowerCase() || null;
  currentMemoryAccount = account;
  const failures: unknown[] = [];
  for (const [file, owner] of [...memoryOwnerFiles]) {
    if (owner === account) continue;
    try {
      fs.rmSync(file, { force: true });
      memoryOwnerFiles.delete(file);
    } catch (error) {
      failures.push(error);
      try {
        fs.writeFileSync(file, "");
      } catch (blankError) {
        failures.push(blankError);
        terminateMemorySession(file);
      }
    }
  }
  for (const rebind of [...memorySessions]) {
    try {
      rebind(account);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    console.error(
      "[desktop-chat] Could not fully switch the shared memory account:",
      new AggregateError(failures),
    );
  }
}

export function sweepStaleMemoryOwnerFiles(): void {
  for (const dir of ["memory-owners", "memory-roots"]) {
    fs.rmSync(path.join(app.getPath("userData"), dir), {
      recursive: true,
      force: true,
    });
  }
}

export function desktopTerminalMemoryEnvironment(
  promptFile: string,
  memoryDir?: string,
): {
  AGENT_NATIVE_MEMORY_PROMPT_FILE: string;
  AGENT_NATIVE_MEMORY_DIR: string;
} {
  return {
    AGENT_NATIVE_MEMORY_PROMPT_FILE: promptFile,
    AGENT_NATIVE_MEMORY_DIR: memoryDir ?? "",
  };
}

function desktopMemoryDir(): string {
  return path.join(app.getPath("userData"), "memory");
}

async function renderMemoryPrompt(account: string): Promise<string> {
  const index = await readMirroredMemory(
    account,
    "memory/MEMORY.md",
    desktopMemoryDir(),
  );
  const content = index.state === "present" ? index.content.trim() : "";
  if (!content || content === "# Memory Index") return "";
  return `\n\n<resource name="memory/MEMORY.md" scope="personal" path="memory/MEMORY.md">\n${content}\n</resource>`;
}

export async function bindDesktopSessionMemoryOwner(): Promise<{
  file: string;
  memoryDir: string | undefined;
  release: () => void;
  bindTerminate: (terminate: () => void) => void;
}> {
  const file = path.join(
    app.getPath("userData"),
    "memory-owners",
    randomUUID(),
  );
  let account = currentMemoryAccount;
  let memoryDir: string | undefined;
  try {
    memoryDir = path.join(
      app.getPath("userData"),
      "memory-roots",
      randomUUID(),
    );
    fs.mkdirSync(memoryDir, { recursive: true });
  } catch (error) {
    memoryDir = undefined;
    console.error("[desktop-chat] Could not create the memory root:", error);
  }
  const grant = (owner: string) => {
    if (!memoryDir) return;
    try {
      const target = path.join(desktopMemoryDir(), encodeURIComponent(owner));
      fs.mkdirSync(target, { recursive: true });
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.symlinkSync(
        target,
        path.join(memoryDir, encodeURIComponent(owner)),
        "junction",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
      console.error("[desktop-chat] Could not link the memory root:", error);
    }
  };
  let ended = false;
  const end = () => {
    ended = true;
    terminateMemorySession(file);
  };
  const revoke = () => {
    if (!memoryDir) return;
    try {
      for (const entry of fs.readdirSync(memoryDir)) {
        fs.rmSync(path.join(memoryDir, entry), {
          recursive: true,
          force: true,
        });
      }
    } catch (error) {
      const failures = [error];
      try {
        fs.rmSync(memoryDir, { recursive: true, force: true });
      } catch (rootError) {
        failures.push(rootError);
        end();
      }
      throw new AggregateError(failures, "Could not revoke the memory root");
    }
  };
  if (account) grant(account);
  let released = false;
  const refresh = async () => {
    if (!account) return;
    const bound = account;
    let prompt: string;
    try {
      prompt = await renderMemoryPrompt(bound);
    } catch (error) {
      if (error instanceof MemoryTombstoneError) {
        fs.rmSync(file, { force: true });
        memoryOwnerFiles.delete(file);
        return;
      }
      console.error(
        "[desktop-chat] Could not read shared memory; keeping the last prompt:",
        error,
      );
      return;
    }
    if (released || currentMemoryAccount !== bound) return;
    if (!prompt) {
      fs.rmSync(file, { force: true });
      memoryOwnerFiles.delete(file);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, prompt, { mode: 0o600 });
    memoryOwnerFiles.set(file, bound);
  };
  let refreshes: Promise<void> = Promise.resolve();
  const scheduleRefresh = () => {
    refreshes = refreshes.then(() =>
      refresh().catch((error) =>
        console.error("[desktop-chat] Could not refresh memory:", error),
      ),
    );
    return refreshes;
  };
  let watcher: fs.FSWatcher | undefined;
  const watch = () => {
    try {
      fs.mkdirSync(desktopMemoryDir(), { recursive: true });
      watcher = fs.watch(desktopMemoryDir(), { recursive: true }, () => {
        void scheduleRefresh();
      });
      watcher.on("error", () => watcher?.close());
    } catch (error) {
      console.error("[desktop-chat] Could not watch shared memory:", error);
    }
  };
  const rebind = (next: string | null) => {
    if (released || ended) return;
    if (account && account !== next) {
      end();
      try {
        revoke();
      } finally {
        account = null;
        watcher?.close();
        watcher = undefined;
      }
      return;
    }
    if (!next) return;
    if (!account) {
      account = next;
      watch();
    }
    grant(next);
    void scheduleRefresh();
  };
  if (account) watch();
  memorySessions.add(rebind);
  await scheduleRefresh();
  return {
    file,
    memoryDir,
    bindTerminate: (terminate) => {
      memorySessionTerminators.set(file, terminate);
      if (ended) terminate();
    },
    release: () => {
      released = true;
      memorySessionTerminators.delete(file);
      if (memoryDir) fs.rmSync(memoryDir, { recursive: true, force: true });
      memorySessions.delete(rebind);
      watcher?.close();
      fs.rmSync(file, { force: true });
      memoryOwnerFiles.delete(file);
    },
  };
}

function bindBuilderRelaySession(next: BuilderRelaySession): void {
  const current = builderRelaySession;
  if (
    current !== null &&
    current.fingerprint !== next.fingerprint &&
    current.account !== next.account
  ) {
    rotateDesktopBuilderRelayBearer();
  }
  builderRelaySession = next;
  setDesktopMemoryAccount(next.account);
}

const SETUP_SESSION_REFUSALS: Record<
  Exclude<DispatchSessionVerdict, "same">,
  string
> = {
  different:
    "The Desktop account changed while Builder.io was starting. Start the chat again.",
  "signed-out": "Sign in to Agent-Native Desktop to use Builder.io.",
  unverifiable:
    "Could not verify the signed-in Dispatch account. Start the chat again.",
};

export async function getDesktopBuilderGatewayRunnerEnvironment(): Promise<{
  status: CodeAgentBuilderConnectionResult;
  env?: NodeJS.ProcessEnv;
  error?: string;
}> {
  const setupBearer = builderRelayBearer;
  let statusCookieHeader = "";
  const connection = await checkBuilderConnection(undefined, (cookieHeader) => {
    statusCookieHeader = cookieHeader;
  });
  if (
    connection.state === "unavailable" ||
    connection.state === "disconnected"
  ) {
    return { status: connection };
  }

  let relay: RelayState;
  try {
    relay = await ensureRelay();
  } catch (error) {
    return {
      status: connection,
      error:
        error instanceof Error
          ? `Could not start the Desktop Builder relay: ${error.message}`
          : "Could not start the Desktop Builder relay.",
    };
  }

  // The session the status request ran under is the one this bearer is issued
  // for. Its account is read now, before anything can replace the cookies.
  const identityApp = resolveBuilderDispatchApp?.();
  if (!isTrustedBuilderDispatchApp(identityApp) || !statusCookieHeader) {
    return {
      status: connection,
      error: "The signed-in Dispatch session is unavailable.",
    };
  }
  const issuedRead = await readDispatchAccount(identityApp, statusCookieHeader);
  if (issuedRead.state !== "account") {
    return {
      status: connection,
      error: "Could not confirm your Builder.io account. Start the chat again.",
    };
  }
  const issued: BuilderRelaySession = {
    fingerprint: sessionFingerprint(statusCookieHeader),
    account: issuedRead.email,
  };
  let currentCookieHeader: string;
  try {
    currentCookieHeader = await readCookieHeaderForUrl(
      identityApp.session,
      new URL(BUILDER_MESSAGES_PATH, identityApp.origin).toString(),
    );
  } catch {
    return {
      status: connection,
      error: "Could not read the signed-in Dispatch session.",
    };
  }
  const verdict = currentCookieHeader
    ? await compareDispatchSession(identityApp, issued, currentCookieHeader)
    : "signed-out";
  if (verdict !== "same") {
    return { status: connection, error: SETUP_SESSION_REFUSALS[verdict] };
  }
  if (builderRelayBearer !== setupBearer) {
    return {
      status: connection,
      error:
        "The Desktop account changed while Builder.io was starting. Start the chat again.",
    };
  }
  bindBuilderRelaySession({
    ...issued,
    fingerprint: sessionFingerprint(currentCookieHeader),
  });
  const relayBaseUrl = new URL(
    `${BUILDER_GATEWAY_RELAY_ROOT}/${builderRelayBearer}`,
    `http://127.0.0.1:${relay.port}`,
  );
  return {
    status: connection,
    env: {
      BUILDER_GATEWAY_BASE_URL: relayBaseUrl.toString(),
      // BuilderEngine uses these only to pass its local credential preflight.
      // The private value is a per-process loopback bearer, and the relay strips
      // both fields before forwarding to Dispatch.
      BUILDER_PRIVATE_KEY: builderRelayBearer,
      BUILDER_PUBLIC_KEY: BUILDER_GATEWAY_RELAY_PUBLIC_KEY,
    },
  };
}

// A runner started for the previous Desktop owner keeps the old bearer, so its
// next request is refused instead of being forwarded with the new owner's cookies.
export function rotateDesktopBuilderRelayBearer(): void {
  builderRelayBearer = randomBytes(32).toString("base64url");
  builderRelaySession = null;
  setDesktopMemoryAccount(null);
}

// Only a real account replacing a different real account rotates the bearer.
// No-account and unreadable keys leave the Dispatch session untouched, so the
// same account returning after them keeps its runners. The bound session, not
// this note, is what decides whether a request is forwarded.
export function noteDesktopBuilderRelayOwner(owner: string | null): void {
  if (owner === null || owner === "no-account") {
    setDesktopMemoryAccount(null);
    return;
  }
  const previous = lastBuilderRelayAccountKey;
  lastBuilderRelayAccountKey = owner;
  if (previous !== null && previous !== owner)
    rotateDesktopBuilderRelayBearer();
  if (owner.startsWith("account:")) {
    setDesktopMemoryAccount(owner.slice("account:".length));
  }
}

export async function closeDesktopChatRelay(): Promise<void> {
  const server = relayServer;
  relayServer = null;
  relayPromise = null;
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function proxyBuilderGatewayRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  searchParams: URLSearchParams,
): Promise<void> {
  const builderSecret = builderRelayBearer;
  if (
    !isLoopbackAddress(request.socket.remoteAddress) ||
    pathname !== `${BUILDER_GATEWAY_RELAY_ROOT}/${builderSecret}/messages`
  ) {
    sendError(request, response, 404, "Builder relay route not found");
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { ...corsHeaders(request), Allow: "POST" });
    response.end("Method not allowed");
    return;
  }
  if (request.headers.authorization !== `Bearer ${builderSecret}`) {
    sendError(request, response, 401, "Unauthorized");
    return;
  }
  if (
    searchParams.size !== 1 ||
    searchParams.get("apiKey") !== BUILDER_GATEWAY_RELAY_PUBLIC_KEY
  ) {
    sendError(request, response, 400, "Invalid Builder relay request");
    return;
  }
  if (
    !/^application\/json\s*(;|$)/i.test(request.headers["content-type"] ?? "")
  ) {
    sendError(request, response, 415, "Send a JSON body.");
    return;
  }

  const identityApp = resolveBuilderDispatchApp?.();
  if (!isTrustedBuilderDispatchApp(identityApp)) {
    sendError(
      request,
      response,
      503,
      "The signed-in Dispatch session is unavailable.",
    );
    return;
  }
  const targetUrl = new URL(BUILDER_MESSAGES_PATH, identityApp.origin);
  const cookieHeader = await readCookieHeaderForUrl(
    identityApp.session,
    targetUrl.toString(),
  );
  if (builderSecret !== builderRelayBearer) {
    sendError(request, response, 404, "Builder relay route not found");
    return;
  }
  if (!cookieHeader) {
    sendError(
      request,
      response,
      401,
      "Sign in to Agent-Native Desktop to use Builder.io.",
    );
    return;
  }
  const bound = builderRelaySession;
  const verdict = bound
    ? await compareDispatchSession(identityApp, bound, cookieHeader)
    : "different";
  if (builderSecret !== builderRelayBearer) {
    sendError(request, response, 404, "Builder relay route not found");
    return;
  }
  if (verdict !== "same") {
    if (verdict === "signed-out") {
      sendError(
        request,
        response,
        401,
        "Sign in to Agent-Native Desktop to use Builder.io.",
      );
    } else if (verdict === "unverifiable") {
      sendError(
        request,
        response,
        503,
        "Could not verify the signed-in Dispatch account.",
      );
    } else {
      sendError(request, response, 404, "Builder relay route not found");
    }
    return;
  }
  if (bound) bound.fingerprint = sessionFingerprint(cookieHeader);

  await proxyRequestToTarget(request, response, {
    appId: identityApp.id,
    targetUrl,
    appSession: identityApp.session,
    cookieHeader,
    redirect: "error",
    allowedHeaders: new Set([
      "accept",
      "content-type",
      "x-client-name",
      "x-client-version",
    ]),
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
      if (parsed.pathname.startsWith(`${BUILDER_GATEWAY_RELAY_ROOT}/`)) {
        void proxyBuilderGatewayRequest(
          request,
          response,
          parsed.pathname,
          parsed.searchParams,
        ).catch((error) => {
          console.warn("[desktop-builder] relay request failed:", error);
          sendError(request, response, 502, RELAY_FAILURE_MESSAGE);
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
      relayServer = server;
      app.once("before-quit", () => {
        void closeDesktopChatRelay().catch((error) => {
          console.warn("[desktop-chat] could not close the relay", error);
        });
      });
      resolve({ port: address.port, secret });
    });
  }).catch((error) => {
    relayPromise = null;
    throw error;
  });

  return relayPromise;
}

export function registerDesktopChatIpc(
  options: {
    captureActiveBrowserScreenshot?: CaptureActiveDesktopBrowserScreenshot;
    resolveBuilderDispatchApp?: () => DesktopIdentityApp | null;
  } = {},
): void {
  if (ipcRegistered) return;
  sweepStaleMemoryOwnerFiles();
  captureActiveBrowserScreenshot = options.captureActiveBrowserScreenshot;
  resolveBuilderDispatchApp = options.resolveBuilderDispatchApp;
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
