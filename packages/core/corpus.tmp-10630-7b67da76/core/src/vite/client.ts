import { EventEmitter } from "events";
import fs from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequire, syncBuiltinESMExports } from "module";
import path from "path";
import { fileURLToPath } from "url";

import type {
  ConfigEnv,
  HotUpdateOptions,
  NormalizedHotChannel,
  Plugin,
  UserConfig,
} from "vite";

import {
  mergePendingChangelog,
  parsePendingEntry,
} from "../changelog/parse.js";
import { getViteDevRecoveryScript } from "../client/vite-dev-recovery-script.js";
import { findWorkspaceRoot } from "../scripts/utils.js";
import { verifyEmbedSessionToken } from "../server/embed-session.js";
import {
  EMBED_SESSION_COOKIE,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";
import {
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  MCP_EMBED_STATIC_ASSET_HEADERS,
  mcpEmbedStaticAssetRouteRules,
  shouldAllowMcpEmbedCredentials,
} from "../shared/mcp-embed-headers.js";
import {
  normalizeMcpIntegrationsConfig,
  type McpIntegrationsConfigInput,
} from "../shared/mcp-integration-config.js";
import {
  normalizeAgentNativeRouteWarmupConfig,
  type AgentNativeRouteWarmupConfigInput,
} from "../shared/route-warmup-config.js";
import { actionTypesPlugin } from "./action-types-plugin.js";
import { agentsBundlePlugin } from "./agents-bundle-plugin.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let nitroFsWatchGuardInstalled = false;

type FsWatchArgs = [fs.PathLike, ...any[]];

function isFileWatchLimitError(
  error: NodeJS.ErrnoException | undefined,
): boolean {
  return error?.code === "EMFILE" || error?.code === "ENOSPC";
}

function watchPollingIntervalMs(): number {
  const raw = Number(process.env.CHOKIDAR_INTERVAL ?? 1000);
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}

function fsWatchListener(args: FsWatchArgs): fs.WatchListener<string> | null {
  const maybeOptionsOrListener = args[1];
  const maybeListener = args[2];
  if (typeof maybeOptionsOrListener === "function")
    return maybeOptionsOrListener as fs.WatchListener<string>;
  if (typeof maybeListener === "function")
    return maybeListener as fs.WatchListener<string>;
  return null;
}

function fsWatchPersistent(args: FsWatchArgs): boolean {
  const options = args[1];
  if (!options || typeof options === "function") return true;
  if (typeof options === "string" || Buffer.isBuffer(options)) return true;
  return options.persistent !== false;
}

function directEntrySnapshot(
  target: string,
): Map<string, { mtimeMs: number; size: number; directory: boolean }> {
  const snapshot = new Map<
    string,
    { mtimeMs: number; size: number; directory: boolean }
  >();
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    snapshot.set(path.basename(target), {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      directory: false,
    });
    return snapshot;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const entryPath = path.join(target, entry.name);
    try {
      const entryStat = fs.statSync(entryPath);
      snapshot.set(entry.name, {
        mtimeMs: entryStat.mtimeMs,
        size: entryStat.size,
        directory: entryStat.isDirectory(),
      });
    } catch {
      // The entry may have disappeared between readdir and stat.
    }
  }
  return snapshot;
}

function createPollingFsWatcher(args: FsWatchArgs): fs.FSWatcher {
  const target = String(args[0]);
  const listener = fsWatchListener(args);
  const emitter = new EventEmitter() as fs.FSWatcher;
  let closed = false;
  let previous = directEntrySnapshot(target);

  if (listener) emitter.on("change", listener);

  const emitChange = (eventName: "change" | "rename", filename: string) => {
    emitter.emit("change", eventName, filename);
  };

  const timer = setInterval(() => {
    if (closed) return;
    let next: typeof previous;
    try {
      next = directEntrySnapshot(target);
    } catch (error) {
      emitter.emit("error", error);
      return;
    }

    for (const [filename, current] of next) {
      const old = previous.get(filename);
      if (!old) {
        emitChange("rename", filename);
        continue;
      }
      if (
        old.mtimeMs !== current.mtimeMs ||
        old.size !== current.size ||
        old.directory !== current.directory
      ) {
        emitChange("change", filename);
      }
    }
    for (const filename of previous.keys()) {
      if (!next.has(filename)) emitChange("rename", filename);
    }
    previous = next;
  }, watchPollingIntervalMs());

  if (!fsWatchPersistent(args)) timer.unref();

  emitter.close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    emitter.removeAllListeners();
  };
  emitter.ref = () => {
    timer.ref();
    return emitter;
  };
  emitter.unref = () => {
    timer.unref();
    return emitter;
  };

  return emitter;
}

function warnNitroFsWatchFallback(target: unknown, err: NodeJS.ErrnoException) {
  console.warn(
    `[agent-native] Falling back to polling Nitro fs.watch for ${String(target)}: ${err.message}`,
  );
}

function installNitroFsWatchGuard(): void {
  if (nitroFsWatchGuardInstalled) return;
  nitroFsWatchGuardInstalled = true;

  const originalWatch = fs.watch.bind(fs) as (...args: any[]) => fs.FSWatcher;
  (fs as typeof fs & { watch: (...args: any[]) => fs.FSWatcher }).watch = (
    ...args: any[]
  ) => {
    let watcher: fs.FSWatcher;
    try {
      watcher = originalWatch(...args);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (!isFileWatchLimitError(err)) throw error;
      warnNitroFsWatchFallback(args[0], err);
      return createPollingFsWatcher(args as FsWatchArgs);
    }

    const originalEmit = watcher.emit.bind(watcher);
    const originalClose = watcher.close.bind(watcher);
    let pollingFallback: fs.FSWatcher | undefined;

    watcher.close = (() => {
      pollingFallback?.close();
      return originalClose();
    }) as fs.FSWatcher["close"];

    watcher.emit = ((eventName: string | symbol, ...eventArgs: any[]) => {
      const err = eventArgs[0] as NodeJS.ErrnoException | undefined;
      if (eventName === "error" && isFileWatchLimitError(err) && err) {
        warnNitroFsWatchFallback(args[0], err);
        watcher.close();
        pollingFallback = createPollingFsWatcher(args as FsWatchArgs);
        pollingFallback.on("change", (changeEvent, filename) => {
          originalEmit("change", changeEvent, filename);
        });
        pollingFallback.on("error", (pollingError) => {
          originalEmit("error", pollingError);
        });
        return false;
      }
      return originalEmit(eventName, ...eventArgs);
    }) as fs.FSWatcher["emit"];
    return watcher;
  };
  syncBuiltinESMExports();
}

function nitroVitePlugin(
  ...args: Parameters<typeof import("nitro/vite").nitro>
) {
  installNitroFsWatchGuard();
  const plugins = require("nitro/vite").nitro(...args) as Plugin[];
  return plugins.map(debounceNitroFullReloadHotUpdate);
}

/**
 * Debounce window for coalescing Nitro's dev-mode full-reload broadcasts.
 *
 * Nitro's own Vite plugin (the `hotUpdate` hook inside `nitro/vite`)
 * invalidates each changed server module in the module graph synchronously,
 * then sends `{ type: "full-reload" }` over that environment's hot channel —
 * once per file-change event, with no debounce of its own. Every full-reload
 * makes the Nitro dev worker re-import the entire SSR/server entry point,
 * which is expensive. AI coding agents routinely write dozens of files in a
 * single burst, so one edit session can trigger dozens of sequential
 * re-imports back to back and pin a CPU core for minutes. This is a distinct
 * concern from `fullReloadOnOptimizeDep504` elsewhere in this file (which
 * rate-limits an unrelated client-reload nudge); keep the two independent.
 */
const NITRO_FULL_RELOAD_DEBOUNCE_MS = 300;

/**
 * Wraps a single Nitro-provided Vite plugin so that, if it defines a
 * `hotUpdate` hook, any `environment.hot.send({ type: "full-reload" })` call
 * made from inside that hook is coalesced with a trailing debounce (leading
 * edge suppressed) instead of firing immediately for every changed file.
 * Everything else — module-graph invalidation, non-reload hot messages, the
 * hook's return value — passes through unchanged and immediate. A burst of
 * N changes within the debounce window collapses into exactly one
 * full-reload once things go quiet; a single isolated change still reloads,
 * just delayed by up to `NITRO_FULL_RELOAD_DEBOUNCE_MS`.
 *
 * `hotUpdate` only ever runs on Vite's dev server (never during a build), so
 * this has no effect outside `vite dev`.
 */
function debounceNitroFullReloadHotUpdate(plugin: Plugin): Plugin {
  const originalHook = plugin.hotUpdate;
  if (!originalHook) return plugin;

  // Vite hook properties are either a plain function or `{ handler, ... }`
  // ("object form", used to attach hook metadata like `order`). Support both.
  const isHandlerForm = typeof originalHook === "object";
  const originalHandler = (
    isHandlerForm
      ? (originalHook as { handler: unknown }).handler
      : originalHook
  ) as (
    this: { environment: { name: string; hot: NormalizedHotChannel } },
    options: HotUpdateOptions,
  ) => unknown;

  // One pending-reload timer per Vite environment name ("ssr" by default, or
  // a named Nitro service environment), so unrelated environments can never
  // block or coalesce into each other.
  const pendingReloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function wrappedHotUpdate(
    this: { environment: { name: string; hot: NormalizedHotChannel } },
    options: HotUpdateOptions,
  ) {
    const realEnvironment = this.environment;
    // Proxy `this.environment.hot.send` so nitro's hook body (which reads
    // `this.environment` and calls `env.hot.send(...)`) is otherwise
    // untouched — only full-reload payloads get intercepted below.
    const proxiedThis = new Proxy(this, {
      get(target, prop, receiver) {
        if (prop !== "environment") {
          return Reflect.get(target, prop, receiver);
        }
        return new Proxy(realEnvironment, {
          get(envTarget, envProp, envReceiver) {
            if (envProp !== "hot") {
              return Reflect.get(envTarget, envProp, envReceiver);
            }
            const realHot = envTarget.hot;
            return new Proxy(realHot, {
              get(hotTarget, hotProp, hotReceiver) {
                if (hotProp !== "send") {
                  return Reflect.get(hotTarget, hotProp, hotReceiver);
                }
                return (payload: unknown) => {
                  if (
                    !payload ||
                    typeof payload !== "object" ||
                    (payload as { type?: string }).type !== "full-reload"
                  ) {
                    // Not a full-reload — pass through immediately.
                    return (hotTarget.send as (p: unknown) => void)(payload);
                  }
                  const key = realEnvironment.name || "default";
                  const pending = pendingReloadTimers.get(key);
                  if (pending) clearTimeout(pending);
                  const timer = setTimeout(() => {
                    pendingReloadTimers.delete(key);
                    (hotTarget.send as (p: unknown) => void)(payload);
                  }, NITRO_FULL_RELOAD_DEBOUNCE_MS);
                  // Never hold the process open just for a pending reload.
                  timer.unref?.();
                  pendingReloadTimers.set(key, timer);
                };
              },
            });
          },
        });
      },
    });
    return originalHandler.call(proxiedThis, options);
  }

  if (isHandlerForm) {
    return {
      ...plugin,
      hotUpdate: {
        ...(originalHook as object),
        handler: wrappedHotUpdate,
      },
    } as Plugin;
  }
  return { ...plugin, hotUpdate: wrappedHotUpdate } as Plugin;
}

/**
 * Sync discovery for the workspace-core in an enterprise monorepo.
 *
 * Mirrors `getWorkspaceCoreExports` in deploy/workspace-core.ts but stays
 * synchronous so it can run inline in `defineConfig`. Returns the workspace
 * core's package name + absolute directory, or null if no workspace core is
 * declared in the ancestor chain.
 *
 * Walks up from `startDir` looking for a package.json with
 * `agent-native.workspaceCore`. Resolves the declared package name through
 * `<workspaceRoot>/node_modules/<name>` (pnpm symlink, fastest) or by
 * scanning `packages/*` for a matching `name` field (fallback for
 * pre-install scenarios).
 */
