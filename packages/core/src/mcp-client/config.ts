/**
 * MCP client configuration loading.
 *
 * Resolves `mcp.config.json` in the following precedence order:
 *   1. Workspace root (detected via `agent-native.workspaceCore` in package.json)
 *   2. App root (`process.cwd()`)
 *   3. `MCP_SERVERS` env var (JSON string) — for CI / production deploys
 *
 * Returns `null` when nothing is configured.
 *
 * This module is Node-only — it reads the filesystem. `loadMcpConfig()` guards
 * every fs operation with `isNode()` so a non-Node bundle simply gets `null`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findWorkspaceRoot } from "../scripts/utils.js";

/**
 * Stdio transport — spawns a local binary and speaks MCP over its stdio.
 * This is the default when no `type` field is set (backward compat).
 */
export interface McpStdioServerConfig {
  type?: "stdio";
  /** Executable or path to spawn over stdio */
  command: string;
  /** Arguments passed to the command */
  args?: string[];
  /** Extra env vars merged into process.env for the spawned server */
  env?: Record<string, string>;
  /** Optional working directory for the spawned process */
  cwd?: string;
  /** Human-readable description (optional, shown in /mcp/status) */
  description?: string;
}

/**
 * HTTP transport — connects to a remote MCP server over Streamable HTTP
 * (the transport hosted providers like Zapier / Cloudflare / Composio use).
 */
export interface McpHttpServerConfig {
  type: "http";
  /** Full URL of the remote MCP server's Streamable HTTP endpoint. */
  url: string;
  /** Extra headers to send with every request (e.g. Authorization). */
  headers?: Record<string, string>;
  /**
   * Trusted first-party Agent-Native app. This is set only by framework-owned
   * org-scoped registrations, not by raw file/env config.
   */
  firstParty?: boolean;
  /** Canonical first-party app id from the org directory, e.g. `assets`. */
  firstPartyAppId?: string;
  /**
   * Org id the first-party server is trusted for. Runtime-only metadata set by
   * framework-owned registrations; raw file/env config cannot provide it.
   */
  firstPartyOrgId?: string;
  /** Human-readable description (optional, shown in /mcp/status) */
  description?: string;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpConfig {
  /** Map of server id → config */
  servers: Record<string, McpServerConfig>;
  /** Where the config was loaded from (workspace root path, app path, or "env") */
  source?: string;
}

const DESKTOP_COMPUTER_SERVER_ID = "agent-native-desktop-computer";

function isNode(): boolean {
  return (
    typeof process !== "undefined" &&
    !!(process as any).versions?.node &&
    typeof (process as any).versions.node === "string"
  );
}

function parseConfig(raw: string, source: string): McpConfig | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const servers =
      parsed.servers && typeof parsed.servers === "object"
        ? (parsed.servers as Record<string, McpServerConfig>)
        : null;
    if (!servers) return null;
    const valid: Record<string, McpServerConfig> = {};
    for (const [id, cfg] of Object.entries(servers)) {
      if (!cfg || typeof cfg !== "object") continue;
      const c = cfg as any;
      const description =
        typeof c.description === "string" ? c.description : undefined;
      if (c.type === "http") {
        if (typeof c.url !== "string" || !c.url) continue;
        valid[id] = {
          type: "http",
          url: c.url,
          headers:
            c.headers && typeof c.headers === "object"
              ? Object.fromEntries(
                  Object.entries(c.headers).map(([k, v]) => [k, String(v)]),
                )
              : undefined,
          description,
        };
      } else {
        if (typeof c.command !== "string" || !c.command) continue;
        valid[id] = {
          type: "stdio",
          command: c.command,
          args: Array.isArray(c.args) ? c.args.map(String) : undefined,
          env:
            c.env && typeof c.env === "object"
              ? Object.fromEntries(
                  Object.entries(c.env).map(([k, v]) => [k, String(v)]),
                )
              : undefined,
          cwd: typeof c.cwd === "string" ? c.cwd : undefined,
          description,
        };
      }
    }
    if (Object.keys(valid).length === 0) return null;
    return { servers: valid, source };
  } catch {
    return null;
  }
}

/**
 * Load MCP configuration.
 *
 * @param startDir - Directory to start the upward search from (defaults to cwd)
 */
