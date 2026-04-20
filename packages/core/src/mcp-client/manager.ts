/**
 * McpClientManager — connects to configured MCP servers (stdio or remote
 * Streamable HTTP), enumerates their tools, and exposes a flat tool registry
 * prefixed with `mcp__<server-id>__` so the agent's tool-use loop can call them.
 *
 * Stdio servers are a strict no-op in non-Node runtimes (Cloudflare Workers,
 * browsers). HTTP servers work in any runtime with `fetch`; `reconfigure()`
 * lets callers add or remove servers at runtime without restarting the process.
 */

import type { McpConfig, McpServerConfig } from "./config.js";

export const MCP_TOOL_PREFIX = "mcp__";

export interface McpTool {
  /** Server id the tool belongs to */
  source: string;
  /** Prefixed tool name (e.g. "mcp__claude-in-chrome__navigate") */
  name: string;
  /** Original name as reported by the MCP server */
  originalName: string;
  /** Human-readable description */
  description: string;
  /** JSON-Schema input spec forwarded verbatim from the server */
  inputSchema: Record<string, unknown>;
}

interface ServerEntry {
  id: string;
  config: McpServerConfig;
  client: any | null;
  transport: any | null;
  tools: McpTool[];
  error?: string;
}

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

/**
 * Parse a prefixed tool name back into its server id and original tool name.
 * Returns `null` if the name doesn't match the MCP prefix convention.
 */
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
  /** Emit debug logs on startup */
  debug?: boolean;
}

