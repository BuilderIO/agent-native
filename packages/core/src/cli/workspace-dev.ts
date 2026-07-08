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
import {
  DEFAULT_WORKSPACE_APP_AUDIENCE,
  workspaceAppAudienceFromPackageJson,
  workspaceAppRouteAccessFromPackageJson,
  type WorkspaceAppAudience,
} from "../shared/workspace-app-audience.js";
import {
  attachGatewaySocketErrorSink,
  normalizeOrigin,
  rewriteRedirectLocation,
  escapeHtml,
} from "./gateway-helpers.js";

export interface WorkspaceApp {
  id: string;
  name: string;
  description: string;
  audience: WorkspaceAppAudience;
  publicPaths: string[];
  protectedPaths: string[];
  dir: string;
  port: number;
  process?: ChildProcess;
  restartTimer?: NodeJS.Timeout;
  restartAttempts?: number;
  lastFailure?: {
    code: number | null;
    signal: NodeJS.Signals | null;
    at: number;
    installing: boolean;
    output: string;
    nextRetryAt: number;
  };
  outputTail?: string;
  installing?: boolean;
  installAttempted?: boolean;
  /**
   * Set true once we've successfully connected to the upstream. After that we
   * skip the readiness probe on every request; the child server stays
   * listening for the rest of the dev session.
   */
  ready?: boolean;
  readinessProbe?: Promise<void>;
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
const DEFAULT_PROXY_RESPONSE_TIMEOUT_MS = 5_000;
const DEFAULT_PROXY_NON_HTML_RESPONSE_TIMEOUT_MS = 120_000;
const APP_OUTPUT_TAIL_BYTES = 8_000;
const POLLING_WATCH_INTERVAL_MS = "1000";
const reportedDiscoverAppsReadFailures = new Set<string>();
const STARTING_APP_RESPONSE_HEADERS: http.OutgoingHttpHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, no-cache, max-age=0, must-revalidate",
  pragma: "no-cache",
  expires: "0",
};

function workspaceOAuthOrigin(
  env: NodeJS.ProcessEnv,
  gatewayUrl: string,
): string | undefined {
  return (
    normalizeOrigin(env.VITE_WORKSPACE_OAUTH_ORIGIN) ||
    normalizeOrigin(env.WORKSPACE_OAUTH_ORIGIN) ||
    normalizeOrigin(env.APP_URL) ||
    normalizeOrigin(env.BETTER_AUTH_URL) ||
    normalizeOrigin(gatewayUrl)
  );
}

export function isWorkspaceWatcherLimitError(
  err: Pick<NodeJS.ErrnoException, "code">,
): boolean {
  return err.code === "ENOSPC" || err.code === "EMFILE";
}

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

/**
 * Whether the gateway should spawn the rest of the apps in the background
 * after the default app boots. Lazy spawn already covers correctness — this
 * is purely a UX optimization so the second/third/Nth app the user clicks
 * into is already warm instead of paying the Vite + esbuild prebundle cost
 * on demand.
 *
 * Defaults to ON in lazy mode. Off when the user passed --no-prewarm /
 * WORKSPACE_NO_PREWARM=1, or when eager mode is already starting every app
 * up front (in which case prewarm would be redundant).
 */
export function shouldPrewarmWorkspaceApps(
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (args.includes("--no-prewarm")) return false;
  if (env.WORKSPACE_NO_PREWARM === "1" || env.WORKSPACE_NO_PREWARM === "true") {
    return false;
  }
  // Eager mode starts every app immediately; prewarm has nothing to do.
  if (shouldEagerStartWorkspaceApps(args, env)) return false;
  return true;
}

/**
 * How many apps to prewarm in parallel. Each Vite spawn briefly maxes out a
 * CPU core during esbuild prebundling, so booting all 9 templates at once on
 * a 4-core laptop just produces a thundering herd. Default 2 — gentle on
 * laptops, fast enough that all apps finish within a few cold-spawn windows.
 * Override via --prewarm-concurrency=N or WORKSPACE_PREWARM_CONCURRENCY=N.
 */
export function workspacePrewarmConcurrency(
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): number {
  const flag = args.find((arg) => arg.startsWith("--prewarm-concurrency="));
  const raw = flag
    ? flag.slice("--prewarm-concurrency=".length)
    : env.WORKSPACE_PREWARM_CONCURRENCY;
  if (!raw) return 2;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 2;
  return Math.floor(parsed);
}