function findWorkspaceCoreSync(
  startDir: string,
): { packageName: string; packageDir: string; workspaceRoot: string } | null {
  // 1) Walk up looking for the root package.json that declares workspaceCore.
  let dir = path.resolve(startDir);
  let workspaceRoot: string | null = null;
  let packageName: string | null = null;
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const declared = pkg?.["agent-native"]?.workspaceCore;
        if (typeof declared === "string" && declared.length > 0) {
          workspaceRoot = dir;
          packageName = declared;
          break;
        }
      } catch {
        // Malformed package.json — keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!workspaceRoot || !packageName) return null;

  // 2a) pnpm/npm symlink under workspaceRoot/node_modules.
  const nm = path.join(workspaceRoot, "node_modules", packageName);
  if (fs.existsSync(path.join(nm, "package.json"))) {
    return { packageName, packageDir: fs.realpathSync(nm), workspaceRoot };
  }

  // 2b) Scan packages/* and packages/@scope/* for a matching `name`.
  const packagesDir = path.join(workspaceRoot, "packages");
  if (fs.existsSync(packagesDir)) {
    const candidates: string[] = [];
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(packagesDir, entry.name));
      if (entry.name.startsWith("@")) {
        const scopeDir = path.join(packagesDir, entry.name);
        for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
          if (sub.isDirectory()) candidates.push(path.join(scopeDir, sub.name));
        }
      }
    }
    for (const c of candidates) {
      const p = path.join(c, "package.json");
      if (!fs.existsSync(p)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(p, "utf-8"));
        if (pkg?.name === packageName)
          return { packageName, packageDir: fs.realpathSync(c), workspaceRoot };
      } catch {
        // ignore malformed package.json
      }
    }
  }
  return null;
}

function findLocalWorkspacePackageDeps(
  startDir: string,
  workspaceRoot: string | null,
): Array<{ packageName: string; packageDir: string }> {
  const pkgPath = path.join(startDir, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    } as Record<string, string>;
    const seen = new Set<string>();
    const packages: Array<{ packageName: string; packageDir: string }> = [];

    for (const [packageName, range] of Object.entries(deps)) {
      if (seen.has(packageName)) continue;
      seen.add(packageName);

      try {
        let packageJsonPath: string | null = null;
        if (range.startsWith("file:")) {
          packageJsonPath = findFilePackageJsonPath(pkgPath, range);
        } else if (range.startsWith("workspace:")) {
          packageJsonPath = findWorkspacePackageJsonPath(
            pkgPath,
            packageName,
            workspaceRoot,
          );
        } else {
          continue;
        }
        if (!packageJsonPath) continue;
        const packageDir = fs.realpathSync(path.dirname(packageJsonPath));
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf-8"),
        );
        if (packageJson?.name !== packageName) continue;
        packages.push({ packageName, packageDir });
      } catch {
        // Dependency may not have been installed yet; ignore it for dev config.
      }
    }

    return packages;
  } catch {
    return [];
  }
}

function packagePathSegments(packageName: string): string[] {
  return packageName.split("/");
}

function findWorkspacePackageJsonPath(
  pkgPath: string,
  packageName: string,
  workspaceRoot: string | null,
): string | null {
  const packageSegments = packagePathSegments(packageName);
  const candidates = [
    path.join(path.dirname(pkgPath), "node_modules", ...packageSegments),
    ...(workspaceRoot
      ? [path.join(workspaceRoot, "node_modules", ...packageSegments)]
      : []),
  ];

  for (const candidate of candidates) {
    const packageJsonPath = path.join(candidate, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;
    const realPath = fs.realpathSync(packageJsonPath);
    if (
      workspaceRoot &&
      !realPath.startsWith(`${fs.realpathSync(workspaceRoot)}${path.sep}`)
    ) {
      continue;
    }
    return realPath;
  }

  if (workspaceRoot) {
    return findWorkspacePackageJsonByName(workspaceRoot, packageName);
  }

  return null;
}

function findWorkspacePackageJsonByName(
  workspaceRoot: string,
  packageName: string,
): string | null {
  const searchRoots = ["packages", "templates"].map((name) =>
    path.join(workspaceRoot, name),
  );

  for (const searchRoot of searchRoots) {
    const packageJsonPath = findPackageJsonInTree(searchRoot, packageName, 2);
    if (packageJsonPath) return packageJsonPath;
  }

  return null;
}

function findPackageJsonInTree(
  root: string,
  packageName: string,
  maxDepth: number,
): string | null {
  if (!fs.existsSync(root)) return null;

  const packageJsonPath = path.join(root, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg?.name === packageName) return fs.realpathSync(packageJsonPath);
    } catch {
      // Ignore malformed workspace package metadata.
    }
  }

  if (maxDepth <= 0) return null;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const found = findPackageJsonInTree(
      path.join(root, entry.name),
      packageName,
      maxDepth - 1,
    );
    if (found) return found;
  }

  return null;
}

function findFilePackageJsonPath(
  pkgPath: string,
  range: string,
): string | null {
  const spec = range.slice("file:".length);
  const packageDir = spec.startsWith("//")
    ? fileURLToPath(range)
    : path.resolve(path.dirname(pkgPath), spec);
  const packageJsonPath = path.join(packageDir, "package.json");
  return fs.existsSync(packageJsonPath) ? packageJsonPath : null;
}

function findPnpmWorkspaceRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Escape a string so it can be embedded as a regex literal. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Check if a package is installed in the project */
function hasDep(pkg: string, cwd: string): boolean {
  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf-8"),
    );
    return !!(
      pkgJson.dependencies?.[pkg] ||
      pkgJson.devDependencies?.[pkg] ||
      pkgJson.peerDependencies?.[pkg]
    );
  } catch {
    return false;
  }
}

function hasCoreDep(pkg: string, cwd: string): boolean {
  const coreRoot = findCorePackageRoot(cwd);
  if (!coreRoot) return false;
  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(coreRoot, "package.json"), "utf-8"),
    );
    return !!(pkgJson.dependencies?.[pkg] || pkgJson.devDependencies?.[pkg]);
  } catch {
    return false;
  }
}

function hasOptimizeDep(pkg: string, cwd: string): boolean {
  return hasDep(pkg, cwd) || hasCoreDep(pkg, cwd);
}

/**
 * Build the `resolve.dedupe` list dynamically. Reads core's package.json and
 * collects every peerDependency that the consuming app also declares. This
 * ensures Vite resolves them from the app root, not from core's own
 * node_modules — preventing duplicate React context / singleton issues.
 */
function getClientDedupe(cwd: string): string[] {
  // Always dedupe React internals (sub-path exports aren't in peerDeps)
  const always = new Set([
    "react",
    "react-dom",
    "react-dom/client",
    // Framework routers must share one react-router instance so
    // FrameworkContext (Meta/Links/Scripts) matches ServerRouter/HydratedRouter.
    ...(hasDep("react-router", cwd)
      ? ["react-router", "react-router/dom"]
      : []),
  ]);

  // Server-only packages that never run in the browser — no point deduping.
  const serverOnly = new Set([
    "drizzle-kit",
    "node-pty",
    "postgres",
    "ws",
    "typescript",
    "vite",
    "@vitejs/plugin-react-swc",
    "tailwindcss",
    "@tailwindcss/vite",
  ]);

  try {
    const corePkgPath = path.resolve(__dirname, "../../package.json");
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8"));

    // Scan both peerDependencies and dependencies. Direct deps like
    // @radix-ui/* use React internally — they must resolve against the
    // app's React, not a second copy inside core's node_modules.
    const coreDeps = new Set([
      ...Object.keys(corePkg.peerDependencies ?? {}),
      ...Object.keys(corePkg.dependencies ?? {}),
    ]);

    // Read the consuming app's dependencies
    const appPkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf-8"),
    );
    const appDeps = new Set([
      ...Object.keys(appPkg.dependencies ?? {}),
      ...Object.keys(appPkg.devDependencies ?? {}),
    ]);

    for (const dep of coreDeps) {
      if (serverOnly.has(dep)) continue;
      // Dedupe if the app also declares it, OR if it's a React-based
      // UI library (Radix, Tanstack) that must share the app's React.
      if (
        appDeps.has(dep) ||
        dep.startsWith("@radix-ui/") ||
        dep.startsWith("@tanstack/")
      ) {
        always.add(dep);
      }
    }
  } catch {
    // Can't read package.json — fall back to known singletons
  }

  return [...always];
}

/**
 * Locate `packages/core/src` if we're inside the framework monorepo.
 * Shared between `getCoreSourceAliases` (which redirects imports to src/)
 * and `getDefaultOptimizeDeps` (which must NOT prebundle from dist/ when
 * the alias is active — otherwise the prebundle is built from a snapshot
 * of dist/ at startup and never picks up new exports).
 */
function findCorePackageRoot(cwd: string): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf-8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const spec =
      pkg.dependencies?.["@agent-native/core"] ??
      pkg.devDependencies?.["@agent-native/core"];
    if (typeof spec === "string" && spec.startsWith("file:")) {
      const rooted = fileURLToPath(spec);
      if (fs.existsSync(path.join(rooted, "src/index.ts"))) return rooted;
    }
  } catch {
    // package.json missing or unreadable — fall through to path heuristics.
  }

  const candidates = [
    path.resolve(cwd, "../../packages/core"), // templates/<name>/
    path.resolve(cwd, "../core"), // packages/<name>/
    path.resolve(cwd, "node_modules/@agent-native/core"),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const root = fs.realpathSync(candidate);
      if (fs.existsSync(path.join(root, "src/index.ts"))) return root;
    } catch {
      continue;
    }
  }
  return null;
}

function findCoreSrcDir(cwd: string): string | null {
  const root = findCorePackageRoot(cwd);
  return root ? path.join(root, "src") : null;
}

/**
 * Pin react-router imports to the consuming app's install. pnpm keeps a peer
 * copy under `@agent-native/core/node_modules/react-router`; `resolve.dedupe`
 * alone can still leave SSR `Meta`/`Links` on a different FrameworkContext
 * than React Router's dev server router.
 */
function getReactRouterAliases(
  cwd: string,
): Array<{ find: RegExp; replacement: string }> {
  if (!hasDep("react-router", cwd)) return [];
  try {
    const req = createRequire(path.join(cwd, "package.json"));
    return [
      {
        find: /^react-router\/dom$/,
        replacement: req.resolve("react-router/dom"),
      },
      { find: /^react-router$/, replacement: req.resolve("react-router") },
    ];
  } catch {
    return [];
  }
}

/**
 * Every `@agent-native/core` subpath that gets a source alias. Must stay in
 * sync with `getCoreSourceAliases`. Used by `getDefaultOptimizeDeps` to skip
 * prebundling in monorepo mode, and by the consumer config to add them to
 * `optimizeDeps.exclude` so Vite always resolves them through the source
 * alias on every request — never from a stale dist/ snapshot.
 */
