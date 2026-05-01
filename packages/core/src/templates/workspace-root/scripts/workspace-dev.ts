#!/usr/bin/env tsx
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

interface WorkspaceApp {
  id: string;
  name: string;
  dir: string;
  port: number;
  process?: ChildProcess;
}

const root = process.cwd();
const appsDir = path.join(root, "apps");
const gatewayHost = process.env.WORKSPACE_HOST || "127.0.0.1";
const requestedPort = Number(
  process.env.WORKSPACE_PORT || process.env.PORT || 8080,
);
const appPortStart = Number(process.env.WORKSPACE_APP_PORT_START || 8100);
let gatewayUrl = `http://${gatewayHost}:${requestedPort}`;

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function discoverApps(): WorkspaceApp[] {
  if (!fs.existsSync(appsDir)) return [];
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(appsDir, entry.name);
      const pkg = readJson(path.join(dir, "package.json"));
      if (!pkg) return null;
      return {
        id: entry.name,
        name: pkg.displayName || pkg.name || entry.name,
        dir,
        port: appPortStart,
      } satisfies WorkspaceApp;
    })
    .filter((app): app is WorkspaceApp => !!app)
    .sort((a, b) => {
      if (a.id === "dispatch") return -1;
      if (b.id === "dispatch") return 1;
      return a.id.localeCompare(b.id);
    })
    .map((app, index) => ({ ...app, port: appPortStart + index }));
}

const apps = discoverApps();
if (apps.length === 0) {
  console.error("[workspace] No apps found under ./apps");
  process.exit(1);
}

const appById = new Map(apps.map((app) => [app.id, app]));
const defaultApp =
  process.env.WORKSPACE_DEFAULT_APP &&
  appById.has(process.env.WORKSPACE_DEFAULT_APP)
    ? process.env.WORKSPACE_DEFAULT_APP
    : appById.has("dispatch")
      ? "dispatch"
      : apps[0].id;

function syncApps(): void {
  const discovered = discoverApps();
  for (const app of discovered) {
    if (appById.has(app.id)) continue;
    const usedPorts = new Set(apps.map((existing) => existing.port));
    let port = appPortStart;
    while (usedPorts.has(port)) port++;
    const next = { ...app, port };
    apps.push(next);
    apps.sort((a, b) => {
      if (a.id === "dispatch") return -1;
      if (b.id === "dispatch") return 1;
      return a.id.localeCompare(b.id);
    });
    appById.set(next.id, next);
    console.log(`[workspace] Detected new app: /${next.id}`);
    startApp(next);
  }
}

let syncTimer: NodeJS.Timeout | undefined;
function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncApps, 400);
}

function firstPathSegment(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "http://workspace.local");
    const [segment] = parsed.pathname.split("/").filter(Boolean);
    return segment || null;
  } catch {
    return null;
  }
}

function appForRequest(req: http.IncomingMessage): WorkspaceApp | null {
  const direct = firstPathSegment(req.url);
  if (direct && appById.has(direct)) return appById.get(direct) ?? null;
  const referer = req.headers.referer;
  const fromReferer =
    typeof referer === "string" ? firstPathSegment(referer) : null;
  return fromReferer && appById.has(fromReferer)
    ? (appById.get(fromReferer) ?? null)
    : null;
}

function startApp(app: WorkspaceApp): void {
  const basePath = `/${app.id}`;
  const child = spawn(
    "pnpm",
    [
      "--dir",
      app.dir,
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(app.port),
      "--strictPort",
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        APP_NAME: app.id,
        APP_BASE_PATH: basePath,
        VITE_APP_BASE_PATH: basePath,
        AGENT_NATIVE_VITE_BASE_PATH: "/",
        PORT: String(app.port),
        WORKSPACE_GATEWAY_URL: gatewayUrl,
      },
    },
  );
  app.process = child;

  const prefix = `[${app.id}]`;
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(
      String(chunk)
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => `${prefix} ${line}`)
        .join("\n") + "\n",
    );
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(
      String(chunk)
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => `${prefix} ${line}`)
        .join("\n") + "\n",
    );
  });
  child.on("exit", (code) => {
    if (code === 0 || shuttingDown) return;
    console.error(`${prefix} exited with code ${code}`);
  });
}

