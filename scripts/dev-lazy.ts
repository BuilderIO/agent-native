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
import { pathToFileURL } from "node:url";

import {
  attachGatewaySocketErrorSink,
  escapeHtml,
  normalizeOrigin,
  rewriteRedirectLocation,
} from "../packages/core/src/cli/gateway-helpers.ts";

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
  lastFailure?: {
    code: number | null;
    at: number;
    output: string;
    nextRetryAt: number;
  };
  outputTail?: string;
  ready?: boolean;
  readinessProbe?: Promise<void>;
  lastActivityAt?: number;
  // Last time this app returned (or was probed as returning) a non-5xx
  // response. Initialized to spawn time so a fresh cold boot is never
  // mistaken for a stuck/stranded server. Drives both the stuck-app restart
  // cap in `failAppStartupTimeout` and the permanent-503 self-heal in
  // `dispatch()`.
  lastNon5xxAt?: number;
  openSockets?: number;
  evicting?: boolean;
}

const argv = process.argv.slice(2);
const ROOT = path.resolve(".");
loadRootEnvFile(path.join(ROOT, ".env"));
const TEMPLATES_DIR = path.join(ROOT, "templates");
const CONFIG_PATH = path.join(ROOT, "packages/shared-app-config/templates.ts");
const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 8080;
const FRAME_PORT = 3334;
const PROXY_READY_RETRY_DELAY_MS = 250;
const APP_RESTART_MAX_DELAY_MS = 10_000;
const DEFAULT_PROXY_RESPONSE_TIMEOUT_MS = 15_000;
const DEFAULT_PROXY_BROWSER_ASSET_RESPONSE_TIMEOUT_MS = 15_000;
const DEFAULT_PROXY_NON_HTML_RESPONSE_TIMEOUT_MS = 120_000;
const APP_OUTPUT_TAIL_BYTES = 8_000;
const EVICT_SWEEP_MS = 30_000;
// A child that is alive and already accepting TCP connections is very likely
// mid dep-optimization or rebuilding after a concurrent edit (both can
// legitimately take minutes under CPU contention) rather than actually stuck.
// Only escalate to a tree-kill + restart once it has gone this long without
// producing a single non-5xx response.
const STUCK_APP_RESTART_MS = 300_000;
// Nitro's dev env-runner has a known failure mode where it gives up after a
// few worker crashes and serves 5xx for every request forever. Detect that by
// tracking how long it has been since the app last returned a non-5xx
// response and force a restart once it crosses this threshold.
const PERSISTENT_5XX_RESTART_MS = 75_000;
const APP_IFRAME_ALLOW = "camera; microphone; display-capture; fullscreen";
const POLLING_WATCH_INTERVAL_MS = "1000";
const DESKTOP_LAZY_DEFAULT_TEMPLATE_IDS = ["assets"];
const STARTING_APP_RESPONSE_HEADERS: http.OutgoingHttpHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, no-cache, max-age=0, must-revalidate",
  pragma: "no-cache",
  expires: "0",
};

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

function parseEnv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if (
      (quote === `"` || quote === `'`) &&
      value.length >= 2 &&
      value[value.length - 1] === quote
    ) {
      value = value.slice(1, -1);
      if (quote === `"`) {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, `"`)
          .replace(/\\\\/g, "\\");
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result[key] = value;
  }
  return result;
}

function loadRootEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const parsed = parseEnv(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

function printHelp(): void {
  console.log(`dev-lazy

Start a lazy template gateway for framework repo development.

Usage:
  node scripts/dev-lazy.ts [options]

Options:
  --apps <names>            Comma-separated templates to expose (default: core)
  --apps=<names>            Same as --apps <names>
  --all                     Expose every template in packages/shared-app-config
  --desktop                 Also start the clips-desktop tray (Tauri)
  --electron                Also start the Electron desktop shell and frame
  --eager                   Start every exposed template immediately
  --prewarm                 Background-warm all selected templates for snappy
                            switching (default: off / truly lazy)
  --no-prewarm              No-op alias (prewarm is already off by default)
  --prewarm-concurrency=N   Max parallel Vite spawns during prewarm (default 2)
  --watch-core-dist         Rebuild core dist in the background (normally
                            unnecessary because monorepo Vite aliases core src)
  --open                    Open the gateway URL in the browser on ready
  --no-open                 (legacy / no-op — auto-open is off by default)
  --no-kill                 Do not kill stale processes on gateway/template ports
  --dry-run                 Print ports and commands without spawning
  -h, --help                Show this help message

Examples:
  pnpm dev
  pnpm dev -- --apps dispatch,mail,calendar
  pnpm dev:lazy
  pnpm dev:electron:lazy
  pnpm dev:desktop`);
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
      const sourceName = name === "starter" ? "chat" : name;
      const dir = path.join(TEMPLATES_DIR, sourceName);
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
const includeDesktop = hasFlag("--desktop");
const includeElectron = hasFlag("--electron");

function includeDesktopLazyDefaults(selected: TemplateApp[]): TemplateApp[] {
  if (!includeDesktop) return selected;
  const selectedIds = new Set(selected.map((app) => app.id));
  const additions = DESKTOP_LAZY_DEFAULT_TEMPLATE_IDS.map((id) =>
    appById.get(id),
  ).filter(
    (app): app is TemplateApp => Boolean(app) && !selectedIds.has(app.id),
  );
  return additions.length ? [...selected, ...additions] : selected;
}

const requestedApps = (() => {
  if (hasFlag("--all")) return allApps;
  const appsArg = flagValue("--apps");
  if (!appsArg)
    return includeDesktopLazyDefaults(allApps.filter((app) => app.core));
  const ids = appsArg
    .split(",")
    .map((app) => normalizeRequestedAppId(app.trim()))
    .filter(Boolean);
  const unknown = ids.filter((id) => !appById.has(id));
  if (unknown.length) {
    console.warn(`[dev-lazy] Unknown templates skipped: ${unknown.join(", ")}`);
  }
  return ids
    .map((id) => appById.get(id))
    .filter((app): app is TemplateApp => !!app);
})();

function normalizeRequestedAppId(id: string): string {
  return id === "starter" ? "chat" : id;
}

if (requestedApps.length === 0) {
  console.error("[dev-lazy] No templates selected.");
  process.exit(1);
}

const apps = requestedApps.sort(compareApps);
const selectedById = new Map(apps.map((app) => [app.id, app]));
const eager = hasFlag("--eager");
const dryRun = hasFlag("--dry-run");
const prewarmEnabled = (() => {
  if (eager) return false;
  // Prewarm is now opt-in (default off) to keep only actively-used templates
  // resident. `--no-prewarm` / WORKSPACE_NO_PREWARM stay recognized as no-ops.
  if (hasFlag("--prewarm")) return true;
  return readBooleanEnv(process.env.WORKSPACE_PREWARM) === true;
})();
const templateIdleMs = (() => {
  const raw = process.env.WORKSPACE_TEMPLATE_IDLE_MS;
  if (raw === undefined) return 120_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 120_000;
  return Math.floor(parsed);
})();
const prewarmConcurrency = (() => {
  const raw =
    flagValue("--prewarm-concurrency") ??
    process.env.WORKSPACE_PREWARM_CONCURRENCY ??
    null;
  if (!raw) return 2;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 2;
  return Math.floor(parsed);
})();
const prewarmDelayMs = (() => {
  const raw = process.env.WORKSPACE_PREWARM_DELAY_MS;
  if (raw === undefined) return 1_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 1_000;
  return Math.floor(parsed);
})();
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
const shouldWatchCoreDist =
  hasFlag("--watch-core-dist") ||
  readBooleanEnv(process.env.WORKSPACE_WATCH_CORE_DIST) === true;
const gatewayHost = process.env.WORKSPACE_HOST || DEFAULT_GATEWAY_HOST;
const requestedGatewayPort = Number(
  process.env.WORKSPACE_PORT || process.env.PORT || DEFAULT_GATEWAY_PORT,
);
const proxyReadyTimeoutMs = Number(
  process.env.WORKSPACE_PROXY_READY_TIMEOUT_MS ?? 90_000,
);
const stuckAppRestartMs = Number(
  process.env.WORKSPACE_STUCK_APP_RESTART_MS ?? STUCK_APP_RESTART_MS,
);
const persistent5xxRestartMs = Number(
  process.env.WORKSPACE_PERSISTENT_5XX_RESTART_MS ?? PERSISTENT_5XX_RESTART_MS,
);
const proxyResponseTimeoutMs = Number(
  process.env.WORKSPACE_PROXY_RESPONSE_TIMEOUT_MS ??
    DEFAULT_PROXY_RESPONSE_TIMEOUT_MS,
);
const proxyBrowserAssetResponseTimeoutMs = Number(
  process.env.WORKSPACE_PROXY_BROWSER_ASSET_RESPONSE_TIMEOUT_MS ??
    DEFAULT_PROXY_BROWSER_ASSET_RESPONSE_TIMEOUT_MS,
);
const proxyNonHtmlResponseTimeoutMs = Number(
  process.env.WORKSPACE_PROXY_NON_HTML_RESPONSE_TIMEOUT_MS ??
    process.env.WORKSPACE_PROXY_RESPONSE_TIMEOUT_MS ??
    DEFAULT_PROXY_NON_HTML_RESPONSE_TIMEOUT_MS,
);
let gatewayUrl = `http://${gatewayHost}:${requestedGatewayPort}`;
const envDefaultApp = process.env.DEV_DEFAULT_APP;
const defaultApp =
  envDefaultApp && selectedById.has(envDefaultApp)
    ? envDefaultApp
    : selectedById.has("dispatch")
      ? "dispatch"
      : apps[0].id;
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

type PollingFileWatcherMode = "enable" | "disable-explicit" | "disable-default";

function pollingFileWatcherMode(
  env: NodeJS.ProcessEnv,
  root: string,
  options: { multiTemplateWatchLoad?: boolean } = {},
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
    root.startsWith("/root/app/") ||
    options.multiTemplateWatchLoad,
  );
  return autoEnable ? "enable" : "disable-default";
}

const pollingMode = pollingFileWatcherMode(process.env, ROOT, {
  multiTemplateWatchLoad: apps.length > 1 && (eager || prewarmEnabled),
});
const usePollingFileWatcher = pollingMode === "enable";

function devWatcherEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (pollingMode === "enable") {
    return {
      ...env,
      CHOKIDAR_USEPOLLING: "1",
      CHOKIDAR_INTERVAL: env.CHOKIDAR_INTERVAL ?? POLLING_WATCH_INTERVAL_MS,
      TSC_WATCHFILE: env.TSC_WATCHFILE ?? "DynamicPriorityPolling",
      TSC_WATCHDIRECTORY: env.TSC_WATCHDIRECTORY ?? "DynamicPriorityPolling",
    };
  }
  if (pollingMode === "disable-explicit") {
    // The user explicitly turned polling off. Strip the watcher vars from
    // the child env so an inherited parent-shell CHOKIDAR_USEPOLLING=1 (or
    // stale TSC_WATCH* override) can't silently re-enable polling against
    // the user's explicit wish.
    const {
      CHOKIDAR_USEPOLLING: _polling,
      CHOKIDAR_INTERVAL: _interval,
      TSC_WATCHFILE: _watchFile,
      TSC_WATCHDIRECTORY: _watchDir,
      ...rest
    } = env;
    return rest;
  }
  // disable-default: no explicit signal either way. Pass the env through
  // unchanged so legitimate user overrides like
  // TSC_WATCHFILE=UseFsEventsWithFallbackDynamicPolling survive.
  return env;
}