const CORE_CLIENT_SUBPATHS = [
  "@agent-native/core",
  "@agent-native/core/client",
  "@agent-native/core/client/chat",
  "@agent-native/core/client/collab",
  "@agent-native/core/client/composer",
  "@agent-native/core/client/conversation",
  "@agent-native/core/client/editor",
  "@agent-native/core/client/i18n",
  "@agent-native/core/client/resources",
  // Dedicated subpath that exports ONLY appBasePath/agentNativePath/appPath.
  // entry.client.tsx imports from here so it never pulls the full client barrel
  // (and its transitive ~650-700 KB gzip chat stack) onto the critical path.
  "@agent-native/core/client/api-path",
  "@agent-native/core/blocks",
  "@agent-native/core/blocks/server",
  "@agent-native/core/client/extensions",
  "@agent-native/core/client/tools", // legacy alias
  "@agent-native/core/client/org",
  "@agent-native/core/client/db-admin",
  "@agent-native/core/client/observability",
  "@agent-native/core/client/onboarding",
  "@agent-native/core/client/sharing",
  "@agent-native/core/client/notifications",
  "@agent-native/core/client/progress",
  "@agent-native/core/client/transcription/use-live-transcription",
  "@agent-native/core/voice",
];

const TOOLKIT_CLIENT_SUBPATHS = [
  "@agent-native/toolkit",
  "@agent-native/toolkit/app-shell",
  "@agent-native/toolkit/collab-ui",
  "@agent-native/toolkit/hooks",
  "@agent-native/toolkit/onboarding",
  "@agent-native/toolkit/provider",
  "@agent-native/toolkit/sharing",
  "@agent-native/toolkit/ui",
  "@agent-native/toolkit/utils",
];

const NODE_SSR_NATIVE_EXTERNALS = ["better-sqlite3", "bindings"];

function getDefaultOptimizeDeps(cwd: string): string[] {
  const inMonorepo = findCoreSrcDir(cwd) !== null;
  const entries: Array<{ specifier: string; packageName?: string }> = [
    // In monorepo mode the source alias resolves these to src/ on every
    // import, so prebundling from dist/ would just create a stale snapshot.
    // Skip them entirely — `optimizeDeps.exclude` below makes that explicit.
    ...(inMonorepo
      ? []
      : ([
          { specifier: "@agent-native/core" },
          {
            specifier: "@agent-native/core/client",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/chat",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/collab",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/composer",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/conversation",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/editor",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/i18n",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/resources",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/org",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/extensions",
            packageName: "@agent-native/core",
          },
          {
            // Legacy alias — prior name for @agent-native/core/client/extensions.
            // Keep so deployed templates that haven't been updated still resolve.
            specifier: "@agent-native/core/client/tools",
            packageName: "@agent-native/core",
          },
          ...TOOLKIT_CLIENT_SUBPATHS.map((specifier) => ({
            specifier,
            packageName: "@agent-native/toolkit",
          })),
        ] as Array<{ specifier: string; packageName?: string }>)),
    { specifier: "@libsql/client" },
    { specifier: "@amplitude/analytics-browser" },
    { specifier: "@assistant-ui/react" },
    { specifier: "@codemirror/lang-sql" },
    { specifier: "@codemirror/theme-one-dark" },
    { specifier: "@excalidraw/excalidraw" },
    { specifier: "@excalidraw/mermaid-to-excalidraw" },
    {
      specifier: "@modelcontextprotocol/ext-apps/app-bridge",
      packageName: "@modelcontextprotocol/ext-apps",
    },
    { specifier: "@paper-design/shaders-react" },
    { specifier: "@radix-ui/react-accordion" },
    { specifier: "@radix-ui/react-alert-dialog" },
    { specifier: "@radix-ui/react-aspect-ratio" },
    { specifier: "@radix-ui/react-avatar" },
    { specifier: "@radix-ui/react-checkbox" },
    { specifier: "@radix-ui/react-collapsible" },
    { specifier: "@radix-ui/react-context-menu" },
    { specifier: "@radix-ui/react-dialog" },
    { specifier: "@radix-ui/react-dropdown-menu" },
    { specifier: "@radix-ui/react-hover-card" },
    { specifier: "@radix-ui/react-label" },
    { specifier: "@radix-ui/react-menubar" },
    { specifier: "@radix-ui/react-navigation-menu" },
    { specifier: "@radix-ui/react-popover" },
    { specifier: "@radix-ui/react-progress" },
    { specifier: "@radix-ui/react-radio-group" },
    { specifier: "@radix-ui/react-scroll-area" },
    { specifier: "@radix-ui/react-select" },
    { specifier: "@radix-ui/react-separator" },
    { specifier: "@radix-ui/react-slider" },
    { specifier: "@radix-ui/react-slot" },
    { specifier: "@radix-ui/react-switch" },
    { specifier: "@radix-ui/react-tabs" },
    { specifier: "@radix-ui/react-toast" },
    { specifier: "@radix-ui/react-toggle" },
    { specifier: "@radix-ui/react-toggle-group" },
    { specifier: "@radix-ui/react-tooltip" },
    { specifier: "@sentry/browser" },
    {
      specifier: "@shadcn/react/message-scroller",
      packageName: "@shadcn/react",
    },
    { specifier: "@tanstack/react-query" },
    { specifier: "@tabler/icons-react" },
    { specifier: "@tiptap/core" },
    { specifier: "@tiptap/extension-code-block-lowlight" },
    { specifier: "@tiptap/extension-collaboration" },
    { specifier: "@tiptap/extension-collaboration-caret" },
    { specifier: "@tiptap/extension-image" },
    { specifier: "@tiptap/extension-link" },
    { specifier: "@tiptap/extension-placeholder" },
    { specifier: "@tiptap/extension-table" },
    { specifier: "@tiptap/extension-table-cell" },
    { specifier: "@tiptap/extension-table-header" },
    { specifier: "@tiptap/extension-table-row" },
    { specifier: "@tiptap/extension-task-item" },
    { specifier: "@tiptap/extension-task-list" },
    { specifier: "@tiptap/pm/state", packageName: "@tiptap/pm" },
    { specifier: "@tiptap/react" },
    { specifier: "@tiptap/starter-kit" },
    { specifier: "@uiw/react-codemirror" },
    { specifier: "@xterm/addon-fit" },
    { specifier: "@xterm/addon-web-links" },
    { specifier: "@xterm/xterm" },
    { specifier: "class-variance-authority" },
    { specifier: "clsx" },
    { specifier: "cmdk" },
    { specifier: "date-fns" },
    { specifier: "drizzle-orm" },
    { specifier: "drizzle-orm/pg-core", packageName: "drizzle-orm" },
    { specifier: "drizzle-orm/sqlite-core", packageName: "drizzle-orm" },
    { specifier: "embla-carousel-react" },
    { specifier: "h3" },
    {
      specifier: "highlight.js/lib/languages/bash",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/css",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/javascript",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/json",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/markdown",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/python",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/sql",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/typescript",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/xml",
      packageName: "highlight.js",
    },
    {
      specifier: "highlight.js/lib/languages/yaml",
      packageName: "highlight.js",
    },
    { specifier: "html2canvas" },
    { specifier: "i18next" },
    { specifier: "input-otp" },
    { specifier: "lowlight" },
    { specifier: "mermaid" },
    { specifier: "nanoid" },
    { specifier: "next-themes" },
    { specifier: "react-hook-form" },
    { specifier: "react-day-picker" },
    { specifier: "react-i18next" },
    { specifier: "react-markdown" },
    { specifier: "react-resizable-panels" },
    { specifier: "recharts" },
    ...(hasDep("react-router", cwd)
      ? [
          { specifier: "react-router" },
          { specifier: "react-router/dom", packageName: "react-router" },
        ]
      : []),
    { specifier: "remark-gfm" },
    { specifier: "roughjs" },
    { specifier: "shiki/core", packageName: "shiki" },
    { specifier: "shiki/engine/javascript", packageName: "shiki" },
    { specifier: "shiki/langs/bash.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/css.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/html.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/javascript.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/json.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/jsx.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/markdown.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/python.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/shellscript.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/sql.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/tsx.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/typescript.mjs", packageName: "shiki" },
    { specifier: "shiki/langs/yaml.mjs", packageName: "shiki" },
    { specifier: "shiki/themes/github-dark-default.mjs", packageName: "shiki" },
    {
      specifier: "shiki/themes/github-light-default.mjs",
      packageName: "shiki",
    },
    { specifier: "sonner" },
    { specifier: "tailwind-merge" },
    { specifier: "tiptap-markdown" },
    { specifier: "vaul" },
    { specifier: "y-protocols/awareness", packageName: "y-protocols" },
    { specifier: "yjs" },
    { specifier: "zod" },
  ];

  return entries
    .filter(({ specifier, packageName }) =>
      hasOptimizeDep(packageName ?? specifier, cwd),
    )
    .map(({ specifier, packageName }) => {
      const dependencyName = packageName ?? specifier;
      // In the monorepo, core is source-aliased and its dependencies live
      // under packages/core/node_modules. A bare optimizeDeps.include entry
      // is resolved from the template root, so core-only dependencies fail
      // the initial prebundle and are rediscovered after the page loads. Vite
      // then rebundles and reloads the editor. Its documented nested-dependency
      // syntax resolves the right-hand package from core's package directory,
      // while app-owned dependencies should remain direct entries.
      if (
        inMonorepo &&
        !hasDep(dependencyName, cwd) &&
        hasCoreDep(dependencyName, cwd)
      ) {
        return `@agent-native/core > ${specifier}`;
      }
      return specifier;
    });
}

/**
 * In monorepo dev mode, resolve @agent-native/core imports to source (src/)
 * instead of dist/ so that Vite HMR picks up changes without rebuilding.
 *
 * Returns Vite array-style aliases with exact matching (regex anchored with $)
 * to prevent `@agent-native/core` from prefix-matching and swallowing
 * sub-path imports like `@agent-native/core/client`.
 */