function renderIndex(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent-Native Workspace</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #fafafa; color: #171717; }
      main { max-width: 760px; margin: 0 auto; }
      a { color: inherit; text-decoration: none; }
      .grid { display: grid; gap: 12px; margin-top: 20px; }
      .card { display: flex; justify-content: space-between; border: 1px solid #d4d4d4; border-radius: 8px; padding: 14px 16px; background: white; }
      .muted { color: #737373; }
    </style>
  </head>
  <body>
    <main>
      <h1>Agent-Native Workspace</h1>
      <p class="muted">Open an app below. Dispatch is the workspace control plane.</p>
      <div class="grid">
        ${apps
          .map(
            (app) =>
              `<a class="card" href="/${app.id}"><strong>${app.name}</strong><span class="muted">/${app.id}</span></a>`,
          )
          .join("")}
      </div>
    </main>
  </body>
</html>`;
}

function proxyHttp(
  app: WorkspaceApp,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const headers = { ...req.headers, host: `127.0.0.1:${app.port}` };
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: app.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`App "${app.id}" is not ready yet: ${err.message}`);
  });

  req.pipe(proxyReq);
}

function proxyUpgrade(
  app: WorkspaceApp,
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer,
): void {
  const target = net.connect(app.port, "127.0.0.1", () => {
    const headers = Object.entries({
      ...req.headers,
      host: `127.0.0.1:${app.port}`,
    })
      .flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map((item) => `${key}: ${item}`)
          : [`${key}: ${value ?? ""}`],
      )
      .join("\r\n");
    target.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`,
    );
    if (head.length) target.write(head);
    socket.pipe(target).pipe(socket);
  });

  target.on("error", () => socket.destroy());
}

let shuttingDown = false;
let workspaceStarted = false;

function startWorkspaceProcesses(): void {
  if (workspaceStarted) return;
  workspaceStarted = true;
  for (const app of apps) startApp(app);
  try {
    fs.watch(appsDir, { recursive: true }, scheduleSync);
  } catch {
    // Some platforms do not support recursive directory watches.
  }
  setInterval(syncApps, 2_000).unref();
}

function openBrowser(url: string): void {
  if (process.env.WORKSPACE_NO_OPEN === "1") return;
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(302, { location: `/${defaultApp}` });
    res.end();
    return;
  }

  if (req.url === "/_workspace/apps") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        apps.map((app) => ({
          id: app.id,
          name: app.name,
          path: `/${app.id}`,
          port: app.port,
        })),
      ),
    );
    return;
  }

  const app = appForRequest(req);
  if (!app) {
    res.writeHead(404, { "content-type": "text/html" });
    res.end(renderIndex());
    return;
  }
  proxyHttp(app, req, res);
});

server.on("upgrade", (req, socket, head) => {
  const app = appForRequest(req);
  if (!app) {
    socket.destroy();
    return;
  }
  proxyUpgrade(app, req, socket, head);
});

function listen(port: number, attempts = 20): void {
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attempts > 0) {
      listen(port + 1, attempts - 1);
      return;
    }
    console.error(`[workspace] Could not start gateway: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, gatewayHost, () => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : port;
    gatewayUrl = `http://${gatewayHost}:${actualPort}`;
    console.log(`[workspace] Gateway: http://${gatewayHost}:${actualPort}`);
    console.log(
      `[workspace] Default: http://${gatewayHost}:${actualPort}/${defaultApp}`,
    );
    for (const app of apps) {
      console.log(`[workspace] ${app.id}: /${app.id} -> 127.0.0.1:${app.port}`);
    }
    startWorkspaceProcesses();
    openBrowser(`http://${gatewayHost}:${actualPort}/${defaultApp}`);
  });
}

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  for (const app of apps) {
    app.process?.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 300).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

listen(requestedPort);
