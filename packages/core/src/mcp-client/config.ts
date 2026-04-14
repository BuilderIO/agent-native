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
import path from "node:path";
import os from "node:os";
import { findWorkspaceRoot } from "../scripts/utils.js";

export interface McpServerConfig {
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

export interface McpConfig {
  /** Map of server id → config */
  servers: Record<string, McpServerConfig>;
  /** Where the config was loaded from (workspace root path, app path, or "env") */
  source?: string;
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
      if (typeof c.command !== "string" || !c.command) continue;
      valid[id] = {
        command: c.command,
        args: Array.isArray(c.args) ? c.args.map(String) : undefined,
        env:
          c.env && typeof c.env === "object"
            ? Object.fromEntries(
                Object.entries(c.env).map(([k, v]) => [k, String(v)]),
              )
            : undefined,
        cwd: typeof c.cwd === "string" ? c.cwd : undefined,
        description:
          typeof c.description === "string" ? c.description : undefined,
      };
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

  if (fileConfig) return fileConfig;
  return envConfig;
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
