#!/usr/bin/env tsx
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";
import { extractOAuthStateAppId } from "../shared/oauth-state.js";

export interface WorkspaceApp {
  id: string;
  name: string;
  dir: string;
  port: number;
  process?: ChildProcess;
  restartTimer?: NodeJS.Timeout;
  restartAttempts?: number;
  /**
   * Set true once we've successfully connected to the upstream. After that we
   * skip the readiness probe on every request; the child server stays
   * listening for the rest of the dev session.
   */
  ready?: boolean;
}

export interface WorkspaceDevOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  root?: string;
  spawnProcess?: typeof spawn;
  openBrowser?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export interface WorkspaceDevHandle {
  apps: WorkspaceApp[];
  defaultApp: string;
  gatewayUrl: () => string;
  ready: Promise<{ port: number; url: string }>;
  server: http.Server;
  shutdown: () => void;
}

const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 8080;
const DEFAULT_APP_PORT_START = 8100;
const PROXY_READY_RETRY_DELAY_MS = 250;
const APP_RESTART_MAX_DELAY_MS = 10_000;

export function shouldEagerStartWorkspaceApps(
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    args.includes("--eager") ||
    env.WORKSPACE_EAGER === "1" ||
    env.WORKSPACE_EAGER === "true"
  );
}

export function initialWorkspaceAppIds(
  apps: Array<Pick<WorkspaceApp, "id">>,
  defaultApp: string,
  eager: boolean,
  startDefault = true,
): string[] {
  if (eager) return apps.map((app) => app.id);
  if (!startDefault) return [];
  return apps.some((app) => app.id === defaultApp) ? [defaultApp] : [];
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function discoverApps(appsDir: string, appPortStart: number): WorkspaceApp[] {
  if (!fs.existsSync(appsDir)) return [];
  // existsSync -> readdirSync is a TOCTOU race. Treat ENOENT as "no apps
  // right now" and let the polling sync recover.
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(appsDir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(
        `[workspace] Could not read ${appsDir} (${code ?? "unknown"}): ` +
          `${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: { handled: "dev-discover-readdir" },
        level: "warning",
      });
    }
    return [];
  }
  return entries
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
    .sort(compareApps)
    .map((app, index) => ({ ...app, port: appPortStart + index }));
}

function compareApps(a: Pick<WorkspaceApp, "id">, b: Pick<WorkspaceApp, "id">) {
  if (a.id === "dispatch") return -1;
  if (b.id === "dispatch") return 1;
  return a.id.localeCompare(b.id);
}

function isChildDevServerUrlLine(line: string): boolean {
  return /^\s*->\s+(?:Local|Network):\s+https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/\S*)?\s*$/i.test(
    line.replace(/\u279c/g, "->"),
  );
}

function pipeAppOutput(
  prefix: string,
  chunk: unknown,
  write: (value: string) => void,
): void {
  const lines = String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !isChildDevServerUrlLine(line));
  if (lines.length === 0) return;
  write(lines.map((line) => `${prefix} ${line}`).join("\n") + "\n");
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

function appRestartDelay(attempts: number): number {
  return Math.min(
    1_000 * 2 ** Math.max(0, attempts - 1),
    APP_RESTART_MAX_DELAY_MS,
  );
}

function probePort(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

function firstHeaderValue(
  value: string | string[] | number | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (value === undefined) return undefined;
  return String(value);
}

function wantsHtml(req: http.IncomingMessage): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const accept = firstHeaderValue(req.headers.accept);
  if (!accept) return false;
  return accept.includes("text/html");
}

function renderStartingApp(app: WorkspaceApp): string {
  const escapedName = escapeHtml(app.name || app.id);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="1" />
    <title>Starting ${escapedName}</title>
    <style>
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #171717; }
      main { width: min(420px, calc(100vw - 48px)); }
      .bar { height: 3px; overflow: hidden; border-radius: 999px; background: #e5e5e5; }
      .bar::before { content: ""; display: block; height: 100%; width: 42%; border-radius: inherit; background: #171717; animation: load 1s ease-in-out infinite; }
      p { color: #737373; }
      @keyframes load { 0% { transform: translateX(-105%); } 100% { transform: translateX(245%); } }
    </style>
    <script>setTimeout(() => window.location.reload(), 900);</script>
  </head>
  <body>
    <main>
      <div class="bar"></div>
      <h1>Starting ${escapedName}</h1>
      <p>The workspace gateway is waking this app's dev server.</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function renderIndex(apps: WorkspaceApp[]): string {
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
      <p class="muted">Open an app below. Dispatch is the workspace control plane when installed.</p>
      <div class="grid">
        ${apps
          .map(
            (app) =>
              `<a class="card" href="/${app.id}"><strong>${escapeHtml(app.name)}</strong><span class="muted">/${escapeHtml(app.id)}</span></a>`,
          )
          .join("")}
      </div>
    </main>
  </body>
</html>`;
}

export function runWorkspaceDev(
  options: WorkspaceDevOptions = {},
): WorkspaceDevHandle {
  const args = options.args ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const root = options.root ?? process.cwd();
  const appsDir = path.join(root, "apps");
  const spawnProcess = options.spawnProcess ?? spawn;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const gatewayHost = env.WORKSPACE_HOST || DEFAULT_GATEWAY_HOST;
  const requestedPort = Number(
    env.WORKSPACE_PORT || env.PORT || DEFAULT_GATEWAY_PORT,
  );
  const appPortStart = Number(
    env.WORKSPACE_APP_PORT_START || DEFAULT_APP_PORT_START,
  );
  const forceVite = env.WORKSPACE_VITE_FORCE === "1";
  const eager = shouldEagerStartWorkspaceApps(args, env);
  const proxyReadyTimeoutMs = Number(
    env.WORKSPACE_PROXY_READY_TIMEOUT_MS ?? 30_000,
  );
  let gatewayUrl = `http://${gatewayHost}:${requestedPort}`;

  const apps = discoverApps(appsDir, appPortStart);
  if (apps.length === 0) {
    throw new Error("[workspace] No apps found under ./apps");
  }

  const appById = new Map(apps.map((app) => [app.id, app]));
  const explicitDefaultApp =
    env.WORKSPACE_DEFAULT_APP && appById.has(env.WORKSPACE_DEFAULT_APP)
      ? env.WORKSPACE_DEFAULT_APP
      : null;
  const hasDispatch = appById.has("dispatch");
  const defaultApp =
    explicitDefaultApp ?? (hasDispatch ? "dispatch" : apps[0].id);
  const redirectRootToDefault = Boolean(explicitDefaultApp || hasDispatch);

  let syncTimer: NodeJS.Timeout | undefined;
  let shuttingDown = false;
  let workspaceStarted = false;

  let readyResolve: (value: { port: number; url: string }) => void;
  const ready = new Promise<{ port: number; url: string }>((resolve) => {
    readyResolve = resolve;
  });

  function workspaceAppsJson(): string {
    return JSON.stringify(
      apps.map((workspaceApp) => ({
        id: workspaceApp.id,
        name: workspaceApp.name,
        path: `/${workspaceApp.id}`,
      })),
    );
  }

  function syncApps(): void {
    const discovered = discoverApps(appsDir, appPortStart);
    for (const app of discovered) {
      const existing = appById.get(app.id);
      if (existing) {
        existing.name = app.name;
        existing.dir = app.dir;
        continue;
      }
      const usedPorts = new Set(apps.map((existingApp) => existingApp.port));
      let port = appPortStart;
      while (usedPorts.has(port)) port++;
      const next = { ...app, port };
      apps.push(next);
      apps.sort(compareApps);
      appById.set(next.id, next);
      stdout.write(`[workspace] Detected new app: /${next.id}\n`);
    }
  }

  function scheduleSync(): void {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(syncApps, 400);
  }

  function appForRequest(req: http.IncomingMessage): WorkspaceApp | null {
    const params = new URL(req.url || "/", "http://workspace.local")
      .searchParams;
    const explicit = params.get("_app");
    if (explicit && appById.has(explicit)) return appById.get(explicit) ?? null;

    const direct = firstPathSegment(req.url);
    if (direct && appById.has(direct)) return appById.get(direct) ?? null;

    const fromState = extractOAuthStateAppId(params.get("state"));
    if (fromState && appById.has(fromState)) {
      return appById.get(fromState) ?? null;
    }

    const referer = req.headers.referer;
    const fromReferer =
      typeof referer === "string" ? firstPathSegment(referer) : null;
    return fromReferer && appById.has(fromReferer)
      ? (appById.get(fromReferer) ?? null)
      : null;
  }

  function startApp(app: WorkspaceApp): void {
    if (app.process && !app.process.killed) return;
    if (app.restartTimer) {
      clearTimeout(app.restartTimer);
      app.restartTimer = undefined;
    }

    const basePath = `/${app.id}`;
    const child = spawnProcess(
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
        ...(forceVite ? ["--force"] : []),
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...env,
          APP_NAME: app.id,
          AGENT_NATIVE_WORKSPACE: "1",
          AGENT_NATIVE_WORKSPACE_APPS_JSON: workspaceAppsJson(),
          APP_BASE_PATH: basePath,
          VITE_AGENT_NATIVE_WORKSPACE: "1",
          VITE_APP_BASE_PATH: basePath,
          PORT: String(app.port),
          WORKSPACE_GATEWAY_URL: gatewayUrl,
        },
      },
    );
    app.process = child;

    const prefix = `[${app.id}]`;
    const stableTimer = setTimeout(() => {
      app.restartAttempts = 0;
    }, 5_000);
    stableTimer.unref();

    child.stdout?.on("data", (chunk) => {
      pipeAppOutput(prefix, chunk, (value) => stdout.write(value));
    });
    child.stderr?.on("data", (chunk) => {
      pipeAppOutput(prefix, chunk, (value) => stderr.write(value));
    });
    child.on("exit", (code) => {
      clearTimeout(stableTimer);
      app.process = undefined;
      app.ready = false;
      if (code === 0 || shuttingDown) return;
      app.restartAttempts = (app.restartAttempts ?? 0) + 1;
      const delay = appRestartDelay(app.restartAttempts);
      stderr.write(
        `${prefix} exited with code ${code}; retrying in ${Math.round(
          delay / 1000,
        )}s\n`,
      );
      app.restartTimer = setTimeout(() => {
        app.restartTimer = undefined;
        startApp(app);
      }, delay);
      app.restartTimer.unref();
    });
  }

  function forwardedProto(req: http.IncomingMessage): string {
    return (
      firstHeaderValue(req.headers["x-forwarded-proto"]) ||
      ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http")
    );
  }

  function forwardedHost(req: http.IncomingMessage): string {
    return (
      firstHeaderValue(req.headers["x-forwarded-host"]) ||
      firstHeaderValue(req.headers.host) ||
      new URL(gatewayUrl).host
    );
  }

  function proxyHeaders(
    req: http.IncomingMessage,
    targetHost: string,
  ): http.OutgoingHttpHeaders {
    return {
      ...req.headers,
      "x-forwarded-host": forwardedHost(req),
      "x-forwarded-proto": forwardedProto(req),
      host: targetHost,
    };
  }

  async function waitForPort(port: number, deadline: number): Promise<boolean> {
    while (Date.now() < deadline) {
      if (await probePort(port)) return true;
      await new Promise((r) => setTimeout(r, PROXY_READY_RETRY_DELAY_MS));
    }
    return false;
  }

  function proxyHttp(
    app: WorkspaceApp,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const cold = !app.process || app.process.killed;
    startApp(app);

    if (!app.ready && wantsHtml(req)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(renderStartingApp(app));
      return;
    }

    const dispatch = () => {
      const headers = proxyHeaders(req, `127.0.0.1:${app.port}`);
      const proxyReq = http.request(
        {
          hostname: "127.0.0.1",
          port: app.port,
          method: req.method,
          path: req.url,
          headers,
        },
        (proxyRes) => {
          app.ready = true;
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );

      proxyReq.on("error", (err) => {
        if (res.headersSent) {
          res.end();
          return;
        }
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`App "${app.id}" is not ready yet: ${err.message}`);
      });

      req.pipe(proxyReq);
    };

    // Fast path: the upstream has accepted at least one request before, so
    // it's listening. Skip the probe so steady-state requests stay zero-latency.
    if (app.ready && !cold) {
      dispatch();
      return;
    }

    // Cold path: hold non-HTML requests open while the child server boots.
    // Node keeps the request body paused until pipe() attaches.
    void waitForPort(app.port, Date.now() + proxyReadyTimeoutMs).then(
      (ready) => {
        if (!ready) {
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "text/plain" });
            res.end(
              `App "${app.id}" is not ready yet: connect ECONNREFUSED 127.0.0.1:${app.port}`,
            );
          } else {
            res.end();
          }
          return;
        }
        app.ready = true;
        dispatch();
      },
    );
  }

  function proxyUpgrade(
    app: WorkspaceApp,
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    startApp(app);
    void waitForPort(app.port, Date.now() + proxyReadyTimeoutMs).then(
      (ready) => {
        if (!ready) {
          socket.destroy();
          return;
        }
        app.ready = true;
        const target = net.connect(app.port, "127.0.0.1", () => {
          const headers = Object.entries(
            proxyHeaders(req, `127.0.0.1:${app.port}`),
          )
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
      },
    );
  }

  function handleWatcherError(err: NodeJS.ErrnoException): void {
    if (err.code === "ENOSPC") {
      stderr.write(
        `[workspace] Recursive file watcher hit the system limit (ENOSPC). ` +
          `New apps will still be detected via polling every ~2s. ` +
          `On Linux you can raise the limit with ` +
          `\`sudo sysctl fs.inotify.max_user_watches=524288\` ` +
          `(persist via /etc/sysctl.d/*.conf). On macOS/Windows this usually ` +
          `means too many other watchers are running.\n`,
      );
      Sentry.captureException(err, {
        tags: { handled: "dev-watch-enospc" },
        level: "warning",
      });
      return;
    }
    if (err.code === "ENOENT") {
      return;
    }
    stderr.write(
      `[workspace] Recursive file watcher failed (${err.code ?? "unknown"}): ${err.message}. ` +
        `Falling back to polling.\n`,
    );
    Sentry.captureException(err, {
      tags: { handled: "dev-watch-unknown" },
      level: "warning",
    });
  }

  function startWorkspaceProcesses(): void {
    if (workspaceStarted) return;
    workspaceStarted = true;
    for (const id of initialWorkspaceAppIds(
      apps,
      defaultApp,
      eager,
      redirectRootToDefault,
    )) {
      const app = appById.get(id);
      if (app) startApp(app);
    }
    try {
      const watcher = fs.watch(appsDir, { recursive: true }, scheduleSync);
      watcher.on("error", (err) => {
        handleWatcherError(err as NodeJS.ErrnoException);
      });
    } catch (err) {
      handleWatcherError(err as NodeJS.ErrnoException);
    }
    setInterval(syncApps, 2_000).unref();
  }

  function openBrowser(url: string): void {
    if (options.openBrowser === false || env.WORKSPACE_NO_OPEN === "1") return;
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const openArgs =
      process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawnProcess(command, openArgs, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  }

  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      if (redirectRootToDefault) {
        res.writeHead(302, { location: `/${defaultApp}` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderIndex(apps));
      return;
    }

    if (req.url === "/_workspace/apps") {
      syncApps();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          apps.map((app) => ({
            id: app.id,
            name: app.name,
            path: `/${app.id}`,
            port: app.port,
            running: Boolean(app.process && !app.process.killed),
          })),
        ),
      );
      return;
    }

    let app = appForRequest(req);
    if (!app) {
      syncApps();
      app = appForRequest(req);
    }
    if (!app) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(renderIndex(apps));
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
      stderr.write(`[workspace] Could not start gateway: ${err.message}\n`);
      throw err;
    });
    server.listen(port, gatewayHost, () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address ? address.port : port;
      gatewayUrl = `http://${gatewayHost}:${actualPort}`;
      stdout.write(
        `[workspace] Default: ${redirectRootToDefault ? `${gatewayUrl}/${defaultApp}` : gatewayUrl}\n`,
      );
      stdout.write(`[workspace] Gateway: ${gatewayUrl}\n`);
      stdout.write(`[workspace] Mode: ${eager ? "eager" : "lazy"}\n`);
      for (const app of apps) {
        stdout.write(
          `[workspace] ${app.id}: /${app.id} -> 127.0.0.1:${app.port}\n`,
        );
      }
      startWorkspaceProcesses();
      openBrowser(
        redirectRootToDefault ? `${gatewayUrl}/${defaultApp}` : gatewayUrl,
      );
      readyResolve({ port: actualPort, url: gatewayUrl });
    });
  }

  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    for (const app of apps) {
      app.process?.kill("SIGTERM");
    }
    if (syncTimer) clearTimeout(syncTimer);
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  }

  const handleSigint = () => shutdown();
  const handleSigterm = () => shutdown();
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  listen(requestedPort);

  return {
    apps,
    defaultApp,
    gatewayUrl: () => gatewayUrl,
    ready,
    server,
    shutdown,
  };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  try {
    runWorkspaceDev({ args: process.argv.slice(2) });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
