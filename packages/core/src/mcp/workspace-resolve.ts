/**
 * Workspace / app resolution for the MCP stdio transport + builtin tools.
 *
 * Node-only. Never bundled into the serverless function — only the local
 * `agent-native mcp` CLI path and the in-process standalone builder use it.
 *
 * Resolution model (mirrors `cli/workspace-dev.ts`):
 *
 *   - Workspace root  = nearest ancestor whose package.json has
 *     `agent-native.workspaceCore` set, with an `apps/` dir.
 *   - Gateway         = `http://127.0.0.1:<WORKSPACE_PORT|PORT|8080>`.
 *   - Per-app ports   = the gateway's `/_workspace/apps` JSON (authoritative,
 *     accounts for port reservation when 8100+ are taken). Fallback when the
 *     gateway isn't up yet: discover `apps/*` dirs and assign `8100 + index`
 *     in the same sorted order `discoverApps` uses (dispatch first).
 *   - Standalone (no workspace) = the single app at the cwd; dev server on
 *     `PORT` (default Vite 5173 / framework dev). The app id is the package
 *     name's last path segment.
 */

import fs from "node:fs";
import path from "node:path";

export interface ResolvedApp {
  id: string;
  /** Local origin where this app's dev server listens, e.g. http://127.0.0.1:8100 */
  url: string;
  port: number;
  /** True when a TCP probe to the port succeeds. */
  running: boolean;
}

export interface ResolvedWorkspace {
  /** Workspace root dir, or the standalone app dir. */
  root: string;
  /** True when `root` is a multi-app workspace (has apps/ + workspaceCore). */
  isWorkspace: boolean;
  /** Gateway origin (workspace) — undefined for standalone single app. */
  gatewayUrl?: string;
  /** Discovered apps. For standalone this is a single entry. */
  apps: ResolvedApp[];
}

const DEFAULT_GATEWAY_PORT = 8080;
const DEFAULT_APP_PORT_START = 8100;

/** Walk up from `startDir` for a package.json with `agent-native.workspaceCore`. */
export function findWorkspaceRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const wsCore = pkg?.["agent-native"]?.workspaceCore;
        if (
          typeof wsCore === "string" &&
          wsCore.length > 0 &&
          fs.existsSync(path.join(dir, "apps"))
        ) {
          return dir;
        }
      } catch {
        // ignore unparsable package.json and keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Mirror of `cli/workspace-dev.ts`'s `compareApps` — dispatch first, then
 * alphabetical. Keeps the fallback port assignment aligned with the gateway's.
 */
function compareApps(a: { id: string }, b: { id: string }): number {
  if (a.id === "dispatch") return -1;
  if (b.id === "dispatch") return 1;
  return a.id.localeCompare(b.id);
}

function discoverAppDirs(
  appsDir: string,
  appPortStart: number,
): Array<{ id: string; port: number }> {
  if (!fs.existsSync(appsDir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(appsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ id: e.name }))
    .filter((a) => fs.existsSync(path.join(appsDir, a.id, "package.json")))
    .sort(compareApps)
    .map((a, index) => ({ id: a.id, port: appPortStart + index }));
}

function probePort(port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    import("node:net")
      .then(({ default: net }) => {
        const socket = new net.Socket();
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
        socket.once("timeout", () => finish(false));
        socket.connect(port, "127.0.0.1");
      })
      .catch(() => resolve(false));
  });
}

/** Fetch the gateway's authoritative apps list (ports may be reassigned). */
async function fetchGatewayApps(
  gatewayUrl: string,
): Promise<Array<{ id: string; port: number }> | null> {
  try {
    const res = await fetch(`${gatewayUrl}/_workspace/apps`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ id: string; port: number }>;
    if (!Array.isArray(json)) return null;
    return json
      .filter((a) => a && typeof a.id === "string")
      .map((a) => ({ id: a.id, port: Number(a.port) }));
  } catch {
    return null;
  }
}

/**
 * Resolve the workspace (or standalone app) the MCP server should bridge to.
 *
 * @param cwd       Working directory (defaults to process.cwd()).
 * @param env       Env (defaults to process.env). Reads WORKSPACE_PORT / PORT.
 */
export async function resolveWorkspace(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedWorkspace> {
  const root = findWorkspaceRoot(cwd);

  if (root) {
    const gatewayPort = Number(
      env.WORKSPACE_PORT || env.PORT || DEFAULT_GATEWAY_PORT,
    );
    const gatewayHost = env.WORKSPACE_HOST || "127.0.0.1";
    const gatewayUrl = `http://${gatewayHost}:${gatewayPort}`;
    const appPortStart = Number(
      env.WORKSPACE_APP_PORT_START || DEFAULT_APP_PORT_START,
    );

    // Prefer the gateway's authoritative list (handles port reassignment);
    // fall back to a filesystem scan with the same ordering the gateway uses.
    const fromGateway = await fetchGatewayApps(gatewayUrl);
    const discovered =
      fromGateway ?? discoverAppDirs(path.join(root, "apps"), appPortStart);

    const apps: ResolvedApp[] = await Promise.all(
      discovered.map(async (a) => ({
        id: a.id,
        port: a.port,
        url: `http://127.0.0.1:${a.port}`,
        running: await probePort(a.port),
      })),
    );

    return { root, isWorkspace: true, gatewayUrl, apps };
  }

  // Standalone single app — the cwd is the app.
  const pkg = readJson(path.join(cwd, "package.json"));
  const rawName: string =
    (typeof pkg?.name === "string" && pkg.name) ||
    path.basename(path.resolve(cwd));
  const id = rawName.replace(/^@[^/]+\//, "").replace(/^agent-native-/, "");
  const port = Number(env.PORT || 5173);
  return {
    root: path.resolve(cwd),
    isWorkspace: false,
    apps: [
      {
        id,
        port,
        url: `http://127.0.0.1:${port}`,
        running: await probePort(port),
      },
    ],
  };
}

/**
 * Resolve the local app the stdio proxy should connect its MCP HTTP client
 * to. Honours an explicit `--app` / appId and `--port` / explicit port.
 * Returns the chosen app's origin (where `/_agent-native/mcp` is mounted).
 *
 * Order of precedence:
 *   1. explicit `port` → http://127.0.0.1:<port>
 *   2. explicit `appId` matched against resolved apps
 *   3. workspace default (dispatch if present, else first app)
 *   4. standalone single app
 */
export async function resolveLocalAppOrigin(opts: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  appId?: string;
  port?: number;
}): Promise<{ origin: string; appId: string; ws: ResolvedWorkspace }> {
  const ws = await resolveWorkspace(opts.cwd, opts.env);

  if (opts.port) {
    const match = ws.apps.find((a) => a.port === opts.port);
    return {
      origin: `http://127.0.0.1:${opts.port}`,
      appId: match?.id ?? opts.appId ?? ws.apps[0]?.id ?? "app",
      ws,
    };
  }

  if (opts.appId) {
    const match = ws.apps.find((a) => a.id === opts.appId);
    if (match) return { origin: match.url, appId: match.id, ws };
    throw new Error(
      `App "${opts.appId}" not found. Available: ${
        ws.apps.map((a) => a.id).join(", ") || "(none)"
      }`,
    );
  }

  if (ws.apps.length === 0) {
    throw new Error(
      "No apps found. Run this from a workspace root (with apps/) or a single app directory.",
    );
  }

  const dispatch = ws.apps.find((a) => a.id === "dispatch");
  const chosen = dispatch ?? ws.apps[0];
  return { origin: chosen.url, appId: chosen.id, ws };
}
