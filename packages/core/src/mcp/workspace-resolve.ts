
import fs from "node:fs";
import path from "node:path";

export interface ResolvedApp {
  id: string;
  url: string;
  port: number;
  running: boolean;
}

export interface ResolvedWorkspace {
  root: string;
  isWorkspace: boolean;
  gatewayUrl?: string;
  apps: ResolvedApp[];
}

const DEFAULT_GATEWAY_PORT = 8080;
const DEFAULT_APP_PORT_START = 8100;

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