/**
 * How long the prewarm queue waits after the gateway is ready before kicking
 * off background spawns. Lets the default app's prebundle get first dibs on
 * CPU. Override via WORKSPACE_PREWARM_DELAY_MS (mostly for tests).
 */
export function workspacePrewarmDelayMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.WORKSPACE_PREWARM_DELAY_MS;
  if (raw === undefined) return 1_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 1_000;
  return Math.floor(parsed);
}

function readBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export type PollingFileWatcherMode =
  | "enable"
  | "disable-explicit"
  | "disable-default";

/**
 * Three-way classification of the polling-watcher decision so callers can
 * tell apart "the user explicitly turned this off" (where we want to override
 * any inherited chokidar/TSC env vars from the parent shell) from "we just
 * didn't auto-detect a Builder/Codespaces/Gitpod container" (where the user's
 * own watcher vars should pass through untouched).
 */
export function pollingFileWatcherMode(
  env: NodeJS.ProcessEnv = process.env,
  root = process.cwd(),
): PollingFileWatcherMode {
  const explicit =
    readBooleanEnv(env.AGENT_NATIVE_DEV_USE_POLLING) ??
    readBooleanEnv(env.WORKSPACE_USE_POLLING_WATCHER);
  if (explicit === true) return "enable";
  if (explicit === false) return "disable-explicit";

  const chokidarExplicit = readBooleanEnv(env.CHOKIDAR_USEPOLLING);
  if (chokidarExplicit === true) return "enable";
  if (chokidarExplicit === false) return "disable-explicit";

  const autoEnable = Boolean(
    env.BUILDER_IO_DEV_SERVER ||
    env.BUILDER_PROJECT_ID ||
    env.BUILDER_WORKSPACE_ID ||
    env.CODESPACES ||
    env.GITPOD_WORKSPACE_ID ||
    env.REMOTE_CONTAINERS ||
    env.DEVCONTAINER ||
    root.startsWith("/root/app/"),
  );
  return autoEnable ? "enable" : "disable-default";
}

export function shouldUsePollingFileWatcher(
  env: NodeJS.ProcessEnv = process.env,
  root = process.cwd(),
): boolean {
  return pollingFileWatcherMode(env, root) === "enable";
}