function getCoreSourceAliases(
  cwd: string,
): Array<{ find: RegExp; replacement: string }> {
  const coreSrc = findCoreSrcDir(cwd);
  if (!coreSrc) return []; // Not in monorepo — use dist as normal

  // Map every @agent-native/core/* export to its src/ equivalent.
  // Each entry uses a regex with $ anchor for exact matching.
  const entries: Record<string, string> = {
    "@agent-native/core": path.join(coreSrc, "index.browser.ts"),
    "@agent-native/core/server": path.join(coreSrc, "server/index.ts"),
    "@agent-native/core/server/edge": path.join(coreSrc, "server/edge.ts"),
    "@agent-native/core/client": path.join(coreSrc, "client/index.ts"),
    "@agent-native/core/client/chat": path.join(
      coreSrc,
      "client/chat/index.ts",
    ),
    "@agent-native/core/client/collab": path.join(
      coreSrc,
      "client/collab/index.ts",
    ),
    "@agent-native/core/client/composer": path.join(
      coreSrc,
      "client/composer/index.ts",
    ),
    "@agent-native/core/client/conversation": path.join(
      coreSrc,
      "client/conversation/index.ts",
    ),
    "@agent-native/core/client/editor": path.join(
      coreSrc,
      "client/editor/index.ts",
    ),
    "@agent-native/core/client/i18n": path.join(coreSrc, "client/i18n.tsx"),
    "@agent-native/core/client/resources": path.join(
      coreSrc,
      "client/resources/index.ts",
    ),
    // Dedicated thin subpath — only the URL helpers, no chat stack in the closure.
    "@agent-native/core/client/api-path": path.join(
      coreSrc,
      "client/api-path.ts",
    ),
    "@agent-native/core/blocks": path.join(coreSrc, "client/blocks/index.ts"),
    "@agent-native/core/blocks/server": path.join(
      coreSrc,
      "client/blocks/server.ts",
    ),
    "@agent-native/core/client/extensions": path.join(
      coreSrc,
      "client/extensions/index.ts",
    ),
    // Legacy alias — see exports map note above.
    "@agent-native/core/client/tools": path.join(
      coreSrc,
      "client/extensions/index.ts",
    ),
    "@agent-native/core/client/org": path.join(coreSrc, "client/org/index.ts"),
    "@agent-native/core/client/db-admin": path.join(
      coreSrc,
      "client/db-admin/index.ts",
    ),
    "@agent-native/core/client/observability": path.join(
      coreSrc,
      "client/observability/index.ts",
    ),
    "@agent-native/core/client/onboarding": path.join(
      coreSrc,
      "client/onboarding/index.ts",
    ),
    "@agent-native/core/client/sharing": path.join(
      coreSrc,
      "client/sharing/index.ts",
    ),
    "@agent-native/core/client/notifications": path.join(
      coreSrc,
      "client/notifications/index.ts",
    ),
    "@agent-native/core/client/progress": path.join(
      coreSrc,
      "client/progress/index.ts",
    ),
    "@agent-native/core/client/transcription/use-live-transcription": path.join(
      coreSrc,
      "client/transcription/use-live-transcription.ts",
    ),
    "@agent-native/core/voice": path.join(coreSrc, "voice/index.ts"),
    "@agent-native/core/db": path.join(coreSrc, "db/index.ts"),
    "@agent-native/core/db/schema": path.join(coreSrc, "db/schema.ts"),
    "@agent-native/core/shared": path.join(coreSrc, "shared/index.ts"),
    "@agent-native/core/scripts": path.join(coreSrc, "scripts/index.ts"),
    "@agent-native/core/application-state": path.join(
      coreSrc,
      "application-state/index.ts",
    ),
    "@agent-native/core/settings": path.join(coreSrc, "settings/index.ts"),
    "@agent-native/core/credentials": path.join(
      coreSrc,
      "credentials/index.ts",
    ),
    "@agent-native/core/resources": path.join(coreSrc, "resources/index.ts"),
    "@agent-native/core/oauth-tokens": path.join(
      coreSrc,
      "oauth-tokens/index.ts",
    ),
    "@agent-native/core/workspace-connections": path.join(
      coreSrc,
      "workspace-connections/index.ts",
    ),
    "@agent-native/core/provider-api": path.join(
      coreSrc,
      "provider-api/index.ts",
    ),
    "@agent-native/core/a2a": path.join(coreSrc, "a2a/index.ts"),
    "@agent-native/core/router": path.join(coreSrc, "router/index.ts"),
    "@agent-native/core/terminal": path.join(
      coreSrc,
      "client/terminal/index.ts",
    ),
    "@agent-native/core/terminal/server": path.join(
      coreSrc,
      "terminal/index.ts",
    ),
    "@agent-native/core/adapters/cli": path.join(
      coreSrc,
      "adapters/cli/index.ts",
    ),
    "@agent-native/core/usage": path.join(coreSrc, "usage/store.ts"),
    "@agent-native/core/brand-kit": path.join(coreSrc, "brand-kit/index.ts"),
    "@agent-native/core/data-widgets": path.join(
      coreSrc,
      "data-widgets/index.ts",
    ),
    "@agent-native/core/server/design-token-utils": path.join(
      coreSrc,
      "server/design-token-utils.ts",
    ),
    "@agent-native/core/server/entry-server": path.join(
      coreSrc,
      "server/entry-server.tsx",
    ),
    // Shared stylesheet — alias to src so CSS edits (composer/theme rules)
    // take effect live in dev instead of silently loading the stale built
    // copy at dist/styles/. From src/styles/ the `@source "../client/**"`
    // directive resolves to the real .tsx source, which is what dev should
    // scan for Tailwind classes anyway.
    "@agent-native/core/styles/agent-native.css": path.join(
      coreSrc,
      "styles/agent-native.css",
    ),
  };

  // Escape special regex chars in the key and anchor with $
  return Object.entries(entries).map(([find, replacement]) => ({
    find: new RegExp(`^${find.replace(/[/]/g, "\\/")}$`),
    replacement,
  }));
}

export interface NitroOptions {
  /** Nitro deployment preset (e.g. "node", "vercel", "netlify", "cloudflare_pages"). Default: "node" */
  preset?: string;
  /** Source directory for server files. Default: "./server" */
  srcDir?: string;
  /** Routes directory name (relative to srcDir). Default: "routes" */
  routesDir?: string;
  /** Any additional Nitro config overrides */
  [key: string]: unknown;
}

export interface ClientConfigOptions {
  /** Port for dev server. Default: 8080 */
  port?: number;
  /** Additional hostnames allowed to access the dev server. */
  allowedHosts?: NonNullable<NonNullable<UserConfig["server"]>["allowedHosts"]>;
  /** Vite log level. Workspace child apps default to "warn" so only the gateway URL is advertised. */
  logLevel?: UserConfig["logLevel"];
  /** Additional Vite plugins */
  plugins?: any[];
  /** Nitro plugin options (preset, srcDir, etc) */
  nitro?: NitroOptions;
  /** Override resolve aliases */
  aliases?: Record<string, string>;
  /** Override build.outDir. Default: "dist/spa" */
  outDir?: string;
  /** Additional fs.allow paths */
  fsAllow?: string[];
  /** Additional fs.deny patterns */
  fsDeny?: string[];
  /** Additional Vite optimizeDeps configuration */
  optimizeDeps?: NonNullable<UserConfig["optimizeDeps"]>;
  /** Additional Vite define constants. */
  define?: UserConfig["define"];
  /**
   * Framework route warmup behavior mounted by AgentSidebar.
   *
   * React Router's native prefetch warms both `.data` and JS, but its `.data`
   * request uses browser link prefetch. Chrome sends `Sec-Purpose: prefetch`
   * on those requests, which some production CDNs reject for dynamic `.data`
   * URLs before our SWR cache headers can help. Agent-Native therefore uses
   * ordinary fetches for `.data` and `modulepreload` for route JS by default.
   */
  routeWarmup?: AgentNativeRouteWarmupConfigInput;
  /**
   * Controls the MCP integrations catalog exposed from the composer + menu.
   *
   * - `false` hides the whole MCP integrations entry.
   * - `{ defaults: false }` hides all bundled provider presets but still
   *   allows custom MCP servers.
   * - `{ defaults: { include: ["context7"] } }` allows only those preset ids.
   * - `{ defaults: { exclude: ["stripe"] } }` hides specific preset ids.
   */
  mcpIntegrations?: McpIntegrationsConfigInput;
  /**
   * Whether to auto-inject the Tailwind v4 Vite plugin (`@tailwindcss/vite`).
   * Defaults to true — set to `false` if a template wants to manage Tailwind
   * itself (e.g. the legacy v3 PostCSS pipeline).
   */
  tailwind?: boolean;
  /**
   * Package names to stub in the SSR bundle with an empty proxy object.
   *
   * Use this for dependencies that only run in the browser (canvas / diagram
   * libraries, editors, WebGL) but would otherwise get pulled into the
   * server bundle via SSR's noExternal policy — pushing the CF Pages
   * Functions bundle over the 25 MiB limit.
   *
   * Only add packages that are provably never called during SSR. If the
   * server imports one, it will receive a Proxy that throws on any real
   * use (which is better than bundling a 10 MiB dep the worker never calls).
   *
   * @example
   * ssrStubs: ["mermaid", "@excalidraw/excalidraw"]
   */
  ssrStubs?: string[];
  /**
   * @deprecated Pass `reactRouter()` directly in the `plugins` array instead.
   * Previously used to auto-load the React Router Vite plugin via require(),
   * but this fails in ESM contexts. Templates should now do:
   * ```ts
   * import { reactRouter } from "@react-router/dev/vite";
   * defineConfig({ plugins: [reactRouter()] })
   * ```
   */
  reactRouter?: boolean | Record<string, unknown>;
}

export interface AgentNativeVitePluginOptions extends Omit<
  ClientConfigOptions,
  "plugins" | "reactRouter"
> {
  /**
   * Include the legacy React SWC transform for non-React Router SPA apps.
   *
   * React Router framework-mode apps should pass `reactRouter()` as a normal
   * Vite plugin and leave this off.
   */
  legacySpa?: boolean;
}

/**
 * Vite plugin that recovers the page when Vite's dependency optimizer
 * invalidates modules mid-load (the "504 Outdated Optimize Dep" error).
 *
 * Without this, the page silently fails: <script type="module"> tags 504,
 * React never mounts, and the user is stuck on a blank screen until they
 * manually refresh. We catch the failure modes and auto-reload, with a
 * visible overlay so the user knows what's happening, and a loop guard
 * so we never thrash forever.
 *
 * CRITICAL: this must be a SYNCHRONOUS (non-module) script injected at
 * `head-prepend`. Module scripts are deferred — the browser starts fetching
 * all module scripts in parallel during HTML parsing, so a module listener
 * registers AFTER sibling modules have already started loading and
 * possibly errored out. A regular <script> blocks parsing and runs
 * synchronously, so the listener is registered before ANY module fetch
 * begins.
 *
 * Catches three failure modes (all before React needs to mount):
 *   1. <script type="module"> / <link> 504 — window "error" event, capture phase
 *   2. Dynamic import 504 — "unhandledrejection" with "dynamically imported module"
 *   3. Child module 504 — resource timing when browser exposes the HTTP status
 */
function autoReloadOnOptimizeDep(): Plugin {
  return {
    name: "agent-native-auto-reload-optimize-dep",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          // NOTE: no `type: "module"` — this must be a synchronous script.
          children: getViteDevRecoveryScript(),
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

/**
 * Vite handles outdated optimized-dep requests inside its own transform
 * middleware and ends the HTTP response with `504 Outdated Optimize Dep`.
 * Browser module loaders do not consistently surface those child-module
 * failures to userland JavaScript, so also nudge the Vite HMR client from the
 * server side. This turns the confusing blank-screen state into the same
 * full-page reload Vite would have requested once optimization settled.
 */
function fullReloadOnOptimizeDep504(): Plugin {
  return {
    name: "agent-native-full-reload-optimize-dep-504",
    apply: "serve",
    configureServer(server) {
      let lastReloadAt = 0;
      server.middlewares.use((req, res, next) => {
        const originalEnd = res.end;
        (res as unknown as { end: (...args: unknown[]) => unknown }).end = (
          ...endArgs: unknown[]
        ) => {
          const statusMessage = String(res.statusMessage || "");
          if (
            res.statusCode === 504 &&
            statusMessage === "Outdated Optimize Dep"
          ) {
            const now = Date.now();
            if (now - lastReloadAt > 500) {
              lastReloadAt = now;
              server.ws.send({ type: "full-reload" });
              server.config.logger.info(
                `[agent-native] Vite optimized deps changed while loading ${
                  req.url ?? "a module"
                }; reloading the page.`,
                { timestamp: true },
              );
            }
          }
          return (originalEnd as (...args: unknown[]) => unknown).apply(
            res,
            endArgs,
          );
        };
        next();
      });
    },
  };
}

/**
 * Vite plugin that prevents the built-in base middleware from redirecting
 * "/" → "/app/" (or whatever the base is). When agent-native apps run with
 * --base /app/ in single-port mode, Vite's baseMiddleware sends a 302 from
 * "/" to the base path. This breaks Electron webview and iframe embeds
 * that load the app at the root. Instead, we rewrite "/" to the base path
 * internally so the app serves without a visible redirect.
 */
function baseRedirectGuard(): Plugin {
  return {
    name: "agent-native-base-redirect-guard",
    apply: "serve",
    configureServer(server) {
      // Return a function so the middleware is added AFTER Vite's internal
      // middleware is built — but we insert BEFORE by using the pre-hook
      // approach: configureServer hooks that return nothing run before
      // internal middleware.
      server.middlewares.use((req, res, next) => {
        const base = server.config.base;
        if (base && base !== "/" && req.url?.startsWith(base)) {
          const relativeUrl = req.url.slice(base.length - 1);
          try {
            const url = new URL(relativeUrl, "http://agent-native.local");
            const publicDir = server.config.publicDir;
            if (typeof publicDir !== "string") {
              return next();
            }
            const publicPath = path.normalize(
              path.join(publicDir, decodeURIComponent(url.pathname)),
            );
            if (
              publicPath.startsWith(publicDir + path.sep) &&
              fs.existsSync(publicPath) &&
              fs.statSync(publicPath).isFile()
            ) {
              const contentType = contentTypeForPublicFile(publicPath);
              if (contentType) res.setHeader("content-type", contentType);
              if (req.method === "HEAD") {
                res.statusCode = 200;
                res.end();
                return;
              }
              fs.createReadStream(publicPath).pipe(res);
              return;
            }
          } catch {
            // Fall through to Vite/Nitro. Malformed URLs should keep their
            // original path so the normal dev-server error handling applies.
          }
        }
        if (serveExternalEmbedBrowserManifest(server, req, res)) {
          return;
        }
        if (serveMountedEmbedRuntimeModule(server, req, res, base)) {
          return;
        }
        // Nitro's pre-middleware only intercepts document/iframe/frame/empty
        // fetch-dest requests. For video/audio/image etc. it calls next() and
        // the post-internal Nitro middleware handles them instead. If we strip
        // the base path here for those requests, Vite's base middleware sees the
        // stripped path (e.g. /api/video/:id without /clips/) and responds with
        // a "did you mean /clips/api/video/:id" error before Nitro can handle it.
        // Only strip when the request type matches Nitro's pre-middleware gate.
        const secFetchDest = req.headers["sec-fetch-dest"] as
          | string
          | undefined;
        const isNitroPreHandled =
          !secFetchDest || /^(document|iframe|frame|empty)$/.test(secFetchDest);
        if (isNitroPreHandled) {
          req.url = stripMountedDevApiPath(req.url, base);
        }
        if (
          req.method === "HEAD" &&
          req.url &&
          !isFrameworkDevPath(req.url, base)
        ) {
          req.method = "GET";
        }
        if (
          base &&
          base !== "/" &&
          (req.url === "/" || req.url === "/index.html")
        ) {
          // Rewrite to the base path so Vite serves the app directly
          req.url = base;
        }
        next();
      });
    },
  };
}

const VITE_RUNTIME_PATH_PREFIXES = [
  "/@fs/",
  "/@id/",
  "/@vite/",
  "/app/",
  "/node_modules/",
  "/packages/",
  "/src/",
];

const EMBED_DEV_STATIC_ASSET_PATH_PREFIXES = [
  ...VITE_RUNTIME_PATH_PREFIXES,
  "/assets/",
  "/library-presets/",
];

const EMBED_DEV_STATIC_ASSET_PATHS = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/manifest.json",
]);