export function loadMcpConfig(startDir?: string): McpConfig | null {
  const envConfig = readEnvConfig();

  let fileConfig: McpConfig | null = null;
  if (isNode()) {
    try {
      fileConfig = readFileConfig(startDir);
    } catch {
      fileConfig = null;
    }
  }

  return mergeDesktopChildComputerConfig(fileConfig ?? envConfig);
}

/**
 * The desktop process supplies this configuration only to a child it spawned
 * for a specific Agent run. Raw MCP config cannot opt into this trust path:
 * the explicit child gate, loopback URL, and strong per-run bearer are all
 * required. Existing user servers always win on key collisions.
 */
function mergeDesktopChildComputerConfig(
  base: McpConfig | null,
): McpConfig | null {
  if (process.env.AGENT_NATIVE_DESKTOP_CHILD !== "1") return base;
  const url = process.env.AGENT_NATIVE_DESKTOP_COMPUTER_MCP_URL?.trim();
  const token = process.env.AGENT_NATIVE_DESKTOP_COMPUTER_MCP_TOKEN?.trim();
  if (!url || !token || !/^[A-Za-z0-9_-]{32,}$/.test(token)) return base;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.pathname !== "/mcp" ||
      parsed.username ||
      parsed.password
    ) {
      return base;
    }
  } catch {
    return base;
  }
  const servers = { ...(base?.servers ?? {}) };
  let serverId = DESKTOP_COMPUTER_SERVER_ID;
  for (let suffix = 2; servers[serverId]; suffix += 1) {
    serverId = `${DESKTOP_COMPUTER_SERVER_ID}-${suffix}`;
  }
  servers[serverId] = {
    type: "http",
    url,
    headers: { Authorization: `Bearer ${token}` },
    description:
      "Authenticated computer control for this Agent Native desktop task",
  };
  return {
    servers,
    source: base?.source ? `${base.source}+desktop-child` : "desktop-child",
  };
}

function readEnvConfig(): McpConfig | null {
  if (typeof process === "undefined") return null;
  const raw = process.env?.MCP_SERVERS;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  // Try full shape first ({ servers: {...} })
  const full = parseConfig(trimmed, "env:MCP_SERVERS");
  if (full) return full;
  // Then try inner-map shape ({ <id>: {...} })
  return parseConfig(`{"servers":${trimmed}}`, "env:MCP_SERVERS");
}

function readFileConfig(startDir?: string): McpConfig | null {
  const cwd = startDir ?? process.cwd();

  const workspaceRoot = findWorkspaceRoot(cwd);
  if (workspaceRoot) {
    const wsConfigPath = path.join(workspaceRoot, "mcp.config.json");
    if (fs.existsSync(wsConfigPath)) {
      return parseConfig(fs.readFileSync(wsConfigPath, "utf-8"), wsConfigPath);
    }
  }

  const appConfigPath = path.join(cwd, "mcp.config.json");
  if (fs.existsSync(appConfigPath)) {
    return parseConfig(fs.readFileSync(appConfigPath, "utf-8"), appConfigPath);
  }

  return null;
}

/**
 * Auto-detect the claude-in-chrome MCP server if it's installed but no
 * config file exists. Gated by `AGENT_NATIVE_DISABLE_MCP_AUTODETECT`.
 *
 * Returns a synthesized config pointing at the detected binary, or `null`
 * when nothing is found or auto-detect is disabled.
 */
export function autoDetectMcpConfig(): McpConfig | null {
  if (!isNode()) return null;
  if (process.env.AGENT_NATIVE_DISABLE_MCP_AUTODETECT) return null;

  const candidates: string[] = [];

  const home = os.homedir();
  if (home) {
    candidates.push(
      path.join(home, ".claude-in-chrome", "bin", "claude-in-chrome-mcp"),
    );
  }

  const pathEnv = process.env.PATH || "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exeSuffix = process.platform === "win32" ? ".exe" : "";
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    candidates.push(path.join(dir, `claude-in-chrome-mcp${exeSuffix}`));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return {
          servers: {
            "claude-in-chrome": {
              type: "stdio",
              command: candidate,
              description:
                "Auto-detected claude-in-chrome MCP server (Chrome automation)",
            },
          },
          source: `autodetect:${candidate}`,
        };
      }
    } catch {
      // Keep trying other candidates
    }
  }

  return null;
}
