import { MCP_APP_EXTENSION_ID, MCP_APP_MIME_TYPE } from "../action.js";
import type { McpConfig, McpServerConfig } from "./config.js";
import { formatMcpConnectError, httpStatusFromError } from "./errors.js";
import {
  isFirstPartyRemoteEndpointTrusted,
  parseMergedKey,
} from "./remote-store.js";

export const MCP_TOOL_PREFIX = "mcp__";

export interface McpTool {
  source: string;
  name: string;
  originalName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  title?: string;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

interface ServerEntry {
  id: string;
  config: McpServerConfig;
  client: any;
  transport: any;
  tools: McpTool[];
  error?: string;
  pendingRequests: number;
  pendingRequestsDrained: Promise<void>;
  resolvePendingRequests?: () => void;
  replacement?: ServerEntry;
}

type ErrorSink = (error: unknown) => void;

function isNode(): boolean {
  return (
    typeof process !== "undefined" &&
    !!(process as any).versions?.node &&
    typeof (process as any).versions.node === "string"
  );
}

function buildPrefixedName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverId}__${toolName}`;
}

export function buildMcpToolName(serverId: string, toolName: string): string {
  return buildPrefixedName(serverId, toolName);
}

export function parseMcpToolName(
  prefixedName: string,
): { serverId: string; toolName: string } | null {
  if (!prefixedName.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = prefixedName.slice(MCP_TOOL_PREFIX.length);
  const idx = rest.indexOf("__");
  if (idx < 0) return null;
  return {
    serverId: rest.slice(0, idx),
    toolName: rest.slice(idx + 2),
  };
}

export interface McpClientManagerOptions {
  debug?: boolean;
  connectTimeoutMs?: number;
}

function sameServerConfig(a: McpServerConfig, b: McpServerConfig): boolean {
  const typeA = a.type ?? "stdio";
  const typeB = b.type ?? "stdio";
  if (typeA !== typeB) return false;
  if (typeA === "http" && b.type === "http" && a.type === "http") {
    return (
      a.url === b.url &&
      JSON.stringify(a.headers ?? {}) === JSON.stringify(b.headers ?? {}) &&
      a.firstParty === b.firstParty &&
      a.firstPartyAppId === b.firstPartyAppId &&
      a.firstPartyOrgId === b.firstPartyOrgId
    );
  }
  if (a.type !== "http" && b.type !== "http") {
    return (
      a.command === b.command &&
      JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? []) &&
      JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {}) &&
      (a.cwd ?? "") === (b.cwd ?? "")
    );
  }
  return false;
}

async function safelyClose(value: any, recordError?: ErrorSink): Promise<void> {
  try {
    if (value?.close) await value.close();
  } catch (err) {
    recordError?.(err);
  }
}

function guardClose(
  value: any,
  recordError: ErrorSink,
): (() => void) | undefined {
  if (!value || typeof value.close !== "function") return undefined;
  const originalClose = value.close.bind(value);
  value.close = async (...args: unknown[]) => {
    try {
      return await originalClose(...args);
    } catch (err) {
      recordError(err);
      return undefined;
    }
  };
  return () => {
    value.close = originalClose;
  };
}

type SdkModules = {
  Client: any;
  StdioClientTransport: any;
  StreamableHTTPClientTransport: any;
};

const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 5_000;

function mcpConnectTimeoutMs(configured?: number): number {
  const raw =
    typeof process !== "undefined"
      ? process.env.AGENT_NATIVE_MCP_CLIENT_CONNECT_TIMEOUT_MS ||
        process.env.MCP_CLIENT_CONNECT_TIMEOUT_MS
      : undefined;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  if (Number.isFinite(configured) && (configured as number) >= 0) {
    return configured as number;
  }
  return DEFAULT_MCP_CONNECT_TIMEOUT_MS;
}

async function withConnectTimeout<T>(
  work: Promise<T>,
  label: string,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class McpClientManager {
  private readonly servers: Map<string, ServerEntry> = new Map();
  private readonly debug: boolean;
  private readonly connectTimeoutMs: number | undefined;
  private started = false;
  private config: McpConfig | null;
  private sdk: SdkModules | null = null;
  private readonly listeners: Set<() => void> = new Set();
  private reconfigureQueue: Promise<unknown> = Promise.resolve();

  constructor(config: McpConfig | null, options: McpClientManagerOptions = {}) {
    this.config = config;
    this.debug = !!options.debug;
    this.connectTimeoutMs = options.connectTimeoutMs;
  }

  get enabled(): boolean {
    return !!this.config && Object.keys(this.config.servers).length > 0;
  }

  getConfig(): McpConfig | null {
    return this.config;
  }

  get configuredServers(): string[] {
    if (!this.config) return [];
    return Object.keys(this.config.servers);
  }

  get connectedServers(): string[] {
    return Array.from(this.servers.values())
      .filter((s) => s.client && !s.error)
      .map((s) => s.id);
  }

  private async loadSdk(needStdio: boolean): Promise<SdkModules | null> {
    if (this.sdk) {
      if (needStdio && !this.sdk.StdioClientTransport && isNode()) {
        try {
          const stdioMod = await import("@modelcontextprotocol/client/stdio");
          this.sdk.StdioClientTransport = stdioMod.StdioClientTransport;
        } catch (err: any) {
          console.warn(
            `[mcp-client] Failed to load stdio transport: ${err?.message ?? err}.`,
          );
        }
      }
      return this.sdk;
    }
    try {
      const clientMod = await import("@modelcontextprotocol/client");
      let StdioClientTransport: any = null;
      if (needStdio && isNode()) {
        try {
          const stdioMod = await import("@modelcontextprotocol/client/stdio");
          StdioClientTransport = stdioMod.StdioClientTransport;
        } catch (err: any) {
          console.warn(
            `[mcp-client] Failed to load stdio transport: ${err?.message ?? err}.`,
          );
        }
      }
      this.sdk = {
        Client: clientMod.Client,
        StdioClientTransport,
        StreamableHTTPClientTransport: clientMod.StreamableHTTPClientTransport,
      };
      return this.sdk;
    } catch (err: any) {
      console.warn(
        `[mcp-client] Failed to load MCP SDK: ${err?.message ?? err}. MCP tools disabled.`,
      );
      return null;
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (err: any) {
        console.warn(
          `[mcp-client] onChange listener threw: ${err?.message ?? err}`,
        );
      }
    }
  }

  /**
   * Connect to each configured MCP server (stdio or http) and enumerate tools.
   * Individual server failures are logged and skipped — the manager stays
   * usable with whichever servers did come up.
   *
   * Queued against `reconfigure()` so a `reconfigure` that lands before
   * `start()` finishes can't race on `this.started` / `this.servers`.
   */
  async start(): Promise<void> {
    const task = this.reconfigureQueue.then(() => this.startInternal());
    this.reconfigureQueue = task.catch(() => {
      /* failures surface on the caller, not on the queue */
    });
    return task;
  }

  private async startInternal(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.enabled) return;

    const needStdio = Object.values(this.config!.servers).some(
      (cfg) => (cfg.type ?? "stdio") === "stdio",
    );
    const sdk = await this.loadSdk(needStdio);
    if (!sdk) return;

    const entries = Object.entries(this.config!.servers);
    await Promise.all(
      entries.map(async ([id, cfg]) => this.addServer(id, cfg, sdk)),
    );
    this.emitChange();
  }

  private async addServer(
    id: string,
    cfg: McpServerConfig,
    sdk: SdkModules,
  ): Promise<void> {
    if (this.servers.has(id)) {
      console.warn(
        `[mcp-client] Duplicate server ID '${id}' — overwriting previous registration`,
      );
    }
    const entry: ServerEntry = {
      id,
      config: cfg,
      client: null,
      transport: null,
      tools: [],
      pendingRequests: 0,
      pendingRequestsDrained: Promise.resolve(),
    };
    this.servers.set(id, entry);
    try {
      await this.connectServer(entry, sdk);
      console.log(
        `[mcp-client] connected to ${id}: ${entry.tools.length} tools`,
      );
    } catch (err: any) {
      entry.error = formatMcpConnectError(err);
      console.warn(`[mcp-client] failed to connect to ${id}: ${entry.error}`);
    }
  }

  private async connectServer(
    entry: ServerEntry,
    sdk: SdkModules,
  ): Promise<void> {
    const cfg = entry.config;
    const { Client } = sdk;

    let transport: any;
    if (cfg.type === "http") {
      if (!sdk.StreamableHTTPClientTransport) {
        throw new Error("HTTP transport not available");
      }
      const requestInit: Record<string, unknown> = {};
      const staticHeaders = { ...(cfg.headers ?? {}) };
      const transportOptions: Record<string, unknown> = { requestInit };
      if (this.shouldInjectFirstPartyIdentity(entry)) {
        const baselineHeaders = { ...staticHeaders };
        removeAuthorizationHeaders(baselineHeaders);
        if (Object.keys(baselineHeaders).length > 0) {
          requestInit.headers = baselineHeaders;
        }
        if (typeof fetch === "function") {
          const nativeFetch = fetch.bind(globalThis);
          transportOptions.fetch = async (input: unknown, init?: unknown) =>
            nativeFetch(
              input as Parameters<typeof fetch>[0],
              await buildFirstPartyRequestInit(
                staticHeaders,
                init,
                this.firstPartyTrust(entry),
              ),
            );
        }
      } else if (Object.keys(staticHeaders).length > 0) {
        requestInit.headers = staticHeaders;
      }
      transport = new sdk.StreamableHTTPClientTransport(
        new URL(cfg.url),
        transportOptions,
      );
    } else {
      if (!sdk.StdioClientTransport) {
        throw new Error(
          "Stdio transport not available (needs Node runtime with MCP SDK)",
        );
      }
      const { command, args = [], env, cwd } = cfg;
      // SECURITY: stdio MCP servers run as child processes that inherit
      // their environment from us. We previously merged the entire
      // `process.env` into the child, which exposed every deployment
      // secret (A2A_SECRET, ANTHROPIC_API_KEY, BUILDER_PRIVATE_KEY, all
      // database URLs, all platform tokens) to any MCP server in
      // `mcp.config.json` — a malicious npx-fetched server could exfil
      // them by reading its own env. Instead, only forward a minimal
      // baseline plus the keys explicitly listed in `cfg.env`. See
      // finding #10 in /tmp/security-audit/12-mcp-a2a-agent.md.
      const ENV_ALLOWLIST = [
        "PATH",
        "HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "USER",
        "SHELL",
      ];
      const baseline: Record<string, string> = {};
      for (const k of ENV_ALLOWLIST) {
        const v = process.env[k];
        if (typeof v === "string") baseline[k] = v;
      }
      const mergedEnv = env ? { ...baseline, ...env } : baseline;
      transport = new sdk.StdioClientTransport({
        command,
        args,
        env: mergedEnv as Record<string, string>,
        cwd,
      });
    }

    const client = new Client(
      { name: "agent-native-mcp-client", version: "1.0.0" },
      {
        capabilities: {
          extensions: {
            [MCP_APP_EXTENSION_ID]: {
              mimeTypes: [MCP_APP_MIME_TYPE],
            },
          },
        },
        versionNegotiation: { mode: "auto" },
      } as any,
    );
    const recordConnectionError: ErrorSink = () => {};
    const restoreClientClose = guardClose(client, recordConnectionError);
    const restoreTransportClose = guardClose(transport, recordConnectionError);
    client.onerror = recordConnectionError;
    transport.onerror = recordConnectionError;

    try {
      const timeoutMs = mcpConnectTimeoutMs(this.connectTimeoutMs);
      await withConnectTimeout(
        Promise.resolve(client.connect(transport)),
        `MCP server ${entry.id} connect`,
        timeoutMs,
      );
      const listed = await withConnectTimeout(
        Promise.resolve(client.listTools()),
        `MCP server ${entry.id} tools/list`,
        timeoutMs,
      );
      const rawTools: Array<{
        name: string;
        title?: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
        annotations?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
      }> = (listed?.tools ?? []) as any[];

      entry.client = client;
      entry.transport = transport;
      entry.tools = rawTools.map((t) => ({
        source: entry.id,
        name: buildPrefixedName(entry.id, t.name),
        originalName: t.name,
        ...(t.title ? { title: t.title } : {}),
        description: t.description ?? t.name,
        inputSchema: (t.inputSchema ?? {
          type: "object",
          properties: {},
        }) as Record<string, unknown>,
        ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
        ...(t.annotations ? { annotations: t.annotations } : {}),
        ...(t._meta ? { _meta: t._meta } : {}),
        raw: { ...t },
      }));
      client.onerror = (error: unknown) => {
        entry.error = formatMcpConnectError(error);
        if (this.debug) {
          console.warn(
            `[mcp-client] runtime error from ${entry.id}: ${entry.error}`,
          );
        }
      };
    } catch (err) {
      await safelyClose(client, recordConnectionError);
      await safelyClose(transport, recordConnectionError);
      throw err;
    } finally {
      restoreClientClose?.();
      restoreTransportClose?.();
    }
  }

  private async closeEntry(entry: ServerEntry): Promise<void> {
    if (entry.client) entry.client.onerror = undefined;
    if (entry.transport) entry.transport.onerror = undefined;
    await safelyClose(entry.client);
    await safelyClose(entry.transport);
  }

  private beginRequest(entry: ServerEntry): void {
    if (entry.pendingRequests === 0) {
      entry.pendingRequestsDrained = new Promise<void>((resolve) => {
        entry.resolvePendingRequests = resolve;
      });
    }
    entry.pendingRequests += 1;
  }

  private endRequest(entry: ServerEntry): void {
    entry.pendingRequests -= 1;
    if (entry.pendingRequests === 0) {
      entry.resolvePendingRequests?.();
      entry.resolvePendingRequests = undefined;
    }
  }

  private async runRequest<T>(
    entry: ServerEntry,
    operation: (entry: ServerEntry) => Promise<T>,
  ): Promise<T> {
    this.beginRequest(entry);
    try {
      return await operation(entry);
    } finally {
      this.endRequest(entry);
    }
  }

  private async reconnectExpiredSession(
    entry: ServerEntry,
    failedTransport: any,
  ): Promise<ServerEntry | null> {
    const task = this.reconfigureQueue.then(async () => {
      if (
        this.servers.get(entry.id) !== entry ||
        entry.transport !== failedTransport
      ) {
        return this.servers.get(entry.id) === entry.replacement
          ? (entry.replacement ?? null)
          : null;
      }

      await entry.pendingRequestsDrained;
      if (
        this.servers.get(entry.id) !== entry ||
        entry.transport !== failedTransport
      ) {
        return this.servers.get(entry.id) === entry.replacement
          ? (entry.replacement ?? null)
          : null;
      }
      this.servers.delete(entry.id);
      await this.closeEntry(entry);
      const sdk = await this.loadSdk(
        (entry.config.type ?? "stdio") === "stdio",
      );
      if (!sdk) throw new Error("MCP SDK is unavailable");
      await this.addServer(entry.id, entry.config, sdk);
      entry.replacement = this.servers.get(entry.id);
      this.emitChange();
      return entry.replacement ?? null;
    });
    this.reconfigureQueue = task.catch(() => {
      /* failures surface on the caller, not on the queue */
    });
    await task;
    return task;
  }

  private async withExpiredSessionRetry<T>(
    entry: ServerEntry,
    operation: (entry: ServerEntry) => Promise<T>,
  ): Promise<T> {
    const failedTransport = entry.transport;
    const sessionId = failedTransport?.sessionId;
    try {
      return await this.runRequest(entry, operation);
    } catch (error) {
      if (
        typeof sessionId !== "string" ||
        sessionId.length === 0 ||
        httpStatusFromError(error) !== 404
      ) {
        throw error;
      }
      const replacement = await this.reconnectExpiredSession(
        entry,
        failedTransport,
      );
      if (!replacement) throw error;
      if (!replacement.client) {
        throw new Error(
          `MCP server "${entry.id}" is not connected${
            replacement.error ? `: ${replacement.error}` : ""
          }`,
        );
      }
      return this.runRequest(replacement, operation);
    }
  }

  async reconfigure(newConfig: McpConfig | null): Promise<{
    added: string[];
    removed: string[];
    unchanged: string[];
    reconnected: string[];
  }> {
    const task = this.reconfigureQueue.then(() =>
      this.reconfigureInternal(newConfig),
    );
    this.reconfigureQueue = task.catch(() => {
      /* failures surface on the caller, not on the queue */
    });
    return task;
  }

  private async reconfigureInternal(newConfig: McpConfig | null): Promise<{
    added: string[];
    removed: string[];
    unchanged: string[];
    reconnected: string[];
  }> {
    const prev = this.config;
    this.config = newConfig;

    const prevServers = prev?.servers ?? {};
    const nextServers = newConfig?.servers ?? {};

    const added: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];
    const reconnected: string[] = [];

    for (const id of Object.keys(prevServers)) {
      if (!(id in nextServers)) {
        removed.push(id);
      } else if (!sameServerConfig(prevServers[id], nextServers[id])) {
        reconnected.push(id);
      } else {
        const entry = this.servers.get(id);
        if (entry?.error) reconnected.push(id);
        else unchanged.push(id);
      }
    }
    for (const id of Object.keys(nextServers)) {
      if (!(id in prevServers)) added.push(id);
    }

    const toDisconnect = [...removed, ...reconnected];
    await Promise.all(
      toDisconnect.map(async (id) => {
        const entry = this.servers.get(id);
        if (!entry) return;
        this.servers.delete(id);
        await this.closeEntry(entry);
      }),
    );

    const toConnect = [...added, ...reconnected];
    if (toConnect.length > 0) {
      const needStdio = toConnect.some(
        (id) => (nextServers[id].type ?? "stdio") === "stdio",
      );
      const sdk = await this.loadSdk(needStdio);
      if (sdk) {
        await Promise.all(
          toConnect.map((id) => this.addServer(id, nextServers[id], sdk)),
        );
      }
    }

    if (!this.started && Object.keys(nextServers).length > 0) {
      this.started = true;
    }

    this.emitChange();
    return { added, removed, unchanged, reconnected };
  }

  getTools(): McpTool[] {
    if (!this.enabled) return [];
    const out: McpTool[] = [];
    for (const entry of this.servers.values()) {
      for (const tool of entry.tools) out.push(tool);
    }
    return out;
  }

  getTool(prefixedName: string): McpTool | null {
    const parsed = parseMcpToolName(prefixedName);
    if (!parsed) return null;
    const entry = this.servers.get(parsed.serverId);
    return entry?.tools.find((t) => t.name === prefixedName) ?? null;
  }

  getToolsForServer(serverId: string): McpTool[] {
    return [...(this.servers.get(serverId)?.tools ?? [])];
  }

  hasServer(serverId: string): boolean {
    const entry = this.servers.get(serverId);
    return !!entry?.client && !entry.error;
  }

  async callTool(prefixedName: string, args: unknown): Promise<unknown> {
    const parsed = parseMcpToolName(prefixedName);
    if (!parsed) {
      throw new Error(
        `Tool name "${prefixedName}" does not look like an MCP tool (expected mcp__<server>__<tool>)`,
      );
    }
    const entry = this.servers.get(parsed.serverId);
    if (!entry || !entry.client) {
      throw new Error(
        `MCP server "${parsed.serverId}" is not connected${
          entry?.error ? `: ${entry.error}` : ""
        }`,
      );
    }
    return this.withExpiredSessionRetry(entry, (current) => {
      const known = current.tools.find((t) => t.name === prefixedName);
      if (!known) {
        throw new Error(
          `MCP server "${parsed.serverId}" does not expose tool "${parsed.toolName}"`,
        );
      }
      return current.client.callTool({
        name: parsed.toolName,
        arguments:
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {},
      });
    });
  }

  async readResource(serverId: string, uri: string): Promise<unknown> {
    if (!uri.startsWith("ui://")) {
      throw new Error(`Only ui:// MCP App resources can be read by this host`);
    }
    const entry = this.servers.get(serverId);
    if (!entry || !entry.client) {
      throw new Error(
        `MCP server "${serverId}" is not connected${
          entry?.error ? `: ${entry.error}` : ""
        }`,
      );
    }
    return this.withExpiredSessionRetry(entry, (current) => {
      if (typeof current.client.readResource === "function") {
        return current.client.readResource({ uri });
      }
      if (typeof current.client.request === "function") {
        return current.client.request({
          method: "resources/read",
          params: { uri },
        });
      }
      throw new Error(
        `MCP server "${serverId}" does not support resources/read`,
      );
    });
  }

  async readResourceForTool(
    prefixedName: string,
    uri: string,
  ): Promise<unknown> {
    const parsed = parseMcpToolName(prefixedName);
    if (!parsed) {
      throw new Error(
        `Tool name "${prefixedName}" does not look like an MCP tool (expected mcp__<server>__<tool>)`,
      );
    }
    return this.readResource(parsed.serverId, uri);
  }

  async stop(): Promise<void> {
    const task = this.reconfigureQueue.then(async () => {
      const entries = Array.from(this.servers.values());
      this.servers.clear();
      this.started = false;
      await Promise.all(entries.map((entry) => this.closeEntry(entry)));
    });
    this.reconfigureQueue = task.catch(() => {
      /* failures surface on the caller, not on the queue */
    });
    await task;
  }

  getStatus(): {
    configuredServers: string[];
    connectedServers: string[];
    totalTools: number;
    tools: Array<{ source: string; name: string; description: string }>;
    errors: Record<string, string>;
  } {
    const tools = this.getTools().map((t) => ({
      source: t.source,
      name: t.name,
      description: t.description,
    }));
    const errors: Record<string, string> = {};
    for (const entry of this.servers.values()) {
      if (entry.error) errors[entry.id] = entry.error;
    }
    return {
      configuredServers: this.configuredServers,
      connectedServers: this.connectedServers,
      totalTools: tools.length,
      tools,
      errors,
    };
  }

  private shouldInjectFirstPartyIdentity(entry: ServerEntry): boolean {
    return this.firstPartyTrust(entry) !== null;
  }

  private firstPartyTrust(
    entry: ServerEntry,
  ): { orgId: string; appId: string; url: string } | null {
    if (entry.config.type !== "http" || entry.config.firstParty !== true) {
      return null;
    }
    const parsed = parseMergedKey(entry.id);
    if (parsed?.scope !== "org") return null;
    return {
      orgId: entry.config.firstPartyOrgId ?? parsed.owner,
      appId: entry.config.firstPartyAppId ?? parsed.name,
      url: entry.config.url,
    };
  }
}