function mountedPathCandidates(
  reqUrl: string | undefined,
  base: string | undefined,
): string[] {
  if (!reqUrl) return [];
  let pathname: string;
  try {
    pathname = new URL(reqUrl, "http://agent-native.local").pathname;
  } catch {
    return [];
  }
  if (base && base !== "/") {
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    if (pathname.startsWith(normalizedBase)) {
      return [pathname.slice(normalizedBase.length - 1) || "/"];
    }
  }
  return [pathname];
}

function isEmbedDevStaticAssetRequest(
  reqUrl: string | undefined,
  base: string | undefined,
): boolean {
  return mountedPathCandidates(reqUrl, base).some((pathname) => {
    if (EMBED_DEV_STATIC_ASSET_PATHS.has(pathname)) return true;
    if (/^\/icon-[^/]+\.svg$/i.test(pathname)) return true;
    if (/^\/agent-native-[^/]+\.svg$/i.test(pathname)) return true;
    return EMBED_DEV_STATIC_ASSET_PATH_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix),
    );
  });
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== "string" || !header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

function hasValidEmbedRuntimeToken(req: IncomingMessage): boolean {
  try {
    const url = new URL(req.url ?? "/", "http://agent-native.local");
    const queryToken = url.searchParams.get(EMBED_TOKEN_QUERY_PARAM);
    const cookieToken = cookieValue(req, EMBED_SESSION_COOKIE);
    return [queryToken, cookieToken].some(
      (token) => verifyEmbedSessionToken(token).ok,
    );
  } catch {
    return false;
  }
}

function mountedEmbedRuntimeModuleUrl(
  reqUrl: string | undefined,
  base: string | undefined,
): string | null {
  if (!reqUrl || !base || base === "/") return null;
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  if (!reqUrl.startsWith(normalizedBase)) return null;

  const runtimeUrl = reqUrl.slice(normalizedBase.length - 1) || "/";
  let url: URL;
  try {
    url = new URL(runtimeUrl, "http://agent-native.local");
  } catch {
    return null;
  }
  if (
    !VITE_RUNTIME_PATH_PREFIXES.some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  ) {
    return null;
  }
  url.searchParams.delete(EMBED_TOKEN_QUERY_PARAM);
  url.searchParams.delete(MCP_APP_CHAT_BRIDGE_QUERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

function virtualModuleIdFromRuntimeUrl(runtimeUrl: string): string | null {
  try {
    const pathname = new URL(runtimeUrl, "http://agent-native.local").pathname;
    const prefix = "/@id/__x00__";
    if (!pathname.startsWith(prefix)) return null;
    return `\0${decodeURIComponent(pathname.slice(prefix.length))}`;
  } catch {
    return null;
  }
}

async function loadMountedEmbedRuntimeModule(
  server: any,
  runtimeUrl: string,
): Promise<string | null> {
  const virtualId = virtualModuleIdFromRuntimeUrl(runtimeUrl);
  if (virtualId) {
    const loaded = await server.pluginContainer?.load?.(virtualId);
    if (typeof loaded === "string") return loaded;
    if (loaded && typeof loaded.code === "string") return loaded.code;
  }
  const result = await server.transformRequest(runtimeUrl);
  return result?.code ?? null;
}

function serveMountedEmbedRuntimeModule(
  server: any,
  req: IncomingMessage,
  res: ServerResponse,
  base: string | undefined,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!hasValidEmbedRuntimeToken(req)) return false;
  const runtimeUrl = mountedEmbedRuntimeModuleUrl(req.url, base);
  if (!runtimeUrl) return false;

  void loadMountedEmbedRuntimeModule(server, runtimeUrl)
    .then((code: string | null) => {
      if (!code) {
        if (!res.headersSent) {
          res.statusCode = 404;
          res.end();
        }
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/javascript");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(code);
    })
    .catch((err: unknown) => {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(err instanceof Error ? err.message : String(err));
    });
  return true;
}

function publicOriginFromDevRequest(req: IncomingMessage): string | null {
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
    .split(",")[0]
    ?.trim();
  const host =
    forwardedHost ||
    String(req.headers.host ?? "")
      .split(",")[0]
      ?.trim();
  if (!host) return null;
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  const proto =
    forwardedProto ||
    (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

function isReactRouterBrowserManifestUrl(reqUrl: string | undefined): boolean {
  if (!reqUrl) return false;
  try {
    const url = new URL(reqUrl, "http://agent-native.local");
    return (
      virtualModuleIdFromRuntimeUrl(url.pathname) ===
      "\0virtual:react-router/browser-manifest"
    );
  } catch {
    return false;
  }
}

function rewriteRootRelativeManifestUrls(
  code: string,
  publicOrigin: string,
): string {
  return code.replace(/'\/(?!\/)([^']*)'/g, (match, rest: string) => {
    try {
      return JSON.stringify(new URL(`/${rest}`, publicOrigin).toString());
    } catch {
      return match;
    }
  });
}

function serveExternalEmbedBrowserManifest(
  server: any,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!isMcpEmbedCorsOrigin(String(req.headers.origin ?? ""))) return false;
  if (!isReactRouterBrowserManifestUrl(req.url)) return false;
  const publicOrigin = publicOriginFromDevRequest(req);
  if (!publicOrigin) return false;
  const runtimeUrl = mountedEmbedRuntimeModuleUrl(req.url, "/") ?? req.url;
  if (!runtimeUrl) return false;

  void loadMountedEmbedRuntimeModule(server, runtimeUrl)
    .then((code: string | null) => {
      if (!code) {
        if (!res.headersSent) {
          res.statusCode = 404;
          res.end();
        }
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/javascript");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(rewriteRootRelativeManifestUrls(code, publicOrigin));
    })
    .catch((err: unknown) => {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(err instanceof Error ? err.message : String(err));
    });
  return true;
}

function embedDevFrameHeaders(): Plugin {
  return {
    name: "agent-native-embed-dev-frame-headers",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const origin = String(req.headers.origin ?? "");
        if (isEmbedDevStaticAssetRequest(req.url, server.config?.base)) {
          for (const [name, value] of Object.entries(
            MCP_EMBED_STATIC_ASSET_HEADERS,
          )) {
            res.setHeader(name, value);
          }
        }
        if (isMcpEmbedCorsOrigin(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          // The desktop app's dev origin (http://localhost:1420) also matches
          // here, and it logs in with `credentials: "include"`. A credentialed
          // request needs this header or the browser discards the response.
          // The OPTIONS short-circuit below means we can't rely on the real
          // auth handler to set it, so set it here too (production already does
          // the same).
          if (shouldAllowMcpEmbedCredentials(origin)) {
            res.setHeader("Access-Control-Allow-Credentials", "true");
          }
          res.setHeader(
            "Access-Control-Allow-Methods",
            "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
          );
          res.setHeader(
            "Access-Control-Allow-Headers",
            MCP_EMBED_CORS_ALLOW_HEADERS,
          );
          for (const [name, value] of Object.entries(
            MCP_EMBED_STATIC_ASSET_HEADERS,
          )) {
            if (name === "Access-Control-Allow-Origin") continue;
            res.setHeader(name, value);
          }
          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }
        }

        const cookieHeader = String(req.headers.cookie ?? "");
        let hasEmbedMarker = /\ban_embed_session=/.test(cookieHeader);
        try {
          const url = new URL(req.url ?? "/", "http://agent-native.local");
          hasEmbedMarker =
            hasEmbedMarker || url.searchParams.has("__an_embed_token");
        } catch {
          // Malformed URLs should continue through Vite's normal handling.
        }
        if (hasEmbedMarker) {
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          res.setHeader("Referrer-Policy", "no-referrer");
        }
        next();
      });
    },
  };
}

function contentTypeForPublicFile(filePath: string): string | null {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css";
    case ".html":
      return "text/html";
    case ".ico":
      return "image/x-icon";
    case ".json":
    case ".webmanifest":
      return "application/json";
    case ".js":
    case ".mjs":
      return "text/javascript";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain";
    case ".xml":
      return "application/xml";
    default:
      return null;
  }
}

function devPathname(reqUrl: string): string {
  return new URL(reqUrl, "http://agent-native.local").pathname;
}

function isApiDevPath(reqUrl: string): boolean {
  const pathname = devPathname(reqUrl);
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function stripMountedDevApiPath(
  reqUrl: string | undefined,
  base: string | undefined,
): string | undefined {
  if (!reqUrl || !base || base === "/") return reqUrl;
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  if (!reqUrl.startsWith(normalizedBase)) return reqUrl;
  const stripped = reqUrl.slice(normalizedBase.length - 1) || "/";
  return isApiDevPath(stripped) ? stripped : reqUrl;
}

export function isFrameworkDevPath(
  reqUrl: string,
  base: string | undefined,
): boolean {
  const pathname = devPathname(reqUrl);
  if (pathname === "/_agent-native" || pathname.startsWith("/_agent-native/")) {
    return true;
  }
  if (!base || base === "/") return false;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return (
    pathname === `${normalizedBase}/_agent-native` ||
    pathname.startsWith(`${normalizedBase}/_agent-native/`)
  );
}

/**
 * Work around a Rolldown bug where Nitro passes service entries as objects
 * ({index: "path"}) but Rolldown expects strings. This plugin normalizes
 * rollupOptions.input entries in the SSR environment.
 */
function rolldownInputFix(): Plugin {
  return {
    name: "agent-native-rolldown-input-fix",
    configEnvironment(_name, config) {
      const input = config.build?.rollupOptions?.input;
      if (!Array.isArray(input)) return;
      // Flatten any object entries to just their string values
      const fixed = input.map((entry: any) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "object" && entry !== null) {
          const values = Object.values(entry);
          return values[0] as string;
        }
        return entry;
      });
      config.build!.rollupOptions!.input = fixed;
    },
  };
}