function workspaceOAuthOrigin(
  env: NodeJS.ProcessEnv,
  gatewayUrl: string,
): string | undefined {
  return (
    normalizeOrigin(env.VITE_WORKSPACE_OAUTH_ORIGIN) ||
    normalizeOrigin(env.WORKSPACE_OAUTH_ORIGIN) ||
    normalizeOrigin(env.APP_URL) ||
    normalizeOrigin(env.VITE_APP_URL) ||
    normalizeOrigin(env.BETTER_AUTH_URL) ||
    normalizeOrigin(env.VITE_BETTER_AUTH_URL) ||
    normalizeOrigin(env.BUILDER_IO_DEV_SERVER) ||
    normalizeOrigin(gatewayUrl)
  );
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
// the same way concurrently colors prefixes in eager mode. Codes are SGR foreground
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

// Header of Nitro 3 (beta)'s transient cold-start 503. On the first SSR request,
// Nitro's dev runner waits ~3.1s for the SSR entry import; if Vite is still
// optimizing deps it throws `NitroViteError: Vite environment "nitro" is
// unavailable`, which surfaces via the worker's unhandledRejection trap. It is
// self-healing \u2014 the next request succeeds \u2014 and in practice is provoked only by
// our own readiness probes during warm-up. A genuine SSR import failure uses a
// different message (the actual import error) and the runner's entryError path,
// so matching this exact signature does not hide real bugs.
function isNitroUnavailableHeader(line: string): boolean {
  return /environment "[^"]*" is unavailable/.test(stripAnsi(line));
}

// One line of the transient-503 block (header, its stack frames, or the
// `{ status: 503 }` wrapper). Only ever applied to a chunk already known to
// contain the header (see pipeOutput), so the loose `}`/`at node:internal`
// matchers can't strip unrelated output.
function isNitroWarmupNoiseLine(line: string): boolean {
  const s = stripAnsi(line).trimEnd();
  return (
    /\[NitroViteError\][^\n]*is unavailable/.test(s) ||
    /environment "[^"]*" is unavailable/.test(s) ||
    /^\s*at \S+ \([^)]*dev-worker\.mjs/.test(s) ||
    /^\s*at \w+ \(node:internal\/(?:process|timers)/.test(s) ||
    /^\s*status:\s*\d+\s*$/.test(s) ||
    /^\s*\}\s*$/.test(s)
  );
}

function pipeOutput(
  prefix: string,
  chunk: unknown,
  write: (value: string) => void,
  suppressNitroNoise = false,
): string {
  const lines = String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !isChildDevServerUrlLine(line));
  if (lines.length === 0) return "";
  // Return the full text for outputTail (failure diagnostics) regardless, but
  // keep the transient cold-start 503 block off the console while the app is
  // still warming up — only touching chunks that actually contain its header.
  const output = lines.join("\n") + "\n";
  const displayLines =
    suppressNitroNoise && lines.some(isNitroUnavailableHeader)
      ? lines.filter((line) => !isNitroWarmupNoiseLine(line))
      : lines;
  if (displayLines.length > 0) {
    write(displayLines.map((line) => `${prefix} ${line}`).join("\n") + "\n");
  }
  return output;
}

function appendAppOutputTail(app: TemplateApp, output: string): void {
  if (!output) return;
  const next = `${app.outputTail ?? ""}${output}`;
  app.outputTail =
    next.length > APP_OUTPUT_TAIL_BYTES
      ? next.slice(-APP_OUTPUT_TAIL_BYTES)
      : next;
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

const BROWSER_ASSET_DESTINATIONS = new Set([
  "audioworklet",
  "font",
  "image",
  "manifest",
  "paintworklet",
  "script",
  "serviceworker",
  "sharedworker",
  "style",
  "track",
  "video",
  "worker",
]);

export function isBrowserAssetDestination(
  destination: string | string[] | undefined,
): boolean {
  const value = Array.isArray(destination) ? destination[0] : destination;
  return value ? BROWSER_ASSET_DESTINATIONS.has(value.toLowerCase()) : false;
}

function isBrowserAssetRequest(req: http.IncomingMessage): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  return isBrowserAssetDestination(req.headers["sec-fetch-dest"]);
}

export function selectProxyResponseTimeout(
  request: { html: boolean; browserAsset: boolean },
  timeouts: { html: number; browserAsset: number; other: number },
): number {
  if (request.html) return timeouts.html;
  if (request.browserAsset) return timeouts.browserAsset;
  return timeouts.other;
}

function renderStartingApp(app: TemplateApp): string {
  const escapedName = escapeHtml(app.name);
  const failure = app.lastFailure;
  const retryDelayMs = failure
    ? Math.max(1_000, failure.nextRetryAt - Date.now() + 250)
    : 900;
  const refreshSeconds = failure
    ? Math.max(1, Math.ceil(retryDelayMs / 1_000))
    : 1;
  const refreshScriptDelay = failure ? retryDelayMs : 900;
  const title = failure
    ? `App failed to start: ${escapedName}`
    : `Starting ${escapedName}`;
  const message = failure
    ? `The lazy template gateway will retry in ${Math.max(
        1,
        Math.ceil((failure.nextRetryAt - Date.now()) / 1_000),
      )}s. Fix the error below or stop the server with Ctrl+C.`
    : "The lazy template gateway is waking this app's dev server.";
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
  app: Pick<TemplateApp, "id" | "port">,
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
        // A 5xx here is Nitro's transient cold-start 503 ("Vite environment
        // ... is unavailable") — the SSR entry is still importing, so the app
        // is not ready. Only a non-5xx response means it can actually serve;
        // otherwise we'd flip app.ready and proxy real traffic into a cold
        // dev server (and the prewarm would "warm" nothing).
        finish((res.statusCode ?? 500) < 500);
      },
    );
    req.setTimeout(timeoutMs, () => finish(false));
    req.once("error", () => finish(false));
    req.end();
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