function removeAuthorizationHeaders(headers: Record<string, string>): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "authorization") delete headers[key];
  }
}

function headersToRecord(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return Object.fromEntries(value.entries());
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((entry) => Array.isArray(entry) && entry.length >= 2)
        .map(([key, headerValue]) => [String(key), String(headerValue)]),
    );
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, headerValue]) => [key, String(headerValue)],
      ),
    );
  }
  return {};
}

async function buildFirstPartyRequestInit(
  staticHeaders: Record<string, string>,
  rawInit: unknown,
  trust: { orgId: string; appId: string; url: string } | null,
): Promise<RequestInit> {
  const init =
    rawInit && typeof rawInit === "object" ? (rawInit as RequestInit) : {};
  const headers = {
    ...headersToRecord(staticHeaders),
    ...headersToRecord(init.headers),
  };
  removeAuthorizationHeaders(headers);
  const token = await mintFirstPartyMcpIdentityToken(trust).catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["x-agent-native-mcp-inline-apps"] = "1";
  return { ...init, headers };
}

function randomJti(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

const FIRST_PARTY_TRUST_TTL_MS = 60_000;
const FIRST_PARTY_TRUST_FAILURE_TTL_MS = 10_000;
const ORG_SIGNING_CONTEXT_TTL_MS = 60_000;

const firstPartyTrustCache = new Map<
  string,
  { ok: boolean; expiresAt: number }
>();
const orgSigningContextCache = new Map<
  string,
  { orgDomain?: string; orgSecret?: string; expiresAt: number }
>();

async function isFirstPartyTrustCached(trust: {
  orgId: string;
  appId: string;
  url: string;
}): Promise<boolean> {
  const key = `${trust.orgId}\n${trust.appId}\n${trust.url}`;
  const cached = firstPartyTrustCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.ok;
  const result = await isFirstPartyRemoteEndpointTrusted(
    trust.orgId,
    trust.appId,
    trust.url,
  );
  const ok = result.ok === true;
  firstPartyTrustCache.set(key, {
    ok,
    expiresAt:
      Date.now() +
      (ok ? FIRST_PARTY_TRUST_TTL_MS : FIRST_PARTY_TRUST_FAILURE_TTL_MS),
  });
  return ok;
}

async function resolveOrgSigningContext(orgId: string): Promise<{
  orgDomain?: string;
  orgSecret?: string;
}> {
  const cached = orgSigningContextCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return { orgDomain: cached.orgDomain, orgSecret: cached.orgSecret };
  }
  let orgDomain: string | undefined;
  let orgSecret: string | undefined;
  try {
    const { getOrgDomain, getOrgA2ASecret } = await import("../org/context.js");
    orgDomain = (await getOrgDomain(orgId)) ?? undefined;
    orgSecret = (await getOrgA2ASecret(orgId)) ?? undefined;
  } catch {
    // Global A2A_SECRET remains the hosted/common path.
  }
  orgSigningContextCache.set(orgId, {
    orgDomain,
    orgSecret,
    expiresAt: Date.now() + ORG_SIGNING_CONTEXT_TTL_MS,
  });
  return { orgDomain, orgSecret };
}