/**
 * Replace caller-specified packages with an empty proxy stub during SSR
 * builds. For apps whose heavy browser-only deps would otherwise bloat the
 * edge worker past CF Pages' 25 MiB Functions limit.
 *
 * The template lists the packages in its `defineConfig({ ssrStubs })` call —
 * the framework never hardcodes package names.
 */
function ssrStubPlugin(packages: string[]): Plugin | null {
  if (!packages.length) return null;
  const stubbed = new Set(packages);
  const STUB_ID = "\0agent-native-ssr-stub";
  const namedExports = [
    "ActionBarPrimitive",
    "AllSelection",
    "Array",
    "AssistantRuntimeProvider",
    "Awareness",
    "BranchPickerPrimitive",
    "BubbleMenu",
    "CodeBlockLowlight",
    "Collaboration",
    "CollaborationCaret",
    "ComposerPrimitive",
    "CompositeAttachmentAdapter",
    "DOMParser",
    "Decoration",
    "DecorationSet",
    "Editor",
    "EditorContent",
    "Extension",
    "FitAddon",
    "Fragment",
    "Image",
    "Link",
    "Map",
    "Markdown",
    "Mark",
    "MessagePrimitive",
    "Node",
    "NodeSelection",
    "NodeViewContent",
    "NodeViewWrapper",
    "Placeholder",
    "Plugin",
    "PluginKey",
    "ReactNodeViewRenderer",
    "Selection",
    "SimpleImageAttachmentAdapter",
    "SimpleTextAttachmentAdapter",
    "StarterKit",
    "Table",
    "TableCell",
    "TableHeader",
    "TableRow",
    "TaskItem",
    "TaskList",
    "Terminal",
    "TextSelection",
    "ThreadPrimitive",
    "WebLinksAddon",
    "captureException",
    "common",
    "createLowlight",
    "createNodeFromContent",
    "defaultUrlTransform",
    "extensions",
    "findTable",
    "format",
    "Doc",
    "getHTMLFromFragment",
    "getIsolationScope",
    "init",
    "isChangeOrigin",
    "mergeAttributes",
    "renderToString",
    "applyUpdate",
    "encodeStateVector",
    "encodeStateAsUpdate",
    "mergeUpdates",
    "useAui",
    "useComposer",
    "useComposerRuntime",
    "useCurrentEditor",
    "useEditor",
    "useLocalRuntime",
    "useMessagePartReasoning",
    "useMessagePartText",
    "useMessageRuntime",
    "useThread",
    "useThreadRuntime",
    "withScope",
    "XmlFragment",
    "XmlText",
  ];
  return {
    name: "agent-native-ssr-stub-heavy-libs",
    enforce: "pre",
    resolveId(id, _importer, opts) {
      if (!opts?.ssr) return null;
      // Match the bare package name or any subpath
      const pkg = id
        .split("/")
        .slice(0, id.startsWith("@") ? 2 : 1)
        .join("/");
      if (stubbed.has(pkg)) return STUB_ID;
      return null;
    },
    load(id) {
      if (id !== STUB_ID) return null;
      // Proxy that answers any property access with itself — lets dead
      // import/re-export chains parse without blowing up, and still throws
      // if code actually tries to call any of it on the server.
      return (
        "const handler = { get(_, p) { " +
        "if (p === Symbol.toPrimitive) return () => ''; " +
        "if (p === 'then') return undefined; " +
        "return new Proxy(() => {}, handler); " +
        "} };" +
        "const stub = new Proxy(() => {}, handler);" +
        "export default stub;" +
        namedExports.map((name) => `export const ${name} = stub;`).join("")
      );
    },
  };
}

function splitViteRequest(id: string): { file: string; query: string } | null {
  const queryIndex = id.indexOf("?");
  if (queryIndex === -1) return null;
  return {
    file: id.slice(0, queryIndex),
    query: id.slice(queryIndex + 1),
  };
}

function hasRawQuery(query: string): boolean {
  return new URLSearchParams(query).has("raw");
}

function normalizeViteFilePath(file: string): string | null {
  if (!file || file.startsWith("\0")) return null;
  const fsPath = file.startsWith("/@fs/") ? file.slice("/@fs".length) : file;
  try {
    return decodeURI(fsPath);
  } catch {
    return fsPath;
  }
}

function changelogRawPathFromId(id: string): string | null {
  const request = splitViteRequest(id);
  if (!request || !hasRawQuery(request.query)) return null;
  const file = normalizeViteFilePath(request.file);
  if (!file || path.basename(file) !== "CHANGELOG.md") return null;
  return path.resolve(file);
}

function resolveChangelogRawImport(
  source: string,
  importer: string | undefined,
): string | null {
  const request = splitViteRequest(source);
  if (!request || !hasRawQuery(request.query)) return null;
  const rawFile = normalizeViteFilePath(request.file);
  if (!rawFile || path.basename(rawFile) !== "CHANGELOG.md") return null;

  const rawImporter = importer?.split("?")[0];
  const importerFile =
    (rawImporter && normalizeViteFilePath(rawImporter)) ||
    rawImporter ||
    path.join(process.cwd(), "index.ts");
  const resolved = path.isAbsolute(rawFile)
    ? rawFile
    : path.resolve(path.dirname(importerFile), rawFile);
  return `${resolved}?${request.query}`;
}

function readAppChangelogMarkdown(
  changelogPath: string,
  watchFile: (file: string) => void,
): string {
  // Only ever register real files with Vite's `addWatchFile`. Passing a
  // directory makes import-analysis try to resolve it as a module and fail
  // with "Failed to resolve import .../changelog", which breaks hydration for
  // every template in dev. New/removed pending files are still picked up via
  // `handleHotUpdate` (Vite watches the project root recursively).
  watchFile(changelogPath);
  const existing = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, "utf-8")
    : "";
  const pendingDir = path.join(path.dirname(changelogPath), "changelog");
  if (!fs.existsSync(pendingDir)) {
    return existing;
  }

  const pending = fs
    .readdirSync(pendingDir)
    .filter(
      (file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md",
    )
    .sort()
    .map((file) => {
      const filePath = path.join(pendingDir, file);
      watchFile(filePath);
      // `agent-native changelog add` prefixes every pending filename with its
      // date. Preserve that date when a hand-written entry omits `date:` so a
      // deployed What's new surface never groups an already-merged update
      // under an inaccurate "Unreleased" heading.
      const filenameDate = file.match(/^(\d{4}-\d{2}-\d{2})(?:-|\.md$)/)?.[1];
      return parsePendingEntry(
        fs.readFileSync(filePath, "utf-8"),
        filenameDate,
      );
    });
  return mergePendingChangelog(existing, pending);
}

function isChangelogSourceFile(file: string): boolean {
  if (path.basename(file) === "CHANGELOG.md") return true;
  return (
    path.basename(path.dirname(file)) === "changelog" &&
    file.endsWith(".md") &&
    path.basename(file).toLowerCase() !== "readme.md"
  );
}

function invalidateChangelogRawModules(server: {
  moduleGraph?: { idToModuleMap?: Map<string, any>; invalidateModule?: any };
}) {
  const moduleGraph = server.moduleGraph;
  if (!moduleGraph?.idToModuleMap || !moduleGraph.invalidateModule) return;
  for (const mod of moduleGraph.idToModuleMap.values()) {
    if (!mod?.id || !changelogRawPathFromId(mod.id)) continue;
    moduleGraph.invalidateModule(mod);
  }
}

function appChangelogRawPlugin(): Plugin {
  return {
    name: "agent-native-app-changelog-raw",
    enforce: "pre",
    resolveId(source, importer) {
      return resolveChangelogRawImport(source, importer);
    },
    load(id) {
      const changelogPath = changelogRawPathFromId(id);
      if (!changelogPath) return null;
      const markdown = readAppChangelogMarkdown(changelogPath, (file) =>
        this.addWatchFile(file),
      );
      return `export default ${JSON.stringify(markdown)};`;
    },
    handleHotUpdate(ctx) {
      if (!isChangelogSourceFile(ctx.file)) return;
      invalidateChangelogRawModules(ctx.server as any);
      ctx.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}

/**
 * Expose the resolved Vite dev server port as process.env.PORT so that
 * in-process scripts (which use localFetch → http://localhost:${PORT}/api/...)
 * hit the right address even when Vite auto-increments the port.
 */
function portExposer(): Plugin {
  return {
    name: "agent-native-port-exposer",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const addr = server.httpServer?.address();
        if (addr && typeof addr === "object" && addr.port) {
          process.env.PORT = String(addr.port); // guard:allow-env-mutation — Vite dev server port published once at boot before any request
        }
      });
    },
  };
}

/**
 * Silence benign connection-reset noise from Vite's dev middleware.
 * Fires when a browser closes/reloads/navigates mid-request — the peer has
 * already gone away, there's nothing to fix, and Vite's error middleware
 * spams the terminal and browser HMR overlay with errors like
 * "read ECONNRESET" and "socket hang up". Our H3 server layer already
 * swallows these (create-server.ts onError); this plugin does the same for
 * Vite's own connect pipeline.
 */
function silenceConnectionResets(): Plugin {
  const isClosedWebStreamController = (err: unknown) => {
    const e = err as
      | (NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException })
      | undefined;
    const code = e?.code || (e?.cause as NodeJS.ErrnoException)?.code;
    const message = [
      String(e?.message ?? ""),
      String((e?.cause as NodeJS.ErrnoException | undefined)?.message ?? ""),
    ].join("\n");
    const stack = [
      String(e?.stack ?? ""),
      String((e?.cause as NodeJS.ErrnoException | undefined)?.stack ?? ""),
    ].join("\n");
    return (
      code === "ERR_INVALID_STATE" &&
      /Controller is already closed/i.test(message) &&
      (!stack ||
        /ReadableStreamDefaultController\.close|internal\/webstreams\/adapters|IncomingMessage\.onclose/.test(
          stack,
        ))
    );
  };
  const isBenign = (err: unknown) => {
    const e = err as
      | (NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException })
      | undefined;
    const code = e?.code || (e?.cause as NodeJS.ErrnoException)?.code;
    const message = String(e?.message ?? "");
    return (
      code === "ECONNRESET" ||
      code === "ECONNABORTED" ||
      code === "EPIPE" ||
      isClosedWebStreamController(err) ||
      /^(read ECONNRESET|write ECONNRESET|socket hang up|aborted|write EPIPE)$/i.test(
        message,
      )
    );
  };
  const isBenignErrorPayload = (payload: unknown) => {
    const p = payload as { type?: string; err?: unknown } | undefined;
    return p?.type === "error" && isBenign(p.err);
  };
  return {
    name: "agent-native-silence-connection-resets",
    apply: "serve",
    configureServer(server) {
      // Swallow socket-level resets so Node doesn't surface them as uncaught.
      server.httpServer?.on("connection", (socket) => {
        socket.on("error", (err: Error) => {
          if (!isBenign(err)) throw err;
        });
      });
      // Drop Vite's "Internal server error: read ECONNRESET" log lines.
      const origError = server.config.logger.error.bind(server.config.logger);
      server.config.logger.error = (msg, opts) => {
        const text = typeof msg === "string" ? msg : String(msg ?? "");
        if (
          (opts?.error && isBenign(opts.error)) ||
          /Internal server error:\s*(read ECONNRESET|write ECONNRESET|socket hang up|aborted|EPIPE)/i.test(
            text,
          )
        ) {
          return;
        }
        origError(msg, opts);
      };

      // Vite's error middleware sends these same benign errors to the HMR
      // client, which turns them into the full-screen browser overlay.
      // Suppress just those payloads while leaving real transform/runtime
      // errors untouched.
      const hot = (
        server as unknown as {
          environments?: { client?: { hot?: { send?: Function } } };
        }
      ).environments?.client?.hot;
      if (hot?.send) {
        const origHotSend = hot.send.bind(hot);
        hot.send = (payload: unknown, ...args: unknown[]) => {
          if (isBenignErrorPayload(payload)) return;
          return origHotSend(payload, ...args);
        };
      }

      const ws = (server as unknown as { ws?: { send?: Function } }).ws;
      if (ws?.send) {
        const origWsSend = ws.send.bind(ws);
        ws.send = (payload: unknown, ...args: unknown[]) => {
          if (isBenignErrorPayload(payload)) return;
          return origWsSend(payload, ...args);
        };
      }
    },
  };
}