async function waitForHttpReady(
  app: TemplateApp,
  deadline: number,
): Promise<boolean> {
  let retryDelay = PROXY_READY_RETRY_DELAY_MS;
  while (Date.now() < deadline) {
    // Nitro's dev SSR runner waits ~3.1s for the entry import before returning
    // 503, so give each probe long enough to receive that real response rather
    // than abandoning it at 1s — an abandoned request still completes (and
    // logs) server-side. Backing off between polls keeps the warm-up quiet.
    const timeoutMs = Math.min(4_000, Math.max(1, deadline - Date.now()));
    if (await probeHttpReady(app, timeoutMs)) return true;
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
    retryDelay = Math.min(retryDelay * 2, 2_000);
  }
  return false;
}

/**
 * The single place an app transitions into the "ready" state: readiness-probe
 * success, a proxied response with a non-5xx status, and upgrade (WebSocket)
 * readiness all funnel through here. Resetting `restartAttempts` only on an
 * actual successful serve (rather than on a fixed post-spawn timer) is what
 * lets backoff keep escalating for an app that fails on every attempt.
 */
export function markAppReady(app: TemplateApp): void {
  app.ready = true;
  app.lastNon5xxAt = Date.now();
  app.restartAttempts = 0;
}

/**
 * Pure decision for whether a readiness-timeout should escalate all the way to
 * a tree-kill + restart, versus simply waiting longer. Extracted so the matrix
 * (dead port always restarts; a live port only restarts once it has been
 * stuck for `stuckMs` with no non-5xx response) is unit-testable without
 * spawning real processes.
 */
export function shouldRestartStuckApp(input: {
  portOpen: boolean;
  lastNon5xxAt: number;
  now: number;
  stuckMs: number;
}): boolean {
  if (!input.portOpen) return true;
  return input.now - input.lastNon5xxAt > input.stuckMs;
}

/**
 * Pure decision backing the permanent-503 self-heal: once an app has gone
 * `restartMs` without a single non-5xx response, a run of 5xx responses is
 * treated as a stranded dev-server runner rather than a transient blip.
 */
export function shouldRestartPersistent5xx(input: {
  lastNon5xxAt: number;
  now: number;
  restartMs: number;
}): boolean {
  return input.now - input.lastNon5xxAt > input.restartMs;
}

function ensureReadinessProbe(app: TemplateApp): void {
  if (app.ready || app.readinessProbe) return;
  app.readinessProbe = waitForHttpReady(app, Date.now() + proxyReadyTimeoutMs)
    .then((ready) => {
      if (ready) {
        markAppReady(app);
        return;
      }
      void failAppStartupTimeout(app);
    })
    .finally(() => {
      app.readinessProbe = undefined;
    });
}

/**
 * Pure eviction decision so the matrix (open socket never evicts; quiet + no
 * socket past the timeout evicts; within the timeout does not) is testable in
 * isolation. `idleTimeoutMs <= 0` disables eviction entirely.
 */
export function shouldEvict(input: {
  lastActivityAt: number;
  openSockets: number;
  now: number;
  idleTimeoutMs: number;
}): boolean {
  if (input.idleTimeoutMs <= 0) return false;
  if (input.openSockets > 0) return false;
  return input.now - input.lastActivityAt > input.idleTimeoutMs;
}

function evictApp(app: TemplateApp): void {
  process.stderr.write(
    `${colorPrefix(app.id)} evicting idle app (no activity for ${Math.round(
      templateIdleMs / 1_000,
    )}s)\n`,
  );
  // Mark before signalling so the child's exit handler treats this as a clean
  // teardown and does not schedule a restart. The next request cold-starts it.
  app.evicting = true;
  killChildProcessTree(app.process, "SIGTERM");
}

function sweepIdleApps(): void {
  if (templateIdleMs <= 0) return;
  const now = Date.now();
  for (const app of apps) {
    if (!app.process || app.process.killed) continue;
    // Skip apps mid-restart or with an in-flight readiness probe (cold-starting).
    if (app.restartTimer || app.readinessProbe) continue;
    if (
      shouldEvict({
        lastActivityAt: app.lastActivityAt ?? now,
        openSockets: app.openSockets ?? 0,
        now,
        idleTimeoutMs: templateIdleMs,
      })
    ) {
      evictApp(app);
    }
  }
}

/**
 * Background-spawn templates other than the default so the first navigation
 * into each one doesn't pay the cold Vite + esbuild prebundle cost. The lazy
 * proxy still handles correctness; this just makes second/third/Nth visits
 * feel instant. Concurrency-limited to keep CPU pressure sane on laptops.
 */
