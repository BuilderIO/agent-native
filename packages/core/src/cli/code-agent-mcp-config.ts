import type { McpConfig, McpServerConfig } from "../mcp-client/config.js";

const DESKTOP_MCP_ALLOWLIST_ENV =
  "AGENT_NATIVE_CODE_AGENT_MCP_SERVER_ALLOWLIST";

function parseServerAllowlist(raw: string | undefined): Set<string> | null {
  if (raw === undefined) return null;
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

/**
 * Keep a desktop coding run on the app registry's MCP servers. The normal
 * server-side manager merges persisted MCP settings for web requests, but a
 * local shell must not inherit arbitrary user MCP servers when the desktop
 * host has supplied an explicit workspace allowlist.
 */
export function restrictCodeAgentMcpConfig(
  config: McpConfig | null,
  environment: NodeJS.ProcessEnv = process.env,
): McpConfig | null {
  const allowlist = parseServerAllowlist(
    environment[DESKTOP_MCP_ALLOWLIST_ENV],
  );
  if (!allowlist || !config) return config;

  const servers = Object.fromEntries(
    Object.entries(config.servers).filter(([id]) => allowlist.has(id)),
  );
  return { ...config, servers };
}

function codexConfigKey(serverId: string): string {
  const normalized = serverId.replace(/[^A-Za-z0-9_-]/g, "_");
  return normalized || "workspace";
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlInlineTable(headers: Record<string, string>): string {
  return `{${Object.entries(headers)
    .map(([key, value]) => `${tomlString(key)}=${tomlString(value)}`)
    .join(",")}}`;
}

function parseMcpServers(
  environment: NodeJS.ProcessEnv,
): Record<string, McpServerConfig> {
  const raw = environment.MCP_SERVERS?.trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("MCP_SERVERS is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP_SERVERS must contain a servers object.");
  }
  const serverMap =
    "servers" in parsed &&
    parsed.servers &&
    typeof parsed.servers === "object" &&
    !Array.isArray(parsed.servers)
      ? (parsed.servers as Record<string, unknown>)
      : (parsed as Record<string, unknown>);
  return Object.fromEntries(
    Object.entries(serverMap).map(([id, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`MCP_SERVERS entry ${id} is invalid.`);
      }
      return [id, value];
    }),
  ) as Record<string, McpServerConfig>;
}

/**
 * Add host-provided app/plugin servers to the normal merged config. The
 * filesystem and environment layers have different precedence rules, so the
 * child process combines them explicitly instead of silently dropping one.
 */
export function mergeCodeAgentMcpConfig(
  config: McpConfig | null,
  environment: NodeJS.ProcessEnv = process.env,
): McpConfig | null {
  const environmentServers = parseMcpServers(environment);
  if (Object.keys(environmentServers).length === 0) return config;
  return {
    ...(config ?? { servers: {} }),
    servers: {
      ...(config?.servers ?? {}),
      ...environmentServers,
    },
    source: config?.source
      ? `${config.source}+desktop-environment`
      : "env:MCP_SERVERS",
  };
}

/**
 * Convert the host-scoped HTTP MCP config into Codex CLI's `-c` overrides.
 * The caller adds `--ignore-user-config` in the `exec` segment so a local
 * coding session receives the workspace apps, not the user's global MCP
 * catalog.
 */
export function codexMcpConfigArgs(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const servers = parseMcpServers(environment);
  if (Object.keys(servers).length === 0) return [];
  const args: string[] = [];
  for (const [serverId, server] of Object.entries(servers)) {
    if (server.type !== "http" || !server.url) continue;
    const key = codexConfigKey(serverId);
    args.push(
      "-c",
      `mcp_servers.${tomlString(key)}.url=${tomlString(server.url)}`,
    );
    if (server.headers && Object.keys(server.headers).length > 0) {
      args.push(
        "-c",
        `mcp_servers.${tomlString(key)}.http_headers=${tomlInlineTable(server.headers)}`,
      );
    }
  }
  return args;
}
