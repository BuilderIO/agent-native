/**
 * McpClientManager — spawns configured MCP servers over stdio, enumerates
 * their tools, and exposes a flat tool registry prefixed with
 * `mcp__<server-id>__` so the agent's tool-use loop can call them.
 *
 * The manager is a strict no-op in non-Node runtimes (Cloudflare Workers,
 * browsers) — `start()` resolves immediately, `getTools()` returns `[]`.
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

export class McpClientManager {
  private readonly servers: Map<string, ServerEntry> = new Map();
  private readonly debug: boolean;
  private started = false;

  constructor(
    private readonly config: McpConfig | null,
    options: McpClientManagerOptions = {},
  ) {
    this.debug = !!options.debug;
  }

  /** True when MCP client support is active (Node runtime + non-empty config). */
  get enabled(): boolean {
    return (
      isNode() && !!this.config && Object.keys(this.config.servers).length > 0
    );
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
   * Connect to each configured MCP server over stdio and enumerate tools.
   * Individual server failures are logged and skipped — the manager stays
   * usable with whichever servers did come up.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.enabled) return;

    // Dynamic imports so non-Node bundles don't pull in the SDK or node:child_process
    let Client: any;
    let StdioClientTransport: any;
    try {
      const clientMod =
        await import("@modelcontextprotocol/sdk/client/index.js");
      const stdioMod =
        await import("@modelcontextprotocol/sdk/client/stdio.js");
      Client = clientMod.Client;
      StdioClientTransport = stdioMod.StdioClientTransport;
    } catch (err: any) {
      console.warn(
        `[mcp-client] Failed to load MCP SDK: ${err?.message ?? err}. MCP tools disabled.`,
      );
      return;
    }

    const entries = Object.entries(this.config!.servers);
    await Promise.all(
      entries.map(async ([id, cfg]) => {
        const entry: ServerEntry = {
          id,
          config: cfg,
          client: null,
          transport: null,
          tools: [],
        };
        this.servers.set(id, entry);
        try {
          await this.connectServer(entry, Client, StdioClientTransport);
          console.log(
            `[mcp-client] connected to ${id}: ${entry.tools.length} tools`,
          );
        } catch (err: any) {
          entry.error = err?.message ?? String(err);
          console.warn(
            `[mcp-client] failed to connect to ${id}: ${entry.error}`,
          );
        }
      }),
    );
  }

  private async connectServer(
    entry: ServerEntry,
    Client: any,
    StdioClientTransport: any,
  ): Promise<void> {
    const { command, args = [], env, cwd } = entry.config;

    // Merge env — spawn receives only the keys we pass, so include process.env
    // by default to preserve PATH, HOME, etc.
    const mergedEnv = env ? { ...process.env, ...env } : { ...process.env };

    const transport = new StdioClientTransport({
      command,
      args,
      env: mergedEnv as Record<string, string>,
      cwd,
    });

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