type AgentNativeViteCommand = ConfigEnv["command"];

function isBuildCommand(command?: AgentNativeViteCommand): boolean {
  return command === "build" || (!command && process.argv.includes("build"));
}

function hasReactRouterPlugin(plugins: any[] | undefined): boolean {
  return Boolean(
    plugins?.some(
      (p: any) =>
        p?.name === "react-router" ||
        (Array.isArray(p) && p.some((pp: any) => pp?.name === "react-router")),
    ),
  );
}

function createReactTransformPlugin(): any {
  try {
    let reactTransformPlugin = require("@vitejs/plugin-react-swc");
    if (reactTransformPlugin.default)
      reactTransformPlugin = reactTransformPlugin.default;
    return reactTransformPlugin?.();
  } catch {
    // Will be resolved at runtime by Vite
    return null;
  }
}

function createTailwindPlugin(options: Pick<ClientConfigOptions, "tailwind">) {
  if (options.tailwind === false) return null;
  try {
    let tailwindPlugin = require("@tailwindcss/vite");
    if (tailwindPlugin.default) tailwindPlugin = tailwindPlugin.default;
    // Tailwind's Vite optimizer uses Lightning CSS internally and runs
    // before Vite's own CSS minifier. Lightning CSS collapses the standard
    // `backdrop-filter` declaration when a `-webkit-` fallback is present,
    // so let Vite/esbuild handle the production CSS pass instead.
    return tailwindPlugin({ optimize: false });
  } catch {
    // Plugin not installed — silently skip. Old templates may still be on v3.
    return null;
  }
}

function getConfiguredAppBasePath(): { appBasePath: string; base: string } {
  // APP_BASE_PATH lets this app be mounted under a prefix (e.g. "/mail") as
  // part of a unified workspace deploy. Defaults to "/" for standalone apps.
  const appBasePath =
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "/";
  const base = appBasePath.endsWith("/") ? appBasePath : `${appBasePath}/`;
  return { appBasePath, base };
}

function createNitroDevPlugin(
  options: Pick<ClientConfigOptions, "nitro">,
  appBasePath: string,
) {
  return nitroVitePlugin({
    serverDir: "./server",
    ...(options.nitro ?? {}),
    // Never auto-load test files as server handlers/plugins/middleware.
    // Nitro scans server/{plugins,middleware,routes,api}/*; a co-located
    // *.spec.ts would otherwise be loaded at runtime and crash the server
    // (its top-level vitest calls throw). Keep tests next to their source safely.
    ignore: [
      ...((options.nitro as { ignore?: string[] })?.ignore ?? []),
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    routeRules: {
      ...mcpEmbedStaticAssetRouteRules(appBasePath),
      ...((options.nitro as { routeRules?: Record<string, any> })?.routeRules ??
        {}),
    },
  } as any);
}

function arrayFrom<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function localWorkspacePackageAliases(
  packages: Array<{ packageName: string; packageDir: string }>,
): any[] {
  const aliases: any[] = [];
  const sourceAliasExcludes = new Set(["@agent-native/pinpoint"]);

  for (const { packageName, packageDir } of packages) {
    if (sourceAliasExcludes.has(packageName)) continue;
    const pkgPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const exportsMap = pkg.exports as Record<string, unknown> | undefined;
      if (!exportsMap || typeof exportsMap !== "object") continue;

      for (const [exportPath, target] of Object.entries(exportsMap)) {
        const exportTarget = localWorkspaceExportTarget(packageDir, target);
        if (!exportTarget) continue;
        const importPath =
          exportPath === "."
            ? packageName
            : `${packageName}${exportPath.slice(1)}`;
        const replacement = path.resolve(packageDir, exportTarget);

        if (importPath.includes("*") || replacement.includes("*")) {
          aliases.push({
            find: new RegExp(
              `^${escapeRegex(importPath).replace("\\*", "(.+)")}$`,
            ),
            replacement: replacement.replace("*", "$1"),
          });
          continue;
        }

        aliases.push({
          find: new RegExp(`^${escapeRegex(importPath)}$`),
          replacement,
        });
      }
    } catch {
      // Ignore malformed package metadata; normal package resolution can handle it.
    }
  }

  return aliases;
}

function localWorkspaceExportTarget(
  packageDir: string,
  target: unknown,
): string | null {
  const rawTarget = pickLocalWorkspaceExportTarget(target);
  if (!rawTarget) return null;
  return distExportToSourceTarget(packageDir, rawTarget);
}

function pickLocalWorkspaceExportTarget(target: unknown): string | null {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return null;
  }

  const record = target as Record<string, unknown>;
  for (const condition of ["development", "browser", "import", "default"]) {
    const resolved = pickLocalWorkspaceExportTarget(record[condition]);
    if (resolved) return resolved;
  }
  return null;
}

function distExportToSourceTarget(packageDir: string, target: string): string {
  if (!target.startsWith("./dist/")) return target;

  if (target.includes("*")) {
    return target
      .replace("./dist/", "./src/")
      .replace(/\.d\.ts$/, "")
      .replace(/\.js$/, "");
  }

  const sourceBase = target
    .replace("./dist/", "./src/")
    .replace(/\.d\.ts$/, "")
    .replace(/\.js$/, "");
  const candidates = target.endsWith(".css")
    ? [sourceBase]
    : [`${sourceBase}.tsx`, `${sourceBase}.ts`, sourceBase];

  for (const candidate of candidates) {
    if (fs.existsSync(path.resolve(packageDir, candidate))) return candidate;
  }
  return target;
}

function aliasArrayFrom(alias: unknown): any[] {
  if (!alias) return [];
  if (Array.isArray(alias)) return alias;
  if (typeof alias === "object") {
    return Object.entries(alias as Record<string, string>).map(
      ([find, replacement]) => ({ find, replacement }),
    );
  }
  return [];
}