async function prewarmRemainingApps(): Promise<void> {
  const queue = apps
    .filter((app) => !(app.process && !app.process.killed))
    .map((app) => app.id);

  if (queue.length === 0) return;

  console.log(
    `[dev-lazy] Prewarming ${queue.length} template(s) in the background ` +
      `(concurrency ${prewarmConcurrency}; pass --no-prewarm to disable)`,
  );

  if (prewarmDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, prewarmDelayMs));
  }
  if (shuttingDown) return;

  let next = 0;
  async function worker(): Promise<void> {
    while (!shuttingDown && next < queue.length) {
      const id = queue[next++];
      const app = selectedById.get(id);
      if (!app) continue;
      if (app.process && !app.process.killed) continue;
      startApp(app);
      ensureReadinessProbe(app);
      await waitForHttpReady(app, Date.now() + proxyReadyTimeoutMs).catch(
        () => false,
      );
    }
  }

  const workerCount = Math.max(1, Math.min(prewarmConcurrency, queue.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
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

function appDatabaseEnv(app: TemplateApp): NodeJS.ProcessEnv {
  const appEnvName = app.id.toUpperCase().replace(/-/g, "_");
  const databaseUrlKey = `${appEnvName}_DATABASE_URL`;
  if (process.env[databaseUrlKey]) return {};

  return {
    [databaseUrlKey]: `file:${path.join(app.dir, "data", "app.db")}`,
  };
}

export function appLocalEnv(
  app: Pick<TemplateApp, "id" | "dir">,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const appPrefix = `${app.id.toUpperCase().replace(/-/g, "_")}_`;
  for (const fileName of [".env", ".env.local"]) {
    const envPath = path.join(app.dir, fileName);
    if (!fs.existsSync(envPath)) continue;
    for (const [key, value] of Object.entries(
      parseEnv(fs.readFileSync(envPath, "utf8")),
    )) {
      if (key.startsWith(appPrefix)) env[key] = value;
    }
  }
  return env;
}

function appGoogleOAuthEnv(app: TemplateApp): NodeJS.ProcessEnv {
  const appEnvName = app.id.toUpperCase().replace(/-/g, "_");
  const clientIdKey = `${appEnvName}_GOOGLE_CLIENT_ID`;
  const clientSecretKey = `${appEnvName}_GOOGLE_CLIENT_SECRET`;
  const clientId = process.env[clientIdKey];
  const clientSecret = process.env[clientSecretKey];

  if (!clientId && !clientSecret) return {};
  if (!clientId || !clientSecret) {
    const missingKey = clientId ? clientSecretKey : clientIdKey;
    console.warn(
      `[dev-lazy] ${app.id}: ignoring incomplete app-scoped Google OAuth credentials; ${missingKey} is missing.`,
    );
    return {};
  }

  return {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
  };
}

function startApp(app: TemplateApp): void {
  if (app.process && !app.process.killed) return;
  if (app.restartTimer) return;
  app.lastFailure = undefined;
  app.outputTail = undefined;
  app.evicting = false;
  app.lastActivityAt = Date.now();
  // Seed the persistent-5xx/stuck-app clock at spawn time so a fresh cold
  // boot (which necessarily has no non-5xx response yet) is never mistaken
  // for a stranded runner or a stuck compile before it has had a chance to
  // serve anything.
  app.lastNon5xxAt = Date.now();
  app.openSockets ??= 0;

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
      detached: process.platform !== "win32",
      env: devWatcherEnv({
        ...process.env,
        ...appDatabaseEnv(app),
        // Vite loads these files for import.meta.env, but Nitro server code
        // reads process.env. Bridge only app-scoped values into the child;
        // generic DATABASE_URL/BETTER_AUTH_SECRET remain workspace-owned so
        // one template cannot silently change shared local auth or storage.
        ...appLocalEnv(app),
        ...appGoogleOAuthEnv(app),
        // Children write to a pipe (not a TTY), so vite/pnpm/chalk/picocolors
        // skip colors by default. FORCE_COLOR=1 re-enables them — the parent's
        // stdout is a TTY, so ANSI codes pass straight through to the user.
        FORCE_COLOR: "1",
        APP_NAME: app.id,
        AGENT_NATIVE_WORKSPACE: "1",
        AGENT_NATIVE_WORKSPACE_APPS_JSON: workspaceAppsJson(),
        APP_BASE_PATH: basePath,
        VITE_AGENT_NATIVE_WORKSPACE: "1",
        VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON: workspaceAppsJson(),
        VITE_APP_BASE_PATH: basePath,
        VITE_WORKSPACE_OAUTH_ORIGIN: workspaceOAuthOrigin(
          process.env,
          gatewayUrl,
        ),
        VITE_WORKSPACE_GATEWAY_URL: gatewayUrl,
        PORT: String(app.port),
        WORKSPACE_GATEWAY_URL: gatewayUrl,
      }),
    },
  );

  app.process = child;
  const prefix = colorPrefix(app.id);

  child.stdout?.on("data", (chunk) => {
    appendAppOutputTail(
      app,
      pipeOutput(prefix, chunk, (value) => process.stdout.write(value)),
    );
  });
  child.stderr?.on("data", (chunk) => {
    appendAppOutputTail(
      app,
      pipeOutput(
        prefix,
        chunk,
        (value) => process.stderr.write(value),
        !app.ready,
      ),
    );
  });
  child.on("exit", (code) => {
    const wasEvicting = app.evicting;
    app.process = undefined;
    app.ready = false;
    app.readinessProbe = undefined;
    app.evicting = false;
    if (code === 0 || shuttingDown || wasEvicting) return;
    scheduleAppRestart(app, {
      code,
      output: app.outputTail ?? "",
      logMessage: `exited with code ${code}`,
    });
  });
}

function scheduleAppRestart(
  app: TemplateApp,
  input: { code: number | null; output: string; logMessage: string },
): void {
  if (shuttingDown || app.restartTimer) return;
  app.restartAttempts = (app.restartAttempts ?? 0) + 1;
  const delay = appRestartDelay(app.restartAttempts);
  const nextRetryAt = Date.now() + delay;
  app.lastFailure = {
    code: input.code,
    at: Date.now(),
    output: input.output,
    nextRetryAt,
  };
  process.stderr.write(
    `${colorPrefix(app.id)} ${input.logMessage}; retrying in ${Math.round(delay / 1000)}s\n`,
  );
  app.restartTimer = setTimeout(() => {
    app.restartTimer = undefined;
    startApp(app);
  }, delay);
  app.restartTimer.unref();
}

/**
 * Called when a readiness probe (HTTP polling or the WebSocket upgrade's
 * `waitForPort`) times out without the app ever becoming ready. A naive
 * tree-kill here is wrong when the child is actually alive and its port is
 * accepting TCP connections — that almost always means Vite is still deep in
 * dependency optimization or rebuilding after a concurrent edit, which can
 * legitimately take minutes under CPU contention. Killing there discards the
 * warm esbuild/optimize cache and restarts the optimize pass from scratch,
 * producing an infinite kill/cold-boot loop. So: only tree-kill immediately
 * when the port is actually dead; otherwise wait longer, and only escalate to
 * a kill once the app has gone `stuckAppRestartMs` with no non-5xx response at
 * all (see `shouldRestartStuckApp`).
 */