function sameServerConfig(a: McpServerConfig, b: McpServerConfig): boolean {
  const typeA = a.type ?? "stdio";
  const typeB = b.type ?? "stdio";
  if (typeA !== typeB) return false;
  if (typeA === "http" && b.type === "http" && a.type === "http") {
    return (
      a.url === b.url &&
      JSON.stringify(a.headers ?? {}) === JSON.stringify(b.headers ?? {})
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

type SdkModules = {
  Client: any;
  StdioClientTransport: any | null;
  StreamableHTTPClientTransport: any | null;
};

export class McpClientManager {
  private readonly servers: Map<string, ServerEntry> = new Map();
  private readonly debug: boolean;
  private started = false;
  private config: McpConfig | null;
  private sdk: SdkModules | null = null;
  private readonly listeners: Set<() => void> = new Set();

  constructor(config: McpConfig | null, options: McpClientManagerOptions = {}) {
    this.config = config;
    this.debug = !!options.debug;
  }

  /** True when the manager has any configured servers. */
  get enabled(): boolean {
    return !!this.config && Object.keys(this.config.servers).length > 0;
  }

  /** List of configured server ids (whether or not they're connected). */
  get configuredServers(): string[] {
    if (!this.config) return [];
    return Object.keys(this.config.servers);
  }

  /** List of server ids that successfully connected and enumerated tools. */
  get connectedServers(): string[] {
    return Array.from(this.servers.values())
      .filter((s) => s.client && !s.error)
      .map((s) => s.id);
  }

  /**
   * Load MCP SDK modules lazily so non-Node bundles don't pull them in.
   * Stdio transport is only loaded when a stdio server is actually configured.
   */
  private async loadSdk(needStdio: boolean): Promise<SdkModules | null> {
    if (this.sdk) {
      // If we previously loaded without stdio and now need it, top up.
      if (needStdio && !this.sdk.StdioClientTransport && isNode()) {
        try {
          const stdioMod =
            await import("@modelcontextprotocol/sdk/client/stdio.js");
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
      const clientMod =
        await import("@modelcontextprotocol/sdk/client/index.js");
      const httpMod =
        await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      let StdioClientTransport: any = null;
      if (needStdio && isNode()) {
        try {
          const stdioMod =
            await import("@modelcontextprotocol/sdk/client/stdio.js");
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
        StreamableHTTPClientTransport: httpMod.StreamableHTTPClientTransport,
      };
      return this.sdk;
    } catch (err: any) {
      console.warn(
        `[mcp-client] Failed to load MCP SDK: ${err?.message ?? err}. MCP tools disabled.`,
      );
      return null;
    }
  }

  /**
   * Subscribe to tool-set changes (e.g. after `reconfigure()` adds/removes
   * servers). The listener is called *after* connect/disconnect completes.
   * Returns an unsubscribe function.
   */
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
   */
  async start(): Promise<void> {
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

  /**
   * Create a new ServerEntry and attempt to connect. Logs and records errors
   * on the entry rather than throwing — callers iterate many servers.
   */
  private async addServer(
    id: string,
    cfg: McpServerConfig,
    sdk: SdkModules,
  ): Promise<void> {
    const entry: ServerEntry = {
      id,
      config: cfg,
      client: null,
      transport: null,
      tools: [],
    };
    this.servers.set(id, entry);
    try {
      await this.connectServer(entry, sdk);
      console.log(
        `[mcp-client] connected to ${id}: ${entry.tools.length} tools`,
      );
    } catch (err: any) {
      entry.error = err?.message ?? String(err);
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
      if (cfg.headers && Object.keys(cfg.headers).length > 0) {
        requestInit.headers = cfg.headers;
      }
      transport = new sdk.StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit,
      });
    } else {
      if (!sdk.StdioClientTransport) {
        throw new Error(
          "Stdio transport not available (needs Node runtime with MCP SDK)",
        );
      }
      const { command, args = [], env, cwd } = cfg;
      // Merge env — spawn receives only the keys we pass, so include process.env
      // by default to preserve PATH, HOME, etc.
      const mergedEnv = env ? { ...process.env, ...env } : { ...process.env };
      transport = new sdk.StdioClientTransport({
        command,
        args,
        env: mergedEnv as Record<string, string>,
        cwd,
      });
    }

    const client = new Client(
      { name: "agent-native-mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    const listed = await client.listTools();
    const rawTools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }> = (listed?.tools ?? []) as any[];

    entry.client = client;
    entry.transport = transport;
    entry.tools = rawTools.map((t) => ({
      source: entry.id,
      name: buildPrefixedName(entry.id, t.name),
      originalName: t.name,
      description: t.description ?? t.name,
      inputSchema: (t.inputSchema ?? {
        type: "object",
        properties: {},
      }) as Record<string, unknown>,
    }));
  }

  /**
   * Replace the configured server set. Servers that appear in the new config
   * under a different shape are reconnected; unchanged entries stay live;
   * removed entries are disconnected. Safe to call while `start()` is in
   * flight or after it has completed.
   *
   * Returns a summary describing what happened for logging / UI feedback.
   */
  async reconfigure(newConfig: McpConfig | null): Promise<{
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

    // Remove entries that vanished or changed shape.
    for (const id of Object.keys(prevServers)) {
      if (!(id in nextServers)) {
        removed.push(id);
      } else if (!sameServerConfig(prevServers[id], nextServers[id])) {
        reconnected.push(id);
      } else {
        unchanged.push(id);
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
        try {
          if (entry.client?.close) await entry.client.close();
        } catch {
          // ignore
        }
        try {
          if (entry.transport?.close) await entry.transport.close();
        } catch {
          // ignore
        }
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

    // If the manager was never started (e.g. empty initial config) but now has
    // servers, mark it started so subsequent start() calls don't duplicate work.
    if (!this.started && Object.keys(nextServers).length > 0) {
      this.started = true;
    }

    this.emitChange();
    return { added, removed, unchanged, reconnected };
  }

  /** Flattened tool list across all connected servers. */
  getTools(): McpTool[] {
    if (!this.enabled) return [];
    const out: McpTool[] = [];
    for (const entry of this.servers.values()) {
      for (const tool of entry.tools) out.push(tool);
    }
    return out;
  }

  /**
   * Invoke an MCP tool by prefixed name. Routes to the owning server based on
   * the `mcp__<serverId>__` prefix.
   */
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
    // Look up the tool so we fail loud for unknown names instead of forwarding
    // garbage through to the server.
    const known = entry.tools.find((t) => t.name === prefixedName);
    if (!known) {
      throw new Error(
        `MCP server "${parsed.serverId}" does not expose tool "${parsed.toolName}"`,
      );
    }
    const result = await entry.client.callTool({
      name: parsed.toolName,
      arguments:
        args && typeof args === "object"
          ? (args as Record<string, unknown>)
          : {},
    });
    return result;
  }

  /** Cleanly close all MCP clients and child processes. */
  async stop(): Promise<void> {
    const entries = Array.from(this.servers.values());
    this.servers.clear();
    this.started = false;
    await Promise.all(
      entries.map(async (entry) => {
        try {
          if (entry.client?.close) await entry.client.close();
        } catch {
          // ignore
        }
        try {
          if (entry.transport?.close) await entry.transport.close();
        } catch {
          // ignore
        }
      }),
    );
  }

  /** Diagnostic snapshot used by `/_agent-native/mcp/status`. */
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
}