const DEFAULT_VITE_WATCH_IGNORES = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.react-router/**",
  "**/.generated/**",
  "**/.agents/**",
  "**/.claude/**",
  "**/data/**",
  "**/dist/**",
  "**/build/**",
];

function forceServeOnly(pluginOrPreset: any): any {
  if (Array.isArray(pluginOrPreset)) return pluginOrPreset.map(forceServeOnly);
  return { ...pluginOrPreset, apply: "serve" };
}

function createAgentNativePlugins(
  options: ClientConfigOptions | AgentNativeVitePluginOptions,
  {
    command,
    includeReactTransform,
    useServeOnlyNitroPlugin = false,
    userPlugins = [],
  }: {
    command?: AgentNativeViteCommand;
    includeReactTransform: boolean;
    useServeOnlyNitroPlugin?: boolean;
    userPlugins?: any[];
  },
): any[] {
  const { appBasePath } = getConfiguredAppBasePath();
  const nitroPlugin = createNitroDevPlugin(options, appBasePath);
  const includeNitro = !isBuildCommand(command);

  return [
    // Stub packages from `options.ssrStubs` in the SSR bundle so they
    // don't bloat the edge worker. Opt-in per template — the framework
    // hardcodes nothing (e.g. docs sites legitimately import `shiki` on
    // the server, so we can't blanket-stub it here).
    ssrStubPlugin(options.ssrStubs ?? []),
    ...userPlugins,
    appChangelogRawPlugin(),
    actionTypesPlugin(),
    agentsBundlePlugin(),
    autoReloadOnOptimizeDep(),
    fullReloadOnOptimizeDep504(),
    embedDevFrameHeaders(),
    baseRedirectGuard(),
    portExposer(),
    silenceConnectionResets(),
    rolldownInputFix(),
    // Nitro Vite plugin for dev-mode API route serving and HMR.
    // Disabled during build — React Router's build handles production.
    ...(useServeOnlyNitroPlugin
      ? [forceServeOnly(nitroPlugin)]
      : includeNitro
        ? [nitroPlugin]
        : []),
    includeReactTransform ? createReactTransformPlugin() : null,
    createTailwindPlugin(options),
  ].filter(Boolean);
}

function createAgentNativeConfig(
  options: ClientConfigOptions | AgentNativeVitePluginOptions = {},
  command?: AgentNativeViteCommand,
  userConfig: UserConfig = {},
): UserConfig {
  const cwd = process.cwd();

  // Workspace env fallback. If this app is inside a workspace, tell Vite to
  // also look for .env files at the workspace root. Per-app .env still wins
  // (Vite's loadEnv merges in precedence order — app dir is loaded after).
  const workspaceRoot = findWorkspaceRoot(cwd);
  const envDir = workspaceRoot && workspaceRoot !== cwd ? workspaceRoot : cwd;

  // Preload workspace-root .env into process.env so Nitro server code sees
  // shared keys during dev (Nitro reads process.env, not vite's envDir).
  if (workspaceRoot && workspaceRoot !== cwd) {
    try {
      const dotenv = require("dotenv");
      dotenv.config({
        path: path.join(workspaceRoot, ".env"),
        override: false,
        // Suppress the dotenv v17 tip line — this loader fires alongside
        // utils.ts loadEnv() during dev startup and would otherwise emit a
        // duplicate "[dotenv] injecting env" message.
        quiet: true,
      });
    } catch {}
  }

  const { base } = getConfiguredAppBasePath();
  const isWorkspaceChild = process.env.AGENT_NATIVE_WORKSPACE === "1";
  const monorepoCoreAllow = [
    path.resolve(cwd, "../../packages/core"),
    path.resolve(cwd, "../core"),
  ].filter((candidate) => fs.existsSync(path.join(candidate, "package.json")));
  const monorepoNodeModulesAllow = [
    path.resolve(cwd, "../../node_modules"),
  ].filter((candidate) => fs.existsSync(candidate));

  // Workspace-core (enterprise monorepo): pull its directory into Vite's
  // file watcher + module graph so edits to its TS sources hot-reload the
  // dev server, and its package name into ssr.noExternal so the dynamic
  // import in framework-request-handler.ts goes through Vite's transform
  // pipeline (TypeScript, SSR HMR, the works).
  const workspaceCore = findWorkspaceCoreSync(cwd);
  const workspaceCoreFsAllow = workspaceCore
    ? [
        workspaceCore.packageDir,
        // Also allow the workspace root's node_modules so Vite can serve
        // pnpm-hoisted transitive deps (e.g. recharts, es-toolkit) as native
        // ESM when they are excluded from the Rolldown optimizer.
        path.join(workspaceCore.workspaceRoot, "node_modules"),
      ]
    : [];
  const workspaceNodeModulesAllow = isWorkspaceChild
    ? [path.resolve(cwd, "../../node_modules")]
    : [];
  const packageWorkspaceRoot = workspaceRoot ?? findPnpmWorkspaceRoot(cwd);
  const localWorkspacePackageDeps = findLocalWorkspacePackageDeps(
    cwd,
    packageWorkspaceRoot,
  );
  const localWorkspacePackageAllow = localWorkspacePackageDeps.map(
    (pkg) => pkg.packageDir,
  );
  const localWorkspacePackageResolveAliases = localWorkspacePackageAliases(
    localWorkspacePackageDeps,
  );
  const workspaceCoreNoExternal = workspaceCore
    ? [new RegExp(`^${escapeRegex(workspaceCore.packageName)}(/.*)?$`)]
    : [];
  const localWorkspacePackageNoExternal = localWorkspacePackageDeps.map(
    (pkg) => new RegExp(`^${escapeRegex(pkg.packageName)}(/.*)?$`),
  );
  const forcePollingWatch = process.env.CHOKIDAR_USEPOLLING === "1";
  const pollingWatchInterval = Number(process.env.CHOKIDAR_INTERVAL ?? 1000);
  const userWatch = userConfig.server?.watch ?? {};

  return {
    logLevel:
      options.logLevel ??
      userConfig.logLevel ??
      (isWorkspaceChild ? "warn" : undefined),
    envDir,
    base,
    define: {
      ...(userConfig.define ?? {}),
      ...(options.define ?? {}),
      __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__: JSON.stringify(
        process.env.GA_MEASUREMENT_ID?.trim() || "",
      ),
      "process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID": JSON.stringify(
        process.env.GA_MEASUREMENT_ID?.trim() || "",
      ),
      // Framework route warmup controls how SSR `.data` routes are fetched:
      // ordinary fetches keep them CDN-cacheable, while native prefetch headers
      // can be refused before the CDN/origin sees the request. Keep this value
      // authoritative even if app config provides its own `define` entries.
      __AGENT_NATIVE_ROUTE_WARMUP_CONFIG__: JSON.stringify(
        normalizeAgentNativeRouteWarmupConfig(options.routeWarmup),
      ),
      __AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__: JSON.stringify(
        normalizeMcpIntegrationsConfig(options.mcpIntegrations),
      ),
    },
    server: {
      ...(userConfig.server ?? {}),
      host: userConfig.server?.host ?? "::",
      port: options.port ?? userConfig.server?.port ?? 8080,
      allowedHosts: options.allowedHosts ??
        userConfig.server?.allowedHosts ?? [
          ".ngrok-free.dev",
          ".ngrok-free.app",
          ".ngrok.io",
          ".trycloudflare.com",
        ],
      watch: {
        ...userWatch,
        ignored: [
          ...DEFAULT_VITE_WATCH_IGNORES,
          ...arrayFrom((userWatch as { ignored?: any })?.ignored),
        ],
        ...(forcePollingWatch
          ? {
              usePolling: true,
              interval: Number.isFinite(pollingWatchInterval)
                ? pollingWatchInterval
                : 1000,
            }
          : {}),
      },
      fs: {
        ...(userConfig.server?.fs ?? {}),
        allow: [
          ".",
          ...monorepoCoreAllow,
          ...monorepoNodeModulesAllow,
          ...workspaceCoreFsAllow,
          ...localWorkspacePackageAllow,
          ...workspaceNodeModulesAllow,
          ...(userConfig.server?.fs?.allow ?? []),
          ...(options.fsAllow ?? []),
        ],
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          ...(userConfig.server?.fs?.deny ?? []),
          ...(options.fsDeny ?? []),
        ],
      },
    },
    build: {
      ...(userConfig.build ?? {}),
      outDir: options.outDir ?? userConfig.build?.outDir ?? "dist/spa",
      // Vite 8 defaults CSS minification to Lightning CSS, which collapses a
      // `backdrop-filter` + `-webkit-backdrop-filter` pair down to only the
      // prefixed form. Chrome ignores that, so glass effects disappear in
      // production. Keep esbuild as the CSS minifier and target Safari 18+ so
      // the standard property survives the production pipeline.
      cssMinify: userConfig.build?.cssMinify ?? "esbuild",
      cssTarget: userConfig.build?.cssTarget ?? ["es2020", "safari18"],
    },
    // Bundle all non-Node.js deps into the production SSR server build.
    // Edge runtimes (CF Workers, Deno) don't have node_modules at runtime.
    // In dev, React Router's Vite Environment runner expects CJS packages
    // like React to stay external; forcing them through the module runner
    // raises `module is not defined`.
    ssr: isBuildCommand(command)
      ? {
          ...(userConfig.ssr ?? {}),
          noExternal: /^(?!node:)/,
          external: [
            // Yjs is used by both server-side collaboration actions and the
            // client SSR graph. If Vite inlines it here, Nitro also emits its
            // own server copy and a single request imports Yjs twice, breaking
            // Yjs constructor identity. This externalizes only Vite's
            // intermediate React Router SSR graph; Nitro's final Node/edge
            // bundle still owns and bundles the dependency, so both paths
            // share one portable module instance.
            "yjs",
            ...NODE_SSR_NATIVE_EXTERNALS,
            ...arrayFrom((userConfig.ssr as { external?: any })?.external),
          ],
          // Pick the workspace-core's compiled `dist/` exports in prod —
          // Node-style `default` condition matches what edge runtimes (CF
          // Workers, Deno) can actually load. Without this, Vite's prod
          // build inherits the dev-condition src/ entry and ships unbuilt
          // TypeScript into the worker.
          resolve: {
            ...((
              userConfig.ssr as
                | { resolve?: Record<string, unknown> }
                | undefined
            )?.resolve ?? {}),
            conditions: ["node", "module", "import", "default"],
            externalConditions: ["node", "module", "import", "default"],
          },
        }
      : {
          ...(userConfig.ssr ?? {}),
          // Vite already sets `development` in the dev resolve conditions,
          // so the workspace-core template's exports.development → src/
          // entry is picked automatically — Vite handles TS compilation
          // and triggers a server restart when those files change.
          noExternal: [
            /^@agent-native\/core(\/.*)?$/,
            // Keep React Router in Vite's SSR module graph so resolve.dedupe
            // can force root.tsx and core's shared entry-server through the
            // same FrameworkContext instance.
            ...(hasDep("react-router", cwd) ? [/^react-router(\/.*)?$/] : []),
            // Radix UI primitives are transitive deps of @agent-native/core
            // (used by FeedbackButton, AgentSidebar, ShareDialog, etc.). When
            // a consumer app SSRs a component that imports Radix, Node's
            // externalized resolver can't find @radix-ui/* from the app cwd
            // because pnpm doesn't hoist transitive deps. Bundling them
            // through Vite resolves them via the workspace store.
            /^@radix-ui\//,
            // scheduling ships TypeScript-compiled dist files that contain literal
            // `@/` path-alias imports (e.g. `import { Input } from
            // "@/components/ui/input"`). In standalone (published) mode Node
            // treats the package as an external CJS dep and can't resolve
            // `@/components`. Adding it to noExternal makes Vite process it
            // through the module pipeline, where the consumer app's `@` →
            // `./app` alias is already registered.
            ...(hasDep("@agent-native/scheduling", cwd)
              ? [/^@agent-native\/scheduling(\/.*)?$/]
              : []),
            ...workspaceCoreNoExternal,
            ...localWorkspacePackageNoExternal,
            ...arrayFrom((userConfig.ssr as { noExternal?: any })?.noExternal),
          ],
          external: [
            "react",
            "react-dom",
            "react-dom/server",
            ...arrayFrom((userConfig.ssr as { external?: any })?.external),
          ],
        },
    optimizeDeps: {
      ...(userConfig.optimizeDeps ?? {}),
      include: [
        ...getDefaultOptimizeDeps(cwd),
        ...(hasDep("@agent-native/pinpoint", cwd)
          ? ["@agent-native/pinpoint/react"]
          : []),
        ...(userConfig.optimizeDeps?.include ?? []),
        ...(options.optimizeDeps?.include ?? []),
      ],
      // In monorepo mode: explicitly exclude @agent-native/core subpaths so
      // Vite never prebundles them from dist/. The source alias above
      // (`getCoreSourceAliases`) resolves every import to src/ on every
      // request, so HMR picks up new exports immediately. Without exclude,
      // the prebundle is built from dist/ once at startup and silently
      // serves stale code even after the source / dist is updated.
      exclude: [
        ...(findCoreSrcDir(cwd) !== null ? CORE_CLIENT_SUBPATHS : []),
        ...(userConfig.optimizeDeps?.exclude ?? []),
        ...(options.optimizeDeps?.exclude ?? []),
      ],
    },
    resolve: {
      ...(userConfig.resolve ?? {}),
      // Dedupe all client-side packages that core shares with the consuming
      // app. In pnpm monorepos, core's devDependencies can install separate
      // copies (linked to different React versions). Without deduping, each
      // copy creates its own React context — QueryClientProvider, RouterProvider,
      // Radix, etc. — causing "No provider" crashes at runtime.
      dedupe: [
        ...getClientDedupe(cwd),
        ...arrayFrom((userConfig.resolve as { dedupe?: any })?.dedupe),
      ],
      alias: [
        // Published npm installs: one react-router instance for app + core.
        ...getReactRouterAliases(cwd),
        // In monorepo dev: resolve @agent-native/core to source for HMR.
        // Uses regex with $ anchor for exact matching to prevent
        // @agent-native/core from prefix-matching @agent-native/core/client.
        ...getCoreSourceAliases(cwd),
        ...localWorkspacePackageResolveAliases,
        // Standard path aliases (prefix matching is fine here)
        { find: "@", replacement: path.resolve(cwd, "./app") },
        { find: "@shared", replacement: path.resolve(cwd, "./shared") },
        ...Object.entries(options.aliases ?? {}).map(([find, replacement]) => ({
          find,
          replacement,
        })),
        ...aliasArrayFrom((userConfig.resolve as { alias?: unknown })?.alias),
      ],
    },
  };
}

/**
 * Agent-Native's Vite plugin preset.
 *
 * Use this in ordinary Vite configs so `vite.config.ts` keeps Vite's native
 * `UserConfig` type surface:
 *
 * ```ts
 * import { defineConfig } from "vite";
 * import { reactRouter } from "@react-router/dev/vite";
 * import { agentNative } from "@agent-native/core/vite";
 *
 * export default defineConfig({
 *   plugins: [reactRouter(), agentNative({ ssrStubs: ["shiki"] })],
 * });
 * ```
 */
export function agentNative(
  options: AgentNativeVitePluginOptions = {},
): Plugin[] {
  return [
    {
      name: "agent-native-config",
      enforce: "pre",
      config(config: UserConfig, env: ConfigEnv) {
        return createAgentNativeConfig(options, env.command, config);
      },
    },
    ...createAgentNativePlugins(options, {
      includeReactTransform: options.legacySpa === true,
      useServeOnlyNitroPlugin: true,
    }),
  ] as Plugin[];
}

/**
 * Create the client Vite config with sensible agent-native defaults.
 *
 * @deprecated Prefer `defineConfig` from `vite` plus the `agentNative()` plugin
 * preset. This compatibility wrapper remains for existing templates.
 */
export function defineConfig(options: ClientConfigOptions = {}): UserConfig {
  const includeReactTransform =
    !hasReactRouterPlugin(options.plugins) && !options.reactRouter;
  return {
    ...createAgentNativeConfig(options),
    plugins: createAgentNativePlugins(options, {
      includeReactTransform,
      userPlugins: options.plugins,
    }),
  };
}

export {
  getClientDedupe as _getClientDedupe,
  getDefaultOptimizeDeps as _getDefaultOptimizeDeps,
  findCorePackageRoot as _findCorePackageRoot,
  getReactRouterAliases as _getReactRouterAliases,
  debounceNitroFullReloadHotUpdate as _debounceNitroFullReloadHotUpdate,
};