async function failAppStartupTimeout(app: TemplateApp): Promise<void> {
  if (app.ready || app.restartTimer) return;
  const timeout = formatProxyReadyTimeout(proxyReadyTimeoutMs);
  const portOpen = await probePort(app.port);
  const stillAlive = Boolean(app.process && !app.process.killed);
  // Re-check after the async gap: another path may have already marked the
  // app ready or scheduled a restart while we were probing the port.
  if (app.ready || app.restartTimer) return;

  if (
    portOpen &&
    stillAlive &&
    !shouldRestartStuckApp({
      portOpen,
      lastNon5xxAt: app.lastNon5xxAt ?? Date.now(),
      now: Date.now(),
      stuckMs: stuckAppRestartMs,
    })
  ) {
    process.stderr.write(
      `${colorPrefix(app.id)} still compiling/optimizing after ${timeout} ` +
        `but 127.0.0.1:${app.port} is accepting connections; waiting instead ` +
        `of restarting\n`,
    );
    ensureReadinessProbe(app);
    return;
  }

  const message =
    portOpen && stillAlive
      ? `/${app.id} has not returned a healthy response for ` +
        `${formatProxyReadyTimeout(stuckAppRestartMs)} despite an open port ` +
        `on 127.0.0.1:${app.port}; treating it as stuck.`
      : `Timed out waiting ${timeout} for /${app.id} to return ` +
        `an HTTP response on 127.0.0.1:${app.port}.`;
  const output = [message, app.outputTail?.trim()]
    .filter(Boolean)
    .join("\n\nLast child output:\n");
  app.ready = false;
  app.readinessProbe = undefined;
  scheduleAppRestart(app, {
    code: null,
    output,
    logMessage: message,
  });
  killChildProcessTree(app.process, "SIGTERM");
}

/**
 * Permanent-503 self-heal: Nitro's dev env-runner has a known state where it
 * gives up after a few worker crashes and serves 5xx for every request
 * forever (the response body mentions the runner being unavailable). Because
 * the gateway only ever saw "a response happened" before, it never noticed —
 * this is the escalation path that does. Only fires once the app has gone
 * `persistent5xxRestartMs` with no non-5xx response at all, so a normal
 * transient 500 during a rebuild never triggers it.
 */
async function maybeRecoverPersistent5xx(
  app: TemplateApp,
  statusCode: number,
): Promise<void> {
  if (app.restartTimer) return;
  const now = Date.now();
  if (
    !shouldRestartPersistent5xx({
      lastNon5xxAt: app.lastNon5xxAt ?? now,
      now,
      restartMs: persistent5xxRestartMs,
    })
  ) {
    return;
  }
  const stillAlive = Boolean(app.process && !app.process.killed);
  if (!stillAlive) return;
  if (!(await probePort(app.port))) return;
  // Re-check after the async gap: another path may have already restarted it
  // or it may have just recovered on its own.
  if (app.restartTimer) return;
  process.stderr.write(
    `${colorPrefix(app.id)} stuck serving ${statusCode} for ` +
      `${formatProxyReadyTimeout(persistent5xxRestartMs)} with no healthy ` +
      `response; restarting (likely a stranded dev-server runner)\n`,
  );
  app.ready = false;
  killChildProcessTree(app.process, "SIGTERM");
  scheduleAppRestart(app, {
    code: null,
    output: app.outputTail ?? "",
    logMessage: `stuck serving ${statusCode} responses with no healthy reply`,
  });
}

function proxyHttp(
  app: TemplateApp,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  app.lastActivityAt = Date.now();
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
    let bodyTimer: NodeJS.Timeout | undefined;
    let upstreamResponse: http.IncomingMessage | undefined;
    // Pin the app alive for the lifetime of this response the same way an
    // open WebSocket does. Long-lived plain-HTTP streams (SSE from
    // useDbSync/agent chat) used to look idle to the eviction sweep because
    // only upgrade sockets counted toward `openSockets` — this let the sweep
    // SIGTERM an app mid-stream. Guarded like `proxyUpgrade`'s
    // `releaseSocket` so a close+error double-fire can't double-decrement.
    let streamSocketReleased = true;
    const releaseStreamSocket = () => {
      if (streamSocketReleased) return;
      streamSocketReleased = true;
      app.openSockets = Math.max(0, (app.openSockets ?? 1) - 1);
    };
    const browserAsset = isBrowserAssetRequest(req);
    const responseTimeoutMs = selectProxyResponseTimeout(
      { html: wantsHtml(req), browserAsset },
      {
        html: proxyResponseTimeoutMs,
        browserAsset: proxyBrowserAssetResponseTimeoutMs,
        other: proxyNonHtmlResponseTimeoutMs,
      },
    );
    const clearBodyTimer = () => {
      if (bodyTimer) clearTimeout(bodyTimer);
      bodyTimer = undefined;
    };
    const abortUpstream = () => {
      clearTimeout(responseTimer);
      clearBodyTimer();
      upstreamResponse?.destroy();
      proxyReq.destroy();
    };
    const armBodyTimer = () => {
      if (!wantsHtml(req) && !browserAsset) return;
      clearBodyTimer();
      bodyTimer = setTimeout(() => {
        process.stderr.write(
          `${colorPrefix(app.id)} response body stalled for ${formatProxyReadyTimeout(responseTimeoutMs)}: ${req.method ?? "GET"} ${req.url ?? "/"}\n`,
        );
        upstreamResponse?.destroy();
        if (!res.destroyed) res.destroy();
      }, responseTimeoutMs);
      bodyTimer.unref();
    };
    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: app.port,
        method: req.method,
        path: req.url,
        headers,
      },
      (proxyRes) => {
        upstreamResponse = proxyRes;
        if (settled) {
          proxyRes.resume();
          return;
        }
        settled = true;
        clearTimeout(responseTimer);
        const statusCode = proxyRes.statusCode ?? 502;
        // Only a non-5xx response proves the app is actually healthy. Nitro's
        // dev env-runner can get stuck serving 5xx for every request forever
        // after a few worker crashes; flipping `ready` true here regardless
        // (as this used to) hid that permanent-failure state from the
        // gateway entirely. Proxy the response through unchanged either way.
        if (statusCode < 500) {
          markAppReady(app);
        } else {
          void maybeRecoverPersistent5xx(app, statusCode);
        }
        const responseHeaders = { ...proxyRes.headers };
        if (statusCode >= 300 && statusCode < 400) {
          const rewritten = rewriteRedirectLocation(
            app,
            firstHeaderValue(responseHeaders.location),
          );
          if (rewritten) responseHeaders.location = rewritten;
        }
        armBodyTimer();
        proxyRes.on("data", armBodyTimer);
        proxyRes.on("data", () => {
          app.lastActivityAt = Date.now();
        });
        proxyRes.once("end", clearBodyTimer);
        proxyRes.once("close", clearBodyTimer);
        res.writeHead(statusCode, responseHeaders);
        streamSocketReleased = false;
        app.openSockets = (app.openSockets ?? 0) + 1;
        res.once("finish", releaseStreamSocket);
        res.once("close", releaseStreamSocket);
        res.once("error", releaseStreamSocket);
        proxyRes.once("error", () => {
          clearBodyTimer();
          if (!res.destroyed) res.destroy();
        });
        proxyRes.pipe(res);
      },
    );
    proxyReq.once("socket", (socket) => {
      attachGatewaySocketErrorSink(socket);
    });
    req.once("aborted", abortUpstream);
    res.once("close", abortUpstream);
    res.once("error", abortUpstream);
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
        `Template "${app.id}" did not return response headers within ${formatProxyReadyTimeout(responseTimeoutMs)}.`,
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
      res.end(`Template "${app.id}" is not ready yet: ${err.message}`);
    });

    req.pipe(proxyReq);
  };

  if (app.ready && !cold) {
    dispatch();
    return;
  }

  void waitForHttpReady(app, Date.now() + proxyReadyTimeoutMs).then((ready) => {
    if (!ready) {
      void failAppStartupTimeout(app);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(
          `Template "${app.id}" is not ready yet: no HTTP response from 127.0.0.1:${app.port}`,
        );
      } else {
        res.end();
      }
      return;
    }
    markAppReady(app);
    dispatch();
  });
}

