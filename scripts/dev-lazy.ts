#!/usr/bin/env node
/**
 * Lazy root template gateway for framework development.
 *
 * This is the repo-root counterpart to `agent-native dev` in generated
 * workspaces: expose one local origin, mount templates at /<template>, and
 * start each template server only when something requests it.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";

interface TemplateApp {
  id: string;
  name: string;
  description: string;
  dir: string;
  port: number;
  core: boolean;
  process?: ChildProcess;
  restartTimer?: NodeJS.Timeout;
  restartAttempts?: number;
  ready?: boolean;
  readinessProbe?: Promise<void>;
}

const argv = process.argv.slice(2);
const ROOT = path.resolve(".");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const CONFIG_PATH = path.join(ROOT, "packages/shared-app-config/templates.ts");
const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 8080;
const PROXY_READY_RETRY_DELAY_MS = 250;
const APP_RESTART_MAX_DELAY_MS = 10_000;
const APP_IFRAME_ALLOW = "camera; microphone; display-capture; fullscreen";
const POLLING_WATCH_INTERVAL_MS = "1000";

function hasFlag(name: string): boolean {
  return argv.includes(name);
}

function flagValue(name: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("-")
    ? argv[i + 1]
    : null;
}

function printHelp(): void {
  console.log(`dev-lazy

Start a lazy template gateway for framework repo development.

Usage:
  node scripts/dev-lazy.ts [options]

Options:
  --apps <names>       Comma-separated templates to expose (default: core)
  --apps=<names>       Same as --apps <names>
  --all                Expose every template in packages/shared-app-config
  --desktop            Also start the clips-desktop tray (Tauri)
  --eager              Start every exposed template immediately
  --open               Open the gateway URL in the browser on ready
  --no-open            (legacy / no-op — auto-open is off by default)
  --no-kill            Do not kill stale processes on gateway/template ports
  --dry-run            Print ports and commands without spawning
  -h, --help           Show this help message

Examples:
  pnpm dev:lazy
  pnpm dev:lazy -- --apps dispatch,mail,calendar
  pnpm dev:lazy:desktop`);
}

if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}

function readTemplateApps(): TemplateApp[] {
  const src = fs.readFileSync(CONFIG_PATH, "utf8");
  const entries = src
    .split(/\n\s*\},\s*\n/)
    .map((entry) => {
      const name = entry.match(/name:\s*"([^"]+)"/)?.[1];
      const label = entry.match(/label:\s*"([^"]+)"/)?.[1];
      const hint = entry.match(/hint:\s*"([^"]+)"/)?.[1];
      const description = entry.match(/description:\s*"([^"]+)"/)?.[1];
      const port = entry.match(/devPort:\s*(\d+)/)?.[1];
      if (!name || !label || !port) return null;
      const dir = path.join(TEMPLATES_DIR, name);
      if (!fs.existsSync(path.join(dir, "package.json"))) return null;
      return {
        id: name,
        name: label,
        description: description ?? hint ?? "",
        dir,
        port: Number(port),
        core: /core:\s*true/.test(entry),
      } satisfies TemplateApp;
    })
    .filter((app): app is TemplateApp => !!app)
    .sort(compareApps);

  return entries;
}

function compareApps(
  a: Pick<TemplateApp, "id" | "name">,
  b: Pick<TemplateApp, "id" | "name">,
) {
  if (a.id === "dispatch") return -1;
  if (b.id === "dispatch") return 1;
  return a.name.localeCompare(b.name);
}

const allApps = readTemplateApps();
const appById = new Map(allApps.map((app) => [app.id, app]));
const requestedApps = (() => {
  if (hasFlag("--all")) return allApps;
  const appsArg = flagValue("--apps");
  if (!appsArg) return allApps.filter((app) => app.core);
  const ids = appsArg
    .split(",")
    .map((app) => app.trim())
    .filter(Boolean);
  const unknown = ids.filter((id) => !appById.has(id));
  if (unknown.length) {
    console.warn(`[dev-lazy] Unknown templates skipped: ${unknown.join(", ")}`);
  }
  return ids
    .map((id) => appById.get(id))
    .filter((app): app is TemplateApp => !!app);
})();

if (requestedApps.length === 0) {
  console.error("[dev-lazy] No templates selected.");
  process.exit(1);
}

const apps = requestedApps.sort(compareApps);
const selectedById = new Map(apps.map((app) => [app.id, app]));
const includeDesktop = hasFlag("--desktop");
const eager = hasFlag("--eager");
const dryRun = hasFlag("--dry-run");
const isHeadlessEnv =
  process.env.CI === "1" ||
  process.env.CI === "true" ||
  !!process.env.BUILDER_IO_DEV_SERVER ||
  !!process.env.BUILDER_PROJECT_ID ||
  !!process.env.CODESPACES ||
  !!process.env.GITPOD_WORKSPACE_ID;
const shouldOpen =
  (hasFlag("--open") || process.env.WORKSPACE_OPEN === "1") &&
  !hasFlag("--no-open") &&
  process.env.WORKSPACE_NO_OPEN !== "1" &&
  !isHeadlessEnv;
const shouldKill = !hasFlag("--no-kill");
const gatewayHost = process.env.WORKSPACE_HOST || DEFAULT_GATEWAY_HOST;
const requestedGatewayPort = Number(
  process.env.WORKSPACE_PORT || process.env.PORT || DEFAULT_GATEWAY_PORT,
);
const proxyReadyTimeoutMs = Number(
  process.env.WORKSPACE_PROXY_READY_TIMEOUT_MS ?? 30_000,
);
let gatewayUrl = `http://${gatewayHost}:${requestedGatewayPort}`;
const defaultApp = selectedById.has("dispatch") ? "dispatch" : apps[0].id;
const backgroundProcesses: ChildProcess[] = [];
let shuttingDown = false;
let gatewayServer: http.Server | undefined;

function readBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function shouldUsePollingFileWatcher(
  env: NodeJS.ProcessEnv,
  root: string,
): boolean {
  const explicit =
    readBooleanEnv(env.AGENT_NATIVE_DEV_USE_POLLING) ??
    readBooleanEnv(env.WORKSPACE_USE_POLLING_WATCHER);
  if (explicit !== undefined) return explicit;

  const chokidarExplicit = readBooleanEnv(env.CHOKIDAR_USEPOLLING);
  if (chokidarExplicit !== undefined) return chokidarExplicit;

  return Boolean(
    env.BUILDER_IO_DEV_SERVER ||
    env.BUILDER_PROJECT_ID ||
    env.BUILDER_WORKSPACE_ID ||
    env.CODESPACES ||
    env.GITPOD_WORKSPACE_ID ||
    env.REMOTE_CONTAINERS ||
    env.DEVCONTAINER ||
    root.startsWith("/root/app/"),
  );
}

const usePollingFileWatcher = shouldUsePollingFileWatcher(process.env, ROOT);

function devWatcherEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (usePollingFileWatcher) {
    return {
      ...env,
      CHOKIDAR_USEPOLLING: "1",
      CHOKIDAR_INTERVAL: env.CHOKIDAR_INTERVAL ?? POLLING_WATCH_INTERVAL_MS,
      TSC_WATCHFILE: env.TSC_WATCHFILE ?? "DynamicPriorityPolling",
      TSC_WATCHDIRECTORY: env.TSC_WATCHDIRECTORY ?? "DynamicPriorityPolling",
    };
  }
  // Explicit disable must override inherited CHOKIDAR_USEPOLLING from the
  // parent shell so child processes don't silently poll despite the user
  // setting AGENT_NATIVE_DEV_USE_POLLING=0. Strip the watcher vars instead
  // of returning env unchanged.
  const {
    CHOKIDAR_USEPOLLING: _polling,
    CHOKIDAR_INTERVAL: _interval,
    TSC_WATCHFILE: _watchFile,
    TSC_WATCHDIRECTORY: _watchDir,
    ...rest
  } = env;
  return rest;
}

function workspaceAppsJson(): string {
  return JSON.stringify(
    apps.map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      path: `/${app.id}`,
      url: `${gatewayUrl}/${app.id}`,
      isDispatch: app.id === "dispatch",
    })),
  );
}

// Strip ANSI SGR escapes so downstream regex matches work after FORCE_COLOR=1
// makes children emit colored output (vite wraps the URL bullet in green, etc.).
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[\d;]*[A-Za-z]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_REGEX, "");
}

// Stable per-name prefix coloring so [tray]/[core]/[dispatch] are easy to scan
// the same way concurrently colors prefixes in dev:all. Codes are SGR foreground
// values; the palette skips black/white/red to avoid low contrast and "looks
// like an error" false signals.
const PREFIX_PALETTE = [33, 34, 35, 36, 32, 95, 94, 96, 92, 93];
const prefixColors = new Map<string, number>();

function colorPrefix(name: string): string {
  let code = prefixColors.get(name);
  if (code === undefined) {
    code = PREFIX_PALETTE[prefixColors.size % PREFIX_PALETTE.length];
    prefixColors.set(name, code);
  }
  return `\x1b[${code}m[${name}]\x1b[0m`;
}

function isChildDevServerUrlLine(line: string): boolean {
  return /^\s*->\s+(?:Local|Network):\s+https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/\S*)?\s*$/i.test(
    stripAnsi(line).replace(/\u279c/g, "->"),
  );
}

function pipeOutput(
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

function renderStartingApp(app: TemplateApp): string {
  const escapedName = escapeHtml(app.name);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="1" />
    <title>Starting ${escapedName}</title>
    <meta name="color-scheme" content="light dark" />
    <style>
      :root { --bg: #fafafa; --fg: #171717; --muted: #737373; --bar-bg: #e5e5e5; --bar-fill: #171717; }
      @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; --bar-bg: #262626; --bar-fill: #fafafa; } }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); }
      main { width: min(420px, calc(100vw - 48px)); }
      .bar { height: 3px; overflow: hidden; border-radius: 999px; background: var(--bar-bg); }
      .bar::before { content: ""; display: block; height: 100%; width: 42%; border-radius: inherit; background: var(--bar-fill); animation: load 1s ease-in-out infinite; }
      p { color: var(--muted); }
      @keyframes load { 0% { transform: translateX(-105%); } 100% { transform: translateX(245%); } }
    </style>
    <script>setTimeout(() => window.location.reload(), 900);</script>
  </head>
  <body>
    <main>
      <div class="bar"></div>
      <h1>Starting ${escapedName}</h1>
      <p>The lazy template gateway is waking this app's dev server.</p>
    </main>
  </body>
</html>`;
}

function renderIndex(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent-Native Templates</title>
    <meta name="color-scheme" content="light dark" />
    <style>
      :root { --bg: #fafafa; --fg: #171717; --muted: #737373; --card-bg: #ffffff; --card-border: #d4d4d4; }
      @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; --card-bg: #171717; --card-border: #262626; } }
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: var(--bg); color: var(--fg); }
      main { max-width: 760px; margin: 0 auto; }
      a { color: inherit; text-decoration: none; }
      .grid { display: grid; gap: 12px; margin-top: 20px; }
      .card { display: flex; justify-content: space-between; gap: 16px; border: 1px solid var(--card-border); border-radius: 8px; padding: 14px 16px; background: var(--card-bg); }
      .muted { color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <h1>Agent-Native Templates</h1>
      <p class="muted">Open a template below. Dispatch is the default control plane when selected.</p>
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

function firstPathSegment(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "http://templates.local");
    const [segment] = parsed.pathname.split("/").filter(Boolean);
    return segment || null;
  } catch {
    return null;
  }
}

function extractOAuthStateAppId(
  state: string | null | undefined,
): string | undefined {
  if (!state) return undefined;
  try {
    const dotIdx = state.lastIndexOf(".");
    if (dotIdx === -1) return undefined;
    const data = state.slice(0, dotIdx);
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString());
    return typeof parsed.app === "string" ? parsed.app : undefined;
  } catch {
    return undefined;
  }
}

function appForRequest(req: http.IncomingMessage): TemplateApp | null {
  const params = new URL(req.url || "/", "http://templates.local").searchParams;
  const explicit = params.get("_app");
  if (explicit && selectedById.has(explicit))
    return selectedById.get(explicit) ?? null;

  const direct = firstPathSegment(req.url);
  if (direct && selectedById.has(direct))
    return selectedById.get(direct) ?? null;

  const fromState = extractOAuthStateAppId(params.get("state"));
  if (fromState && selectedById.has(fromState)) {
    return selectedById.get(fromState) ?? null;
  }

  const referer = req.headers.referer;
  const fromReferer =
    typeof referer === "string" ? firstPathSegment(referer) : null;
  return fromReferer && selectedById.has(fromReferer)
    ? (selectedById.get(fromReferer) ?? null)
    : null;
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

async function waitForPort(port: number, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (await probePort(port)) return true;
    await new Promise((resolve) =>
      setTimeout(resolve, PROXY_READY_RETRY_DELAY_MS),
    );
  }
  return false;
}

function ensureReadinessProbe(app: TemplateApp): void {
  if (app.ready || app.readinessProbe) return;
  app.readinessProbe = waitForPort(app.port, Date.now() + proxyReadyTimeoutMs)
    .then((ready) => {
      if (ready) app.ready = true;
    })
    .finally(() => {
      app.readinessProbe = undefined;
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

function startApp(app: TemplateApp): void {
  if (app.process && !app.process.killed) return;
  if (app.restartTimer) {
    clearTimeout(app.restartTimer);
    app.restartTimer = undefined;
  }

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
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: devWatcherEnv({
        ...process.env,
        // Children write to a pipe (not a TTY), so vite/pnpm/chalk/picocolors
        // skip colors by default. FORCE_COLOR=1 re-enables them — the parent's
        // stdout is a TTY, so ANSI codes pass straight through to the user.
        FORCE_COLOR: "1",
        APP_NAME: app.id,
        AGENT_NATIVE_WORKSPACE: "1",
        AGENT_NATIVE_WORKSPACE_APPS_JSON: workspaceAppsJson(),
        APP_BASE_PATH: basePath,
        VITE_AGENT_NATIVE_WORKSPACE: "1",
        VITE_APP_BASE_PATH: basePath,
        PORT: String(app.port),
        WORKSPACE_GATEWAY_URL: gatewayUrl,
      }),
    },
  );

  app.process = child;
  const prefix = colorPrefix(app.id);
  const stableTimer = setTimeout(() => {
    app.restartAttempts = 0;
  }, 5_000);
  stableTimer.unref();

  child.stdout?.on("data", (chunk) =>
    pipeOutput(prefix, chunk, (value) => process.stdout.write(value)),
  );
  child.stderr?.on("data", (chunk) =>
    pipeOutput(prefix, chunk, (value) => process.stderr.write(value)),
  );
  child.on("exit", (code) => {
    clearTimeout(stableTimer);
    app.process = undefined;
    app.ready = false;
    app.readinessProbe = undefined;
    if (code === 0 || shuttingDown) return;
    app.restartAttempts = (app.restartAttempts ?? 0) + 1;
    const delay = appRestartDelay(app.restartAttempts);
    process.stderr.write(
      `${prefix} exited with code ${code}; retrying in ${Math.round(delay / 1000)}s\n`,
    );
    app.restartTimer = setTimeout(() => {
      app.restartTimer = undefined;
      startApp(app);
    }, delay);
    app.restartTimer.unref();
  });
}

function proxyHttp(
  app: TemplateApp,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const cold = !app.process || app.process.killed;
  startApp(app);

  if (!app.ready && wantsHtml(req)) {
    ensureReadinessProbe(app);
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
      res.end(`Template "${app.id}" is not ready yet: ${err.message}`);
    });

    req.pipe(proxyReq);
  };

  if (app.ready && !cold) {
    dispatch();
    return;
  }

  void waitForPort(app.port, Date.now() + proxyReadyTimeoutMs).then((ready) => {
    if (!ready) {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(
          `Template "${app.id}" is not ready yet: connect ECONNREFUSED 127.0.0.1:${app.port}`,
        );
      } else {
        res.end();
      }
      return;
    }
    app.ready = true;
    dispatch();
  });
}

function proxyUpgrade(
  app: TemplateApp,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  startApp(app);
  void waitForPort(app.port, Date.now() + proxyReadyTimeoutMs).then((ready) => {
    if (!ready) {
      socket.destroy();
      return;
    }
    app.ready = true;
    const target = net.connect(app.port, "127.0.0.1", () => {
      const headers = Object.entries(proxyHeaders(req, `127.0.0.1:${app.port}`))
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
  });
}

function workspaceAppsPayload(): string {
  return JSON.stringify(
    apps.map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      path: `/${app.id}`,
      url: `${gatewayUrl}/${app.id}`,
      port: app.port,
      running: Boolean(app.process && !app.process.killed),
      isDispatch: app.id === "dispatch",
    })),
  );
}

function createGateway(): http.Server {
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || "/", "http://templates.local");
    const pathname = parsedUrl.pathname;

    if (pathname === "/" || pathname === "/index.html") {
      if (selectedById.has(defaultApp)) {
        res.writeHead(302, {
          location: `/${defaultApp}${parsedUrl.search}`,
        });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderIndex());
      return;
    }

    if (pathname === "/_workspace/apps") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(workspaceAppsPayload());
      return;
    }

    const app = appForRequest(req);
    if (!app) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
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

  return server;
}

function killPort(port: number): void {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    if (pids) {
      execSync(`kill -9 ${pids.split("\n").join(" ")}`, { stdio: "ignore" });
    }
  } catch {
    // Port not in use.
  }
}

function openBrowser(url: string): void {
  if (!shouldOpen) return;
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const openArgs =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, openArgs, {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      console.warn(
        `[dev-lazy] Could not auto-open browser (${command} not installed). Open ${url} manually.`,
      );
    } else {
      console.warn(`[dev-lazy] Failed to auto-open browser: ${err.message}`);
    }
  });
  child.unref();
}

function startBackgroundProcess(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: devWatcherEnv({ ...env, FORCE_COLOR: "1" }),
    shell: process.platform === "win32",
  });
  backgroundProcesses.push(child);
  const prefix = colorPrefix(name);
  child.stdout?.on("data", (chunk) =>
    pipeOutput(prefix, chunk, (value) => process.stdout.write(value)),
  );
  child.stderr?.on("data", (chunk) =>
    pipeOutput(prefix, chunk, (value) => process.stderr.write(value)),
  );
  child.on("exit", (code) => {
    if (shuttingDown) return;
    process.stderr.write(`${prefix} exited with code ${code ?? 0}\n`);
    if (name === "tray") shutdown(0);
  });
  return child;
}

function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  gatewayServer?.close();
  for (const app of apps) {
    app.process?.kill("SIGTERM");
    if (app.restartTimer) clearTimeout(app.restartTimer);
  }
  for (const child of backgroundProcesses) {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const app of apps) {
      try {
        app.process?.kill("SIGKILL");
      } catch {}
    }
    for (const child of backgroundProcesses) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    process.exit(code);
  }, 1_000).unref();
}

if (dryRun) {
  console.log(`[dev-lazy] Gateway: ${gatewayUrl}`);
  console.log(`[dev-lazy] Mode: ${eager ? "eager" : "lazy"}`);
  if (usePollingFileWatcher) {
    console.log(
      `[dev-lazy] Watch mode: polling (${POLLING_WATCH_INTERVAL_MS}ms)`,
    );
  }
  for (const app of apps) {
    console.log(`[dev-lazy] ${app.id}: /${app.id} -> 127.0.0.1:${app.port}`);
  }
  if (includeDesktop) {
    console.log("[dev-lazy] tray: clips-desktop dev (Tauri)");
  }
  process.exit(0);
}

if (shouldKill) {
  const ports = [requestedGatewayPort, ...apps.map((app) => app.port)];
  for (const port of ports) killPort(port);
}

console.log("[dev-lazy] Prebuilding @agent-native/core...");
execSync("pnpm --filter @agent-native/core build", { stdio: "inherit" });

if (usePollingFileWatcher) {
  console.log(
    `[dev-lazy] Using polling file watchers (${POLLING_WATCH_INTERVAL_MS}ms) to avoid remote-container inotify limits.`,
  );
}

startBackgroundProcess("core", "pnpm", [
  "--filter",
  "@agent-native/core",
  "exec",
  "tsc",
  "--watch",
  "--preserveWatchOutput",
]);

const server = createGateway();
gatewayServer = server;

function listen(port: number, attempts = 20): void {
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attempts > 0) {
      listen(port + 1, attempts - 1);
      return;
    }
    console.error(`[dev-lazy] Could not start gateway: ${err.message}`);
    shutdown(1);
  });
  server.listen(port, gatewayHost, () => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : port;
    gatewayUrl = `http://${gatewayHost}:${actualPort}`;
    console.log(`[dev-lazy] Default: ${gatewayUrl}/${defaultApp}`);
    console.log(`[dev-lazy] Gateway: ${gatewayUrl}`);
    console.log(`[dev-lazy] Mode: ${eager ? "eager" : "lazy"}`);
    for (const app of apps) {
      console.log(`[dev-lazy] ${app.id}: /${app.id} -> 127.0.0.1:${app.port}`);
    }

    if (eager) {
      for (const app of apps) startApp(app);
    } else {
      const app = selectedById.get(defaultApp);
      if (app) startApp(app);
    }

    if (includeDesktop) {
      // Matches dev:all:desktop: boot the Tauri clips tray only. The Electron
      // desktop-app + its frame renderer are intentionally skipped here — they
      // require a working `electron` binary in node_modules and aren't what
      // anyone reaches for via dev:lazy:desktop.
      startBackgroundProcess("tray", "pnpm", [
        "--filter",
        "clips-desktop",
        "dev",
      ]);
    }

    openBrowser(`${gatewayUrl}/${defaultApp}`);
  });
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(sig, () => shutdown(sig === "SIGINT" ? 0 : 1));
}

listen(requestedGatewayPort);