function devWatcherEnv(
  env: NodeJS.ProcessEnv,
  mode: PollingFileWatcherMode,
): NodeJS.ProcessEnv {
  if (mode === "enable") {
    return {
      ...env,
      CHOKIDAR_USEPOLLING: "1",
      CHOKIDAR_INTERVAL: env.CHOKIDAR_INTERVAL ?? POLLING_WATCH_INTERVAL_MS,
      TSC_WATCHFILE: env.TSC_WATCHFILE ?? "DynamicPriorityPolling",
      TSC_WATCHDIRECTORY: env.TSC_WATCHDIRECTORY ?? "DynamicPriorityPolling",
    };
  }
  if (mode === "disable-explicit") {
    // The user explicitly turned polling off (AGENT_NATIVE_DEV_USE_POLLING=0
    // / WORKSPACE_USE_POLLING_WATCHER=0 / CHOKIDAR_USEPOLLING=0). Strip the
    // watcher vars from the child env so an inherited parent-shell
    // CHOKIDAR_USEPOLLING=1 (or stale TSC_WATCH* override) can't silently
    // re-enable polling against the user's explicit wish.
    const {
      CHOKIDAR_USEPOLLING: _polling,
      CHOKIDAR_INTERVAL: _interval,
      TSC_WATCHFILE: _watchFile,
      TSC_WATCHDIRECTORY: _watchDir,
      ...rest
    } = env;
    return rest;
  }
  // mode === "disable-default": no explicit signal either way. Pass the env
  // through unchanged so legitimate user overrides like
  // TSC_WATCHFILE=UseFsEventsWithFallbackDynamicPolling survive.
  return env;
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

function shouldReportDiscoverAppsReadFailure(
  appsDir: string,
  code: string | undefined,
): boolean {
  if (code === "ENOENT") return false;
  const key = `${appsDir}:${code ?? "unknown"}`;
  if (reportedDiscoverAppsReadFailures.has(key)) return false;
  reportedDiscoverAppsReadFailures.add(key);
  return true;
}

function shouldCaptureDiscoverAppsReadFailure(
  code: string | undefined,
): boolean {
  return code !== "EACCES" && code !== "EPERM";
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
    if (shouldReportDiscoverAppsReadFailure(appsDir, code)) {
      console.warn(
        `[workspace] Could not read ${appsDir} (${code ?? "unknown"}): ` +
          `${(err as Error).message}`,
      );
      if (shouldCaptureDiscoverAppsReadFailure(code)) {
        Sentry.captureException(err, {
          tags: { handled: "dev-discover-readdir" },
          level: "warning",
        });
      }
    }
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(appsDir, entry.name);
      const pkg = readJson(path.join(dir, "package.json"));
      if (!pkg) return null;
      const routeAccess = workspaceAppRouteAccessFromPackageJson(pkg);
      return {
        id: entry.name,
        name: pkg.displayName || pkg.name || entry.name,
        description: typeof pkg.description === "string" ? pkg.description : "",
        audience:
          workspaceAppAudienceFromPackageJson(pkg) ??
          DEFAULT_WORKSPACE_APP_AUDIENCE,
        publicPaths: routeAccess.publicPaths ?? [],
        protectedPaths: routeAccess.protectedPaths ?? [],
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

function formatAppOutput(chunk: unknown): string {
  const lines = String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !isChildDevServerUrlLine(line));
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

function appendAppOutputTail(app: WorkspaceApp, output: string): void {
  if (!output) return;
  const next = `${app.outputTail ?? ""}${output}`;
  app.outputTail =
    next.length > APP_OUTPUT_TAIL_BYTES
      ? next.slice(-APP_OUTPUT_TAIL_BYTES)
      : next;
}

function pipeAppOutput(
  prefix: string,
  chunk: unknown,
  write: (value: string) => void,
): string {
  const output = formatAppOutput(chunk);
  if (!output) return "";
  const prefixed = output
    .trimEnd()
    .split(/\n/)
    .map((line) => `${prefix} ${line}`)
    .join("\n");
  write(`${prefixed}\n`);
  return output;
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

function formatProxyReadyTimeout(timeoutMs: number): string {
  const seconds = timeoutMs / 1_000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${timeoutMs}ms`;
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

function probeHttpReady(
  app: Pick<WorkspaceApp, "id" | "port">,
  timeoutMs = 1_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let req: http.ClientRequest;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve(ok);
    };
    req = http.request(
      {
        hostname: "127.0.0.1",
        port: app.port,
        method: "GET",
        path: `/${app.id}`,
        headers: {
          accept: "text/html",
          host: `127.0.0.1:${app.port}`,
        },
      },
      (res) => {
        res.resume();
        finish(true);
      },
    );
    req.setTimeout(timeoutMs, () => finish(false));
    req.once("error", () => finish(false));
    req.end();
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
  const failure = app.lastFailure;
  const retryDelayMs = failure
    ? Math.max(1_000, failure.nextRetryAt - Date.now() + 250)
    : 900;
  const refreshSeconds = failure
    ? Math.max(1, Math.ceil(retryDelayMs / 1_000))
    : 1;
  const refreshScriptDelay = failure ? retryDelayMs : 900;
  const title = failure
    ? `${failure.installing ? "Install failed" : "App failed to start"}: ${escapedName}`
    : `Starting ${escapedName}`;
  const message = failure
    ? `The workspace gateway will retry in ${Math.max(
        1,
        Math.ceil((failure.nextRetryAt - Date.now()) / 1_000),
      )}s. Fix the error below or stop the server with Ctrl+C.`
    : app.installing
      ? "The workspace gateway is installing this app's dependencies before starting it."
      : "The workspace gateway is waking this app's dev server.";
  const failureOutput = failure?.output.trim();
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="${refreshSeconds}" />
    <title>${title}</title>
    <meta name="color-scheme" content="light dark" />
    <style>
      :root { --bg: #fafafa; --fg: #171717; --muted: #737373; --bar-bg: #e5e5e5; --bar-fill: #171717; --danger: #dc2626; --code-bg: #171717; --code-fg: #fafafa; }
      @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; --bar-bg: #262626; --bar-fill: #fafafa; --danger: #f87171; --code-bg: #171717; --code-fg: #f5f5f5; } }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); }
      main { width: min(680px, calc(100vw - 48px)); }
      .bar { height: 3px; overflow: hidden; border-radius: 999px; background: var(--bar-bg); }
      .bar::before { content: ""; display: block; height: 100%; width: 42%; border-radius: inherit; background: var(--bar-fill); animation: load 1s ease-in-out infinite; }
      main.failed .bar::before { width: 100%; background: var(--danger); animation: none; }
      p { color: var(--muted); }
      pre { max-height: min(46vh, 360px); overflow: auto; margin-top: 20px; padding: 14px 16px; border-radius: 8px; background: var(--code-bg); color: var(--code-fg); font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; white-space: pre-wrap; word-break: break-word; }
      @keyframes load { 0% { transform: translateX(-105%); } 100% { transform: translateX(245%); } }
    </style>
    <script>
      (() => {
        const reload = () => window.location.reload();
        setTimeout(reload, ${JSON.stringify(refreshScriptDelay)});
        setInterval(reload, ${JSON.stringify(Math.max(refreshScriptDelay, 3_000))});
      })();
    </script>
  </head>
  <body>
    <main class="${failure ? "failed" : ""}">
      <div class="bar"></div>
      <h1>${title}</h1>
      <p>${escapeHtml(message)}</p>
      ${failureOutput ? `<pre>${escapeHtml(failureOutput)}</pre>` : ""}
    </main>
  </body>
</html>`;
}

function renderIndex(apps: WorkspaceApp[]): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent-Native Workspace</title>
    <meta name="color-scheme" content="light dark" />
    <style>
      :root { --bg: #fafafa; --fg: #171717; --muted: #737373; --card-bg: #ffffff; --card-border: #d4d4d4; }
      @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; --card-bg: #171717; --card-border: #262626; } }
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: var(--bg); color: var(--fg); }
      main { max-width: 760px; margin: 0 auto; }
      a { color: inherit; text-decoration: none; }
      .grid { display: grid; gap: 12px; margin-top: 20px; }
      .card { display: flex; justify-content: space-between; border: 1px solid var(--card-border); border-radius: 8px; padding: 14px 16px; background: var(--card-bg); }
      .muted { color: var(--muted); }
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

function hasLocalBin(dir: string, command: string): boolean {
  const binDir = path.join(dir, "node_modules", ".bin");
  return (
    fs.existsSync(path.join(binDir, command)) ||
    fs.existsSync(path.join(binDir, `${command}.cmd`)) ||
    fs.existsSync(path.join(binDir, `${command}.ps1`))
  );
}

export async function runWorkspaceDev(
  options: WorkspaceDevOptions = {},
): Promise<WorkspaceDevHandle> {
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
  const pollingMode = pollingFileWatcherMode(env, root);
  const usePollingFileWatcher = pollingMode === "enable";
  const proxyReadyTimeoutMs = Number(
    env.WORKSPACE_PROXY_READY_TIMEOUT_MS ?? 30_000,
  );
  const proxyResponseTimeoutMs = Number(
    env.WORKSPACE_PROXY_RESPONSE_TIMEOUT_MS ??
      DEFAULT_PROXY_RESPONSE_TIMEOUT_MS,
  );
  const proxyNonHtmlResponseTimeoutMs = Number(
    env.WORKSPACE_PROXY_NON_HTML_RESPONSE_TIMEOUT_MS ??
      env.WORKSPACE_PROXY_RESPONSE_TIMEOUT_MS ??
      DEFAULT_PROXY_NON_HTML_RESPONSE_TIMEOUT_MS,
  );
  let gatewayUrl = `http://${gatewayHost}:${requestedPort}`;

  const apps = discoverApps(appsDir, appPortStart);
  if (apps.length === 0) {
    throw new Error("[workspace] No apps found under ./apps");
  }

  // Probe each app's proposed port to see if something else on the host
  // already owns it. Vite is spawned with `--strictPort` (so the gateway can
  // route /<appId> to a known port), which fails hard on EADDRINUSE — without
  // this probe a single conflicting process on 8100/8101/... kills the
  // workspace before the dev server prints anything useful.
  function probePortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => {
        probe.close(() => resolve(true));
      });
      probe.listen(port, gatewayHost);
    });
  }

  async function reserveAppPort(
    start: number,
    excluded: Set<number>,
  ): Promise<number> {
    for (let port = start; port < start + 100; port++) {
      if (excluded.has(port)) continue;
      if (port === requestedPort) continue;
      if (await probePortAvailable(port)) return port;
    }
    throw new Error(
      `[workspace] No available port found between ${start} and ${start + 100}`,
    );
  }

  const reservedAppPorts = new Set<number>();
  for (const app of apps) {
    const original = app.port;
    const port = await reserveAppPort(original, reservedAppPorts);
    if (port !== original) {
      stdout.write(
        `[workspace] Port ${original} unavailable for /${app.id}, using ${port}\n`,
      );
    }
    app.port = port;
    reservedAppPorts.add(port);
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

  if (usePollingFileWatcher) {
    stdout.write(
      `[workspace] Using polling file watchers (${POLLING_WATCH_INTERVAL_MS}ms) to avoid remote-container inotify limits.\n`,
    );
  }

  let readyResolve: (value: { port: number; url: string }) => void;
  const ready = new Promise<{ port: number; url: string }>((resolve) => {
    readyResolve = resolve;
  });

  function workspaceAppsJson(): string {
    return JSON.stringify(
      apps.map((workspaceApp) => ({
        id: workspaceApp.id,
        name: workspaceApp.name,
        description: workspaceApp.description,
        path: `/${workspaceApp.id}`,
        audience: workspaceApp.audience,
        publicPaths: workspaceApp.publicPaths,
        protectedPaths: workspaceApp.protectedPaths,
      })),
    );
  }

  async function syncApps(): Promise<void> {
    const discovered = discoverApps(appsDir, appPortStart);
    for (const app of discovered) {
      const existing = appById.get(app.id);
      if (existing) {
        existing.name = app.name;
        existing.description = app.description;
        existing.audience = app.audience;
        existing.publicPaths = app.publicPaths;
        existing.protectedPaths = app.protectedPaths;
        existing.dir = app.dir;
        continue;
      }
      const usedPorts = new Set(apps.map((existingApp) => existingApp.port));
      const port = await reserveAppPort(appPortStart, usedPorts);
      reservedAppPorts.add(port);
      const next = { ...app, port };
      apps.push(next);
      apps.sort(compareApps);
      appById.set(next.id, next);
      stdout.write(`[workspace] Detected new app: /${next.id}\n`);
    }
  }

  function scheduleSync(): void {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      void syncApps().catch((err) => {
        stderr.write(
          `[workspace] App sync failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
    }, 400);
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
    if (app.restartTimer) return;
    app.lastFailure = undefined;
    app.outputTail = undefined;

    const basePath = `/${app.id}`;
    const shouldInstall =
      !app.installAttempted && !hasLocalBin(app.dir, "vite");
    const childArgs = shouldInstall
      ? ["--dir", root, "install", "--no-frozen-lockfile", "--prefer-offline"]
      : [
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
        ];

    if (shouldInstall) {
      stdout.write(
        `[workspace] Installing dependencies before starting /${app.id}\n`,
      );
    }

    const child = spawnProcess("pnpm", childArgs, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: devWatcherEnv(
        {
          ...env,
          APP_NAME: app.id,
          AGENT_NATIVE_WORKSPACE: "1",
          AGENT_NATIVE_WORKSPACE_APP_ID: app.id,
          AGENT_NATIVE_WORKSPACE_APPS_JSON: workspaceAppsJson(),
          AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: app.audience,
          AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: JSON.stringify(
            app.publicPaths,
          ),
          AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: JSON.stringify(
            app.protectedPaths,
          ),
          APP_BASE_PATH: basePath,
          VITE_AGENT_NATIVE_WORKSPACE: "1",
          VITE_AGENT_NATIVE_WORKSPACE_APP_ID: app.id,
          VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON: workspaceAppsJson(),
          VITE_AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: app.audience,
          VITE_AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: JSON.stringify(
            app.publicPaths,
          ),
          VITE_AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: JSON.stringify(
            app.protectedPaths,
          ),
          VITE_APP_BASE_PATH: basePath,
          VITE_WORKSPACE_OAUTH_ORIGIN: workspaceOAuthOrigin(env, gatewayUrl),
          VITE_WORKSPACE_GATEWAY_URL: gatewayUrl,
          PORT: String(app.port),
          WORKSPACE_GATEWAY_URL: gatewayUrl,
        },
        pollingMode,
      ),
    });
    app.process = child;
    app.installing = shouldInstall;

    const prefix = `[${app.id}]`;
    const stableTimer = setTimeout(() => {
      app.restartAttempts = 0;
    }, 5_000);
    stableTimer.unref();

    child.stdout?.on("data", (chunk) => {
      appendAppOutputTail(
        app,
        pipeAppOutput(prefix, chunk, (value) => stdout.write(value)),
      );
    });
    child.stderr?.on("data", (chunk) => {
      appendAppOutputTail(
        app,
        pipeAppOutput(prefix, chunk, (value) => stderr.write(value)),
      );
    });
    child.on("exit", (code, signal) => {
      clearTimeout(stableTimer);
      const wasInstalling = app.installing;
      app.process = undefined;
      app.installing = false;
      app.ready = false;
      app.readinessProbe = undefined;
      if (app.restartTimer) return;
      if (code === 0 || shuttingDown) {
        if (wasInstalling && code === 0 && !shuttingDown) {
          app.installAttempted = true;
          startApp(app);
        }
        return;
      }
      if (wasInstalling) app.installAttempted = false;
      scheduleAppRestart(app, {
        code,
        signal,
        installing: wasInstalling,
        output: app.outputTail ?? "",
        logMessage: `exited with code ${code}`,
      });
    });
  }

  function scheduleAppRestart(
    app: WorkspaceApp,
    input: {
      code: number | null;
      signal: NodeJS.Signals | null;
      installing: boolean;
      output: string;
      logMessage: string;
    },
  ): void {
    if (shuttingDown || app.restartTimer) return;
    if (input.installing) app.installAttempted = false;
    app.restartAttempts = (app.restartAttempts ?? 0) + 1;
    const delay = appRestartDelay(app.restartAttempts);
    const nextRetryAt = Date.now() + delay;
    app.lastFailure = {
      code: input.code,
      signal: input.signal,
      at: Date.now(),
      installing: input.installing,
      output: input.output,
      nextRetryAt,
    };
    stderr.write(
      `[${app.id}] ${input.logMessage}; retrying in ${Math.round(
        delay / 1000,
      )}s\n`,
    );
    app.restartTimer = setTimeout(() => {
      app.restartTimer = undefined;
      startApp(app);
    }, delay);
    app.restartTimer.unref();
  }

  function failAppStartupTimeout(app: WorkspaceApp): void {
    if (app.installing || app.ready || app.restartTimer) return;
    const timeout = formatProxyReadyTimeout(proxyReadyTimeoutMs);
    const message =
      `Timed out waiting ${timeout} for /${app.id} to return ` +
      `an HTTP response on 127.0.0.1:${app.port}.`;
    const output = [message, app.outputTail?.trim()]
      .filter(Boolean)
      .join("\n\nLast child output:\n");
    app.ready = false;
    app.readinessProbe = undefined;
    scheduleAppRestart(app, {
      code: null,
      signal: null,
      installing: false,
      output,
      logMessage: message,
    });
    app.process?.kill("SIGTERM");
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

  async function waitForHttpReady(
    app: WorkspaceApp,
    deadline: number,
  ): Promise<boolean> {
    while (Date.now() < deadline) {
      const timeoutMs = Math.min(1_000, Math.max(1, deadline - Date.now()));
      if (await probeHttpReady(app, timeoutMs)) return true;
      await new Promise((r) => setTimeout(r, PROXY_READY_RETRY_DELAY_MS));
    }
    return false;
  }

  function ensureReadinessProbe(app: WorkspaceApp): void {
    if (app.ready || app.readinessProbe || app.installing) return;
    app.readinessProbe = waitForHttpReady(app, Date.now() + proxyReadyTimeoutMs)
      .then((ready) => {
        if (ready) {
          app.ready = true;
          return;
        }
        failAppStartupTimeout(app);
      })
      .finally(() => {
        app.readinessProbe = undefined;
      });
  }

  function proxyHttp(
    app: WorkspaceApp,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const cold = !app.process || app.process.killed;
    startApp(app);

    if (!app.ready && wantsHtml(req)) {
      ensureReadinessProbe(app);
      res.writeHead(200, STARTING_APP_RESPONSE_HEADERS);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(renderStartingApp(app));
      return;
    }

    const serveStartingPage = () => {
      res.writeHead(200, STARTING_APP_RESPONSE_HEADERS);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(renderStartingApp(app));
    };

    const dispatch = () => {
      const headers = proxyHeaders(req, `127.0.0.1:${app.port}`);
      let settled = false;
      let responseTimer: NodeJS.Timeout;
      const responseTimeoutMs = wantsHtml(req)
        ? proxyResponseTimeoutMs
        : proxyNonHtmlResponseTimeoutMs;
      const proxyReq = http.request(
        {
          hostname: "127.0.0.1",
          port: app.port,
          method: req.method,
          path: req.url,
          headers,
        },
        (proxyRes) => {
          if (settled) {
            proxyRes.resume();
            return;
          }
          settled = true;
          clearTimeout(responseTimer);
          app.ready = true;
          const statusCode = proxyRes.statusCode ?? 502;
          const responseHeaders = { ...proxyRes.headers };
          if (statusCode >= 300 && statusCode < 400) {
            const rewritten = rewriteRedirectLocation(
              app,
              firstHeaderValue(responseHeaders.location),
            );
            if (rewritten) responseHeaders.location = rewritten;
          }
          res.writeHead(statusCode, responseHeaders);
          proxyRes.once("error", () => {
            if (!res.destroyed) res.destroy();
          });
          proxyRes.pipe(res);
        },
      );
      proxyReq.once("socket", (socket) => {
        attachGatewaySocketErrorSink(socket);
      });
      res.once("error", () => {
        proxyReq.destroy();
      });
      responseTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        app.ready = false;
        proxyReq.destroy();
        ensureReadinessProbe(app);
        if (res.headersSent) {
          res.end();
          return;
        }
        if (wantsHtml(req)) {
          serveStartingPage();
          return;
        }
        res.writeHead(504, { "content-type": "text/plain" });
        res.end(
          `App "${app.id}" did not return response headers within ${formatProxyReadyTimeout(responseTimeoutMs)}.`,
        );
      }, responseTimeoutMs);
      responseTimer.unref();

      proxyReq.on("error", (err) => {
        clearTimeout(responseTimer);
        if (settled) return;
        settled = true;
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
    void waitForHttpReady(app, Date.now() + proxyReadyTimeoutMs).then(
      (ready) => {
        if (!ready) {
          failAppStartupTimeout(app);
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "text/plain" });
            res.end(
              `App "${app.id}" is not ready yet: no HTTP response from 127.0.0.1:${app.port}`,
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
    let target: net.Socket | undefined;
    attachGatewaySocketErrorSink(socket, () => {
      target?.destroy();
    });
    socket.once("close", () => {
      target?.destroy();
    });
    void waitForPort(app.port, Date.now() + proxyReadyTimeoutMs).then(
      (ready) => {
        if (!ready) {
          failAppStartupTimeout(app);
          socket.destroy();
          return;
        }
        if (socket.destroyed) return;
        app.ready = true;
        const upstream = net.connect(app.port, "127.0.0.1", () => {
          const headers = Object.entries(
            proxyHeaders(req, `127.0.0.1:${app.port}`),
          )
            .flatMap(([key, value]) =>
              Array.isArray(value)
                ? value.map((item) => `${key}: ${item}`)
                : [`${key}: ${value ?? ""}`],
            )
            .join("\r\n");
          upstream.write(
            `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`,
          );
          if (head.length) upstream.write(head);
          socket.pipe(upstream).pipe(socket);
        });
        target = upstream;

        attachGatewaySocketErrorSink(upstream, () => {
          if (!socket.destroyed) socket.destroy();
        });
        upstream.once("close", () => {
          if (!socket.destroyed) socket.destroy();
        });
      },
    );
  }

  function handleWatcherError(err: NodeJS.ErrnoException): void {
    if (isWorkspaceWatcherLimitError(err)) {
      stderr.write(
        `[workspace] Recursive file watcher hit the system limit (${err.code}). ` +
          `New apps will still be detected via polling every ~2s. ` +
          (err.code === "ENOSPC"
            ? `On Linux you can raise the limit with ` +
              `\`sudo sysctl fs.inotify.max_user_watches=524288\` ` +
              `(persist via /etc/sysctl.d/*.conf). `
            : `Try closing other dev servers or raising your open-file limit. `) +
          `On macOS/Windows this usually ` +
          `means too many other watchers are running.\n`,
      );
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
    setInterval(() => {
      void syncApps().catch(() => {});
    }, 2_000).unref();
  }

  /**
   * Background-spawn every app that wasn't started by `startWorkspaceProcesses`.
   * The lazy proxy still handles correctness (an on-demand request always
   * starts its target app); this is purely so the first navigation into a
   * non-default app doesn't pay the cold Vite + esbuild prebundle cost.
   *
   * Fires after a short delay so the default app's prebundle gets first dibs
   * on CPU. Concurrency-limited to avoid hammering a small dev machine —
   * each Vite spawn briefly maxes out a core during prebundling.
   */
  async function prewarmRemainingApps(): Promise<void> {
    const concurrency = workspacePrewarmConcurrency(args, env);
    const delayMs = workspacePrewarmDelayMs(env);

    const queue = apps
      .filter((app) => app.id !== defaultApp)
      .filter((app) => !(app.process && !app.process.killed))
      .map((app) => app.id);

    if (queue.length === 0) return;

    stdout.write(
      `[workspace] Prewarming ${queue.length} app(s) in the background ` +
        `(concurrency ${concurrency}; pass --no-prewarm to disable)\n`,
    );

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (shuttingDown) return;

    let next = 0;
    async function worker(): Promise<void> {
      while (!shuttingDown && next < queue.length) {
        const id = queue[next++];
        const app = appById.get(id);
        if (!app) continue;
        // Another path (a real request, a restart, etc.) may have started
        // this app already — skip without consuming a worker slot needlessly.
        if (app.process && !app.process.killed) continue;
        startApp(app);
        ensureReadinessProbe(app);
        // Wait for the upstream to answer HTTP before pulling the next
        // app off the queue. This is what actually limits *concurrent
        // prebundling* (not just concurrent spawning) and keeps CPU pressure
        // sane. proxyReadyTimeoutMs caps any single stuck app.
        await waitForHttpReady(app, Date.now() + proxyReadyTimeoutMs).catch(
          () => false,
        );
      }
    }

    const workerCount = Math.max(1, Math.min(concurrency, queue.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
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

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "/", "http://workspace.local");
    const pathname = parsedUrl.pathname;

    if (pathname === "/" || pathname === "/index.html") {
      await syncApps().catch(() => {});
      const currentDefaultApp =
        explicitDefaultApp && appById.has(explicitDefaultApp)
          ? explicitDefaultApp
          : appById.has("dispatch")
            ? "dispatch"
            : defaultApp;
      const shouldRedirectRoot =
        Boolean(explicitDefaultApp && appById.has(explicitDefaultApp)) ||
        appById.has("dispatch");
      if (shouldRedirectRoot) {
        res.writeHead(302, {
          location: `/${currentDefaultApp}${parsedUrl.search}`,
        });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderIndex(apps));
      return;
    }

    if (pathname === "/_workspace/apps") {
      await syncApps().catch(() => {});
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          apps.map((app) => ({
            id: app.id,
            name: app.name,
            description: app.description,
            path: `/${app.id}`,
            audience: app.audience,
            publicPaths: app.publicPaths,
            protectedPaths: app.protectedPaths,
            port: app.port,
            running: Boolean(app.process && !app.process.killed),
          })),
        ),
      );
      return;
    }

    let app = appForRequest(req);
    if (!app) {
      await syncApps().catch(() => {});
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
      const prewarming = shouldPrewarmWorkspaceApps(args, env);
      stdout.write(
        `[workspace] Mode: ${
          eager ? "eager" : prewarming ? "lazy+prewarm" : "lazy"
        }\n`,
      );
      for (const app of apps) {
        stdout.write(
          `[workspace] ${app.id}: /${app.id} -> 127.0.0.1:${app.port}\n`,
        );
      }
      startWorkspaceProcesses();
      if (prewarming) {
        void prewarmRemainingApps().catch((err) => {
          stderr.write(
            `[workspace] Prewarm error: ${
              err instanceof Error ? err.message : String(err)
            }\n`,
          );
        });
      }
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
  runWorkspaceDev({ args: process.argv.slice(2) }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