function proxyUpgrade(
  app: TemplateApp,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  app.lastActivityAt = Date.now();
  // Pin the app alive while this upgrade (e.g. Vite HMR) socket is open, so an
  // actively edited/verified app is never evicted regardless of HTTP quiet.
  app.openSockets = (app.openSockets ?? 0) + 1;
  let released = false;
  const releaseSocket = () => {
    if (released) return;
    released = true;
    app.openSockets = Math.max(0, (app.openSockets ?? 1) - 1);
    app.lastActivityAt = Date.now();
  };
  socket.once("close", releaseSocket);
  socket.once("error", releaseSocket);

  startApp(app);
  let target: net.Socket | undefined;
  attachGatewaySocketErrorSink(socket, () => {
    target?.destroy();
  });
  socket.once("close", () => {
    target?.destroy();
  });
  void waitForPort(app.port, Date.now() + proxyReadyTimeoutMs).then((ready) => {
    if (!ready) {
      void failAppStartupTimeout(app);
      socket.destroy();
      return;
    }
    if (socket.destroyed) return;
    markAppReady(app);
    const upstream = net.connect(app.port, "127.0.0.1", () => {
      const headers = Object.entries(proxyHeaders(req, `127.0.0.1:${app.port}`))
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

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Keep browser-visible gateway URLs on the origin advertised to child apps.
 *
 * The gateway listens on a loopback address, so browsers can reach the same
 * process through either `localhost` or `127.0.0.1`. Serving app HTML on one
 * alias while injecting the other into `VITE_WORKSPACE_GATEWAY_URL` turns
 * otherwise same-gateway requests into CORS requests. Redirect only equivalent
 * loopback aliases on the same port; external/proxied hosts are left untouched.
 */
export function canonicalLoopbackRedirect(
  requestHost: string | undefined,
  requestTarget: string | undefined,
  canonicalGatewayUrl: string,
): string | undefined {
  if (!requestHost || !requestTarget?.startsWith("/")) return undefined;

  try {
    const canonical = new URL(canonicalGatewayUrl);
    const requested = new URL(`${canonical.protocol}//${requestHost}`);
    if (
      !LOOPBACK_HOSTNAMES.has(canonical.hostname) ||
      !LOOPBACK_HOSTNAMES.has(requested.hostname) ||
      canonical.port !== requested.port ||
      canonical.hostname === requested.hostname
    ) {
      return undefined;
    }
    return `${canonical.origin}${requestTarget}`;
  } catch {
    return undefined;
  }
}

function createGateway(): http.Server {
  const server = http.createServer((req, res) => {
    const canonicalRedirect = canonicalLoopbackRedirect(
      firstHeaderValue(req.headers.host),
      req.url,
      gatewayUrl,
    );
    if (canonicalRedirect) {
      res.writeHead(307, { location: canonicalRedirect });
      res.end();
      return;
    }

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

function killChildProcessTree(
  child: ChildProcess | undefined,
  signal: NodeJS.Signals,
): void {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      execSync(
        `taskkill /pid ${child.pid} /T ${signal === "SIGKILL" ? "/F" : ""}`,
        { stdio: "ignore" },
      );
      return;
    }
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function ensureElectronBinary() {
  try {
    execSync(
      `pnpm --filter @agent-native/desktop-app exec node -e "require('electron')"`,
      { stdio: "ignore" },
    );
    return;
  } catch {
    console.log(
      "[dev-lazy] Electron binary is missing; rebuilding the desktop dependency...",
    );
  }

  try {
    execSync("pnpm --filter @agent-native/desktop-app rebuild electron", {
      stdio: "inherit",
    });
    execSync(
      `pnpm --filter @agent-native/desktop-app exec node -e "require('electron')"`,
      { stdio: "ignore" },
    );
  } catch (err) {
    console.error(
      "[dev-lazy] Electron is installed but its binary could not be prepared.",
    );
    console.error(
      "Run this once and retry:\n  pnpm --filter @agent-native/desktop-app rebuild electron",
    );
    throw err;
  }
}

function electronLazyEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AGENT_NATIVE_TEMPLATE_GATEWAY_URL: gatewayUrl,
    VITE_AGENT_NATIVE_TEMPLATE_GATEWAY_URL: gatewayUrl,
    AGENT_NATIVE_USE_TEMPLATE_GATEWAY: "1",
    VITE_AGENT_NATIVE_USE_TEMPLATE_GATEWAY: "1",
    WORKSPACE_GATEWAY_URL: gatewayUrl,
    VITE_WORKSPACE_GATEWAY_URL: gatewayUrl,
  };
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
    detached: process.platform !== "win32",
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
    killChildProcessTree(app.process, "SIGTERM");
    if (app.restartTimer) clearTimeout(app.restartTimer);
  }
  for (const child of backgroundProcesses) {
    killChildProcessTree(child, "SIGTERM");
  }
  setTimeout(() => {
    for (const app of apps) {
      killChildProcessTree(app.process, "SIGKILL");
    }
    for (const child of backgroundProcesses) {
      killChildProcessTree(child, "SIGKILL");
    }
    process.exit(code);
  }, 1_000).unref();
}

async function main(): Promise<void> {
  if (dryRun) {
    console.log(`[dev-lazy] Gateway: ${gatewayUrl}`);
    console.log(
      `[dev-lazy] Mode: ${
        eager ? "eager" : prewarmEnabled ? "lazy+prewarm" : "lazy"
      }`,
    );
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
    if (includeElectron) {
      console.log(`[dev-lazy] frame: http://localhost:${FRAME_PORT}`);
      console.log("[dev-lazy] electron: @agent-native/desktop-app dev");
    }
    return;
  }

  if (includeElectron) {
    ensureElectronBinary();
  }

  if (shouldKill) {
    const ports = [
      requestedGatewayPort,
      ...(includeElectron ? [FRAME_PORT] : []),
      ...apps.map((app) => app.port),
    ];
    for (const port of ports) killPort(port);
  }

  console.log("[dev-lazy] Prebuilding workspace packages...");
  execSync("node scripts/prebuild-workspace-packages.ts dev", {
    stdio: "inherit",
  });

  if (usePollingFileWatcher) {
    console.log(
      `[dev-lazy] Using polling file watchers (${POLLING_WATCH_INTERVAL_MS}ms) to avoid file watcher descriptor limits.`,
    );
  }

  // The monorepo Vite plugin aliases @agent-native/core runtime imports to
  // packages/core/src, so each active template already receives core HMR
  // directly. A second full `tsc --watch` used to type-check and regenerate
  // thousands of JS/declaration/map artifacts during agent edit bursts, which
  // starved the Vite/Nitro servers serving the browser. Keep dist watching as
  // an explicit escape hatch for workflows that truly consume dist, and make
  // that watcher emit-only; the startup prebuild still performs the full check.
  if (shouldWatchCoreDist) {
    startBackgroundProcess("core", "pnpm", [
      "--filter",
      "@agent-native/core",
      "exec",
      "tsc",
      "--watch",
      "--preserveWatchOutput",
      "--noCheck",
      "--declaration",
      "false",
      "--declarationMap",
      "false",
      "--sourceMap",
      "false",
      "--inlineSources",
      "false",
    ]);
  }

  const server = createGateway();
  gatewayServer = server;

  if (templateIdleMs > 0) {
    const evictSweep = setInterval(sweepIdleApps, EVICT_SWEEP_MS);
    evictSweep.unref();
  }

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
      console.log(
        `[dev-lazy] Mode: ${
          eager ? "eager" : prewarmEnabled ? "lazy+prewarm" : "lazy"
        }`,
      );
      for (const app of apps) {
        console.log(
          `[dev-lazy] ${app.id}: /${app.id} -> 127.0.0.1:${app.port}`,
        );
      }

      if (eager) {
        for (const app of apps) startApp(app);
      } else if (!includeElectron) {
        // Truly lazy: no boot-time start. `/` redirects to /<defaultApp>, and the
        // browser following it cold-starts exactly one app via the proxy path.
        if (prewarmEnabled) {
          void prewarmRemainingApps().catch((err) => {
            console.error(
              `[dev-lazy] Prewarm error: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        }
      }

      if (includeDesktop) {
        // Boot the Tauri clips tray after its backend is reachable. The tray's
        // Google sign-in opens the Clips backend URL directly in the browser.
        const startClipsTray = () => {
          if (shuttingDown) return;
          startBackgroundProcess("tray", "pnpm", [
            "--filter",
            "clips-desktop",
            "dev",
          ]);
        };
        const clipsApp = selectedById.get("clips");
        if (clipsApp) {
          startApp(clipsApp);
          void waitForPort(
            clipsApp.port,
            Date.now() + proxyReadyTimeoutMs,
          ).then((ready) => {
            if (ready) {
              clipsApp.ready = true;
            } else {
              console.warn(
                `[dev-lazy] Clips server did not become ready before starting tray; Google sign-in may fail until 127.0.0.1:${clipsApp.port} is reachable.`,
              );
            }
            startClipsTray();
          });
        } else {
          console.warn(
            "[dev-lazy] --desktop starts the Clips tray, but the clips template is not selected.",
          );
          startClipsTray();
        }
      }

      if (includeElectron) {
        const env = electronLazyEnv();
        startBackgroundProcess(
          "frame",
          "pnpm",
          ["--filter", "@agent-native/frame", "dev"],
          env,
        );
        startBackgroundProcess(
          "electron",
          "pnpm",
          ["--filter", "@agent-native/desktop-app", "dev"],
          env,
        );
      }

      openBrowser(`${gatewayUrl}/${defaultApp}`);
    });
  }

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => shutdown(sig === "SIGINT" ? 0 : 1));
  }

  listen(requestedGatewayPort);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
