
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findWorkspaceRoot } from "../scripts/utils.js";

export interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  description?: string;
}

export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  firstParty?: boolean;
  firstPartyAppId?: string;
  firstPartyOrgId?: string;
  description?: string;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
  source?: string;
}

const DESKTOP_COMPUTER_SERVER_ID = "agent-native-desktop-computer";

export interface DesktopChildComputerMcpServer {
  id: string;
  config: McpHttpServerConfig;
}

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

export function resolveDesktopChildComputerMcpServer(
  existingServers: Record<string, McpServerConfig>,
  environment: NodeJS.ProcessEnv = process.env,
): DesktopChildComputerMcpServer | null {
  if (environment.AGENT_NATIVE_DESKTOP_CHILD !== "1") return null;
  const url = environment.AGENT_NATIVE_DESKTOP_COMPUTER_MCP_URL?.trim();
  const token = environment.AGENT_NATIVE_DESKTOP_COMPUTER_MCP_TOKEN?.trim();
  if (!url || !token || !/^[A-Za-z0-9_-]{32,}$/.test(token)) return null;
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/mcp" ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }
  let serverId = DESKTOP_COMPUTER_SERVER_ID;
  for (let suffix = 2; existingServers[serverId]; suffix += 1) {
    serverId = `${DESKTOP_COMPUTER_SERVER_ID}-${suffix}`;
  }
  return {
    id: serverId,
    config: {
      type: "http",
      url,
      headers: { Authorization: `Bearer ${token}` },
      description:
        "Authenticated computer control for this Agent-Native desktop task",
    },
  };
}

function mergeDesktopChildComputerConfig(
  base: McpConfig | null,
): McpConfig | null {
  const desktopServer = resolveDesktopChildComputerMcpServer(
    base?.servers ?? {},
  );
  if (!desktopServer) return base;
  return {
    servers: {
      ...(base?.servers ?? {}),
      [desktopServer.id]: desktopServer.config,
    },
    source: base?.source ? `${base.source}+desktop-child` : "desktop-child",
  };
}

function readEnvConfig(): McpConfig | null {
  if (typeof process === "undefined") return null;
  const raw = process.env?.MCP_SERVERS;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  const full = parseConfig(trimmed, "env:MCP_SERVERS");
  if (full) return full;
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