async function mintFirstPartyMcpIdentityToken(
  trust: { orgId: string; appId: string; url: string } | null,
): Promise<string | null> {
  if (!trust) return null;
  const [{ getRequestOrgId, getRequestUserEmail }, { signA2AToken }] =
    await Promise.all([
      import("../server/request-context.js"),
      import("../a2a/client.js"),
    ]);
  const userEmail = getRequestUserEmail();
  const requestOrgId = getRequestOrgId();
  if (requestOrgId && requestOrgId !== trust.orgId) {
    return null;
  }
  const orgId = requestOrgId ?? trust.orgId;
  if (!orgId) return null;
  if (!(await isFirstPartyTrustCached({ ...trust, orgId }))) return null;

  const { orgDomain, orgSecret } = await resolveOrgSigningContext(orgId);
  const subject =
    userEmail && requestOrgId
      ? userEmail
      : (await import("../mcp/connect-store.js")).serviceIdentityEmail(
          "mcp-client",
          orgId,
        );

  return signA2AToken(subject, orgDomain, orgSecret, {
    expiresIn: "5m",
    audience: firstPartyMcpAudienceForUrl(trust.url),
    preferGlobalSecret: !orgSecret,
    extraClaims: {
      jti: randomJti(),
      scope: "mcp-connect",
      org_id: orgId,
      agent_native_first_party_mcp: true,
    },
  });
}

function firstPartyMcpAudienceForUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/_agent-native/mcp")) {
      url.pathname = `${pathname.slice(0, -"/_agent-native/mcp".length)}/mcp`;
    } else {
      url.pathname = pathname.endsWith("/mcp") ? pathname : `${pathname}/mcp`;
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}
