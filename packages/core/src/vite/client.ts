import { EventEmitter } from "events";
import fs from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequire, syncBuiltinESMExports } from "module";
import path from "path";
import { fileURLToPath } from "url";

import {
  renderDesignSystemThemeCss,
  type DesignSystemTheme,
} from "@agent-native/toolkit/design-system/theme";
import {
  loadEnv,
  type ConfigEnv,
  type HotUpdateOptions,
  type NormalizedHotChannel,
  type Plugin,
  type UserConfig,
} from "vite";

import { getAppConfig } from "../app-config/index.js";
import {
  mergePendingChangelog,
  parsePendingEntry,
} from "../changelog/parse.js";
import {
  DEV_SERVER_RECOVERY_EXIT_CODE,
  DEV_SERVER_SUPERVISOR_ENV,
} from "../cli/process.js";
import { getViteDevRecoveryScript } from "../client/vite-dev-recovery-script.js";
import {
  inferAgentNativeDeploymentEnvironment,
  mergeAgentNativeConfigs,
  readAgentNativeConfigEnv,
  resolveAgentNativeConfig,
  type AgentNativeConfig,
  type AgentNativeConfigContext,
  type AgentNativeConfigInput,
} from "../config.js";
import { getRuntimeDatabaseUrl } from "../db/client.js";
import { writeAgentNativeNitroPresetMarker } from "../deploy/nitro-preset.js";
import { findWorkspaceRoot } from "../scripts/utils.js";
import {
  RECURRING_JOBS_BUILD_MARKER_ENV_VAR,
  resolveRecurringJobsBuildMarker,
} from "../server/agent-chat/recurring-jobs-runtime.js";
import {
  hashDatabaseKey,
  removeDevActionDiscoveryFile,
  writeDevActionDiscoveryFile,
} from "../server/dev-action-bridge.js";
import { verifyEmbedSessionToken } from "../server/embed-session.js";
import { resolveAgentNativeBuildId } from "../shared/build-id.js";
import {
  EMBED_SESSION_COOKIE,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";
import {
  FRAMEWORK_INTERNAL_ROUTE_PREFIX,
  matchesPathPrefix,
  normalizeFrameworkRoutePrefix,
} from "../shared/framework-route-prefix.js";
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
import {
  formatRuntimeConfigReport,
  getRuntimeConfigReport,
  isTruthyRuntimeValue,
} from "../shared/runtime-config.js";
import { actionTypesPlugin } from "./action-types-plugin.js";
import {
  createAgentNativeConfigContext,
  loadAgentNativeConfigFile,
  loadWorkspaceAgentNativeConfigFile,
  readAgentNativeJsonConfig,
  resolveFirstRunOnboardingBuildReplacement,
  resolveHarnessBuildReplacement,
  writeAgentNativeBuildConfigMarker,
} from "./agent-native-config-loader.js";
import { agentsBundlePlugin } from "./agents-bundle-plugin.js";
import { resolveAgentNativePackageVersions } from "./package-versions.js";
import {
  createSentrySourceMapUploadPlugin,
  isSentrySourceMapUploadEnabled,
} from "./sentry-source-maps.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let nitroFsWatchGuardInstalled = false;
const emittedRuntimeConfigDiagnostics = new Set<string>();

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
  return plugins
    .map(debounceNitroFullReloadHotUpdate)
    .map(skipViteChildCompiler);
}

function skipViteChildCompiler(plugin: Plugin): Plugin {
  const originalApply = plugin.apply;
  return {
    ...plugin,
    apply(config, configEnv) {
      if ((config as UserConfig & { configFile?: false }).configFile === false)
        return false;
      if (!originalApply) return true;
      if (typeof originalApply === "function") {
        return originalApply(config, configEnv);
      }
      return originalApply === configEnv.command;
    },
  };
}

const NITRO_FULL_RELOAD_DEBOUNCE_MS = 300;
const OPTIMIZE_DEP_FULL_RELOAD_COOLDOWN_MS = 2_000;
const OPTIMIZE_DEP_FULL_RELOAD_WINDOW_MS = 30_000;
const OPTIMIZE_DEP_MAX_FULL_RELOADS = 3;

function debounceNitroFullReloadHotUpdate(plugin: Plugin): Plugin {
  const originalHook = plugin.hotUpdate;
  if (!originalHook) return plugin;

  const isHandlerForm = typeof originalHook === "object";
  const originalHandler = (
    isHandlerForm
      ? (originalHook as { handler: unknown }).handler
      : originalHook
  ) as (
    this: { environment: { name: string; hot: NormalizedHotChannel } },
    options: HotUpdateOptions,
  ) => unknown;

  const pendingReloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function wrappedHotUpdate(
    this: { environment: { name: string; hot: NormalizedHotChannel } },
    options: HotUpdateOptions,
  ) {
    const realEnvironment = this.environment;
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
                    return (hotTarget.send as (p: unknown) => void)(payload);
                  }
                  const key = realEnvironment.name || "default";
                  const pending = pendingReloadTimers.get(key);
                  if (pending) clearTimeout(pending);
                  const timer = setTimeout(() => {
                    pendingReloadTimers.delete(key);
                    (hotTarget.send as (p: unknown) => void)(payload);
                  }, NITRO_FULL_RELOAD_DEBOUNCE_MS);
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

const REACT_ROUTER_VIRTUAL_ID_PREFIX = "\0virtual:react-router/";

const REACT_ROUTER_INVALIDATION_MIRROR_DEBOUNCE_MS = 300;

function mirrorReactRouterVirtualInvalidation(
  server: any,
  now: () => number = Date.now,
): string[] {
  const timestamp = now();
  const touched: string[] = [];
  for (const [name, environment] of Object.entries<any>(
    server?.environments ?? {},
  )) {
    const moduleGraph = environment?.moduleGraph;
    if (!moduleGraph?.idToModuleMap) continue;

    const seen = new Set<unknown>();
    let invalidated = 0;
    for (const id of [...moduleGraph.idToModuleMap.keys()] as string[]) {
      if (!id.startsWith(REACT_ROUTER_VIRTUAL_ID_PREFIX)) continue;
      const mod = moduleGraph.getModuleById(id);
      if (!mod) continue;
      moduleGraph.invalidateModule(mod, seen, timestamp, true);
      invalidated += 1;
    }
    if (invalidated === 0) continue;

    touched.push(name);
    if (environment?.config?.consumer !== "client") {
      environment?.hot?.send?.({ type: "full-reload" });
    }
  }
  return touched;
}

function installReactRouterVirtualInvalidationMirror(
  server: any,
  {
    debounceMs = REACT_ROUTER_INVALIDATION_MIRROR_DEBOUNCE_MS,
    now = Date.now,
    warn = console.warn,
  }: {
    debounceMs?: number;
    now?: () => number;
    warn?: (message: string) => void;
  } = {},
): boolean {
  const backCompatGraph = server?.moduleGraph;
  const original = backCompatGraph?.invalidateModule;
  if (typeof original !== "function") {
    warn(
      "[agent-native] Vite's server.moduleGraph.invalidateModule is unavailable, " +
        "so React Router route additions and deletions cannot be mirrored into " +
        "the Nitro dev environment. Adding or deleting a route file will need a " +
        "dev server restart to take effect.",
    );
    return false;
  }

  let pending: ReturnType<typeof setTimeout> | undefined;
  backCompatGraph.invalidateModule = function patchedInvalidateModule(
    this: unknown,
    mod: { id?: string | null } | undefined,
    ...rest: unknown[]
  ) {
    const result = original.call(this, mod, ...rest);
    if (!mod?.id?.startsWith(REACT_ROUTER_VIRTUAL_ID_PREFIX)) return result;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      mirrorReactRouterVirtualInvalidation(server, now);
    }, debounceMs);
    pending.unref?.();
    return result;
  };
  return true;
}

function reactRouterVirtualInvalidationMirrorPlugin(): Plugin {
  return {
    name: "agent-native-react-router-invalidation-mirror",
    apply: "serve",
    configureServer(server) {
      installReactRouterVirtualInvalidationMirror(server);
    },
  };
}

function findWorkspaceCoreSync(
  startDir: string,
): { packageName: string; packageDir: string; workspaceRoot: string } | null {
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

  const nm = path.join(workspaceRoot, "node_modules", packageName);
  if (fs.existsSync(path.join(nm, "package.json"))) {
    return { packageName, packageDir: fs.realpathSync(nm), workspaceRoot };
  }

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
      ...(pkg.optionalDependencies ?? {}),
    } as Record<string, string>;
    const seen = new Set<string>();
    const packages: Array<{ packageName: string; packageDir: string }> = [];
    const pending = Object.entries(deps).map(([packageName, range]) => ({
      importer: pkgPath,
      packageName,
      range,
    }));

    for (const { importer, packageName, range } of pending) {
      if (seen.has(packageName)) continue;
      seen.add(packageName);

      try {
        let packageJsonPath: string | null = null;
        if (range.startsWith("file:")) {
          packageJsonPath = findFilePackageJsonPath(importer, range);
        } else if (range.startsWith("workspace:")) {
          packageJsonPath = findWorkspacePackageJsonPath(
            importer,
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
        const runtimeDeps = {
          ...(packageJson.dependencies ?? {}),
          ...(packageJson.peerDependencies ?? {}),
          ...(packageJson.optionalDependencies ?? {}),
        } as Record<string, string>;
        for (const [name, dependencyRange] of Object.entries(runtimeDeps)) {
          pending.push({
            importer: packageJsonPath,
            packageName: name,
            range: dependencyRange,
          });
        }
      } catch {
        // Dependency may not have been installed yet; ignore it for dev config.
      }
    }

    return packages;
  } catch {
    // coercion-ok: optional peer dependencies may be absent in standalone apps.
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  if (pkg === "@agent-native/core" && findCorePackageRoot(cwd)) return true;
  return hasDep(pkg, cwd) || hasCoreDep(pkg, cwd);
}

function getClientDedupe(cwd: string): string[] {
  const always = new Set([
    "react",
    "react-dom",
    "react-dom/client",
    "@assistant-ui/react",
    "@assistant-ui/core",
    "@assistant-ui/store",
    "@assistant-ui/tap",
    ...(hasDep("zustand", cwd) ? ["zustand"] : []),
    ...(hasDep("react-router", cwd)
      ? ["react-router", "react-router/dom"]
      : []),
  ]);

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

    const coreDeps = new Set([
      ...Object.keys(corePkg.peerDependencies ?? {}),
      ...Object.keys(corePkg.dependencies ?? {}),
    ]);

    const appPkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf-8"),
    );
    const appDeps = new Set([
      ...Object.keys(appPkg.dependencies ?? {}),
      ...Object.keys(appPkg.devDependencies ?? {}),
    ]);

    for (const dep of coreDeps) {
      if (serverOnly.has(dep)) continue;
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

function findCorePackageRoot(cwd: string): string | null {
  const localSourceRoot = findLocalCoreSourceRoot(cwd);
  if (localSourceRoot) return localSourceRoot;

  try {
    const appRequire = createRequire(path.join(cwd, "package.json"));
    const resolved = appRequire.resolve("@agent-native/core");
    let dir = path.dirname(resolved);
    for (let i = 0; i < 20; i++) {
      const packageJsonPath = path.join(dir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf-8"),
        ) as { name?: string };
        if (packageJson.name === "@agent-native/core") {
          return fs.realpathSync(dir);
        }
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // The app may not have installed Core yet; fall through to null.
  }

  return null;
}

function findLocalCoreSourceRoot(cwd: string): string | null {
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
  const root = findLocalCoreSourceRoot(cwd);
  return root ? path.join(root, "src") : null;
}

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

function getAssistantUiRequire(cwd: string): NodeJS.Require | null {
  try {
    const appRequire = createRequire(path.join(cwd, "package.json"));
    let assistantUiEntry: string;
    try {
      assistantUiEntry = appRequire.resolve("@assistant-ui/react");
    } catch {
      const coreRequire = createRequire(
        appRequire.resolve("@agent-native/core"),
      );
      assistantUiEntry = coreRequire.resolve("@assistant-ui/react");
    }
    return createRequire(assistantUiEntry);
  } catch {
    // coercion-ok: null is the typed absence state for an unavailable optional peer graph.
    return null;
  }
}

function getAssistantUiAliases(
  cwd: string,
): Array<{ find: RegExp; replacement: string }> {
  try {
    const assistantUiRequire = getAssistantUiRequire(cwd);
    if (!assistantUiRequire) return [];
    return [
      {
        find: /^@assistant-ui\/react$/,
        replacement: assistantUiRequire.resolve("@assistant-ui/react"),
      },
      {
        find: /^@assistant-ui\/core$/,
        replacement: assistantUiRequire.resolve("@assistant-ui/core"),
      },
      {
        find: /^@assistant-ui\/store$/,
        replacement: assistantUiRequire.resolve("@assistant-ui/store"),
      },
      {
        find: /^@assistant-ui\/tap$/,
        replacement: assistantUiRequire.resolve("@assistant-ui/tap"),
      },
      {
        find: /^assistant-stream$/,
        replacement: assistantUiRequire.resolve("assistant-stream"),
      },
      {
        find: /^assistant-stream\/utils$/,
        replacement: assistantUiRequire.resolve("assistant-stream/utils"),
      },
    ];
  } catch {
    // coercion-ok: optional peer dependencies may be absent in standalone apps.
    return [];
  }
}

const CORE_CLIENT_SUBPATHS = [
  "@agent-native/core",
  "@agent-native/core/client",
  "@agent-native/core/client/agent-chat",
  "@agent-native/core/client/agentkit-chat",
  "@agent-native/core/client/agent-native-icon",
  "@agent-native/core/client/analytics",
  "@agent-native/core/client/automation",
  "@agent-native/core/client/chat",
  "@agent-native/core/client/changelog",
  "@agent-native/core/client/collab",
  "@agent-native/core/client/composer",
  "@agent-native/core/client/conversation",
  "@agent-native/core/client/dev-overlay",
  "@agent-native/core/client/editor",
  "@agent-native/core/client/rich-markdown-editor",
  "@agent-native/core/client/components/ui/dialog",
  "@agent-native/core/client/components/ui/dropdown-menu",
  "@agent-native/core/client/components/ui/hover-card",
  "@agent-native/core/client/components/ui/popover",
  "@agent-native/core/client/components/ui/sheet",
  "@agent-native/core/client/components/ui/tooltip",
  "@agent-native/core/client/components/AgentPresenceChip",
  "@agent-native/core/client/components/LiveCursorOverlay",
  "@agent-native/core/client/components/PresenceBar",
  "@agent-native/core/client/components/RecentEditHighlights",
  "@agent-native/core/client/components/RemoteSelectionRings",
  "@agent-native/core/client/visual-style-controls",
  "@agent-native/core/client/feature-flags",
  "@agent-native/core/feature-flags/registry",
  "@agent-native/core/client/launchdarkly",
  "@agent-native/core/client/hooks",
  "@agent-native/core/client/host",
  "@agent-native/core/client/i18n",
  "@agent-native/core/client/integrations",
  "@agent-native/core/client/navigation",
  "@agent-native/core/client/resources",
  "@agent-native/core/client/route-chunk-recovery",
  "@agent-native/core/client/settings",
  "@agent-native/core/client/theme",
  "@agent-native/core/client/error-boundary",
  "@agent-native/core/client/feedback",
  "@agent-native/core/client/ui",
  "@agent-native/core/client/uploads",
  "@agent-native/core/client/widgets",
  "@agent-native/core/client/api-path",
  "@agent-native/core/client/clipboard",
  "@agent-native/core/client/zoom-gesture",
  "@agent-native/core/blocks",
  "@agent-native/core/blocks/server",
  "@agent-native/core/client/extensions",
  "@agent-native/core/client/tools", // legacy alias
  "@agent-native/core/client/org",
  "@agent-native/core/client/org-switcher",
  "@agent-native/core/client/team-page",
  "@agent-native/core/client/db-admin",
  "@agent-native/core/client/observability",
  "@agent-native/core/client/onboarding",
  "@agent-native/core/client/sharing",
  "@agent-native/core/client/notifications",
  "@agent-native/core/client/progress",
  "@agent-native/core/client/transcription/use-live-transcription",
  "@agent-native/core/workspace-connections/credential-key-aliases",
  "@agent-native/core/voice",
];

const disableDepSourcemapsPlugin: Plugin = {
  name: "agent-native:no-dep-prebundle-sourcemaps",
  outputOptions: (options) => ({ ...options, sourcemap: false }),
};

function getDefaultOptimizeDeps(cwd: string): string[] {
  const inMonorepo = findCoreSrcDir(cwd) !== null;
  const entries: Array<{ specifier: string; packageName?: string }> = [
    ...(inMonorepo
      ? []
      : ([
          { specifier: "@agent-native/core" },
          // Client and Toolkit subpaths are deliberately discovered from app
          // imports. Eagerly including every leaf would rebuild the old
          // all-app prebundle under a different set of entry names.
        ] as Array<{ specifier: string; packageName?: string }>)),
    { specifier: "@amplitude/analytics-browser" },
    { specifier: "@assistant-ui/react" },
    { specifier: "@assistant-ui/react-markdown" },
    { specifier: "@assistant-ui/store" },
    { specifier: "@assistant-ui/tap" },
    {
      specifier: "@agent-native/core > @assistant-ui/react > assistant-stream",
      packageName: "@agent-native/core",
    },
    {
      specifier:
        "@agent-native/core > @assistant-ui/react > assistant-stream/utils",
      packageName: "@agent-native/core",
    },
    {
      specifier: "zustand",
      packageName: "zustand",
    },
    { specifier: "zustand/react", packageName: "zustand" },
    { specifier: "zustand/shallow", packageName: "zustand" },
    { specifier: "zustand/traditional", packageName: "zustand" },
    { specifier: "zustand/vanilla", packageName: "zustand" },
    {
      specifier: "use-sync-external-store/shim/index.js",
      packageName: "use-sync-external-store",
    },
    {
      specifier: "use-sync-external-store/shim/with-selector.js",
      packageName: "use-sync-external-store",
    },
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
    { specifier: "@uiw/react-codemirror" },
    { specifier: "@xterm/addon-fit" },
    { specifier: "@xterm/addon-web-links" },
    { specifier: "@xterm/xterm" },
    { specifier: "class-variance-authority" },
    { specifier: "clsx" },
    { specifier: "cmdk" },
    { specifier: "date-fns" },
    { specifier: "diff-match-patch" },
    { specifier: "drizzle-orm" },
    { specifier: "drizzle-orm/pg-core", packageName: "drizzle-orm" },
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
    { specifier: "highlight.js/lib/core", packageName: "highlight.js" },
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
    { specifier: "react-dom/server", packageName: "react-dom" },
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
    ...(hasDep("@agent-native/toolkit", cwd)
      ? [
          {
            specifier:
              "@agent-native/toolkit > @tiptap/react > use-sync-external-store/shim/index.js",
            packageName: "@agent-native/toolkit",
          },
          {
            specifier:
              "@agent-native/toolkit > @tiptap/react > use-sync-external-store/shim/with-selector.js",
            packageName: "@agent-native/toolkit",
          },
          {
            specifier:
              "@agent-native/toolkit > tiptap-markdown > markdown-it-task-lists",
            packageName: "@agent-native/toolkit",
          },
        ]
      : []),
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
      if (!hasDep(dependencyName, cwd) && hasCoreDep(dependencyName, cwd)) {
        return `@agent-native/core > ${specifier}`;
      }
      return specifier;
    });
}

function getAgentKitOptimizeDeps(cwd: string): string[] {
  const standaloneChatEntries =
    findCoreSrcDir(cwd) === null
      ? [
          ...(hasDep("@agent-native/agentkit", cwd)
            ? [
                "@agent-native/agentkit/react/components",
                "@agent-native/agentkit/react/context",
                "@agent-native/agentkit/react/root",
              ]
            : []),
          ...(hasDep("@agent-native/core", cwd)
            ? [
                "@agent-native/core/client/agent-native-icon",
                "@agent-native/core/client/agentkit-chat/composer",
                "@agent-native/core/client/agentkit-chat/connections",
                "@agent-native/core/client/agentkit-chat/integrity",
                "@agent-native/core/client/agentkit-chat/questions",
                "@agent-native/core/client/agentkit-chat/rail",
                "@agent-native/core/client/agentkit-chat/suggestions",
                "@agent-native/core/client/agentkit-chat/transport",
                "@agent-native/core/client/analytics",
                "@agent-native/core/client/api-path",
                "@agent-native/core/client/error-boundary",
                "@agent-native/core/client/hooks",
                "@agent-native/core/client/i18n",
                "@agent-native/core/client/navigation",
                "@agent-native/core/client/org-switcher",
                "@agent-native/core/client/route-chunk-recovery",
                "@agent-native/core/client/theme",
              ]
            : []),
          ...(hasDep("@agent-native/toolkit", cwd)
            ? [
                "@agent-native/toolkit/agentkit",
                "@agent-native/toolkit/app-shell",
                "@agent-native/toolkit/app-shell/header-actions",
                "@agent-native/toolkit/chat-history/ChatHistoryList",
                "@agent-native/toolkit/composer/runtime-adapters",
                "@agent-native/toolkit/provider",
                "@agent-native/toolkit/ui/button",
                "@agent-native/toolkit/ui/hover-card",
                "@agent-native/toolkit/ui/sheet",
                "@agent-native/toolkit/ui/sonner",
                "@agent-native/toolkit/ui/tooltip",
              ]
            : []),
        ]
      : [];

  return [
    ...standaloneChatEntries,
    ...(hasDep("react", cwd) ? ["react"] : []),
    ...(hasDep("react-dom", cwd)
      ? ["react-dom", "react-dom/client", "react-dom/server"]
      : []),
    ...(hasDep("@tanstack/react-query", cwd) ? ["@tanstack/react-query"] : []),
    ...(hasDep("next-themes", cwd) ? ["next-themes"] : []),
    ...(hasDep("react-router", cwd)
      ? ["react-router", "react-router/dom"]
      : []),
    ...(hasDep("@radix-ui/react-tooltip", cwd)
      ? ["@radix-ui/react-tooltip"]
      : []),
    ...(hasDep("@radix-ui/react-dialog", cwd)
      ? ["@radix-ui/react-dialog"]
      : []),
    ...(hasDep("@radix-ui/react-hover-card", cwd)
      ? ["@radix-ui/react-hover-card"]
      : []),
    ...(hasDep("@radix-ui/react-popover", cwd)
      ? ["@radix-ui/react-popover"]
      : []),
    ...(hasDep("@radix-ui/react-slot", cwd) ? ["@radix-ui/react-slot"] : []),
    ...(hasDep("@tabler/icons-react", cwd) ? ["@tabler/icons-react"] : []),
    ...(hasDep("class-variance-authority", cwd)
      ? ["class-variance-authority"]
      : []),
    ...(hasDep("sonner", cwd) ? ["sonner"] : []),
    "@agent-native/core > @assistant-ui/react",
    "@agent-native/core > @assistant-ui/react > assistant-stream > secure-json-parse",
    "@agent-native/core > react-markdown > void-elements",
    "@agent-native/core > react-markdown > unified > extend",
    "@agent-native/core > react-markdown > hast-util-to-jsx-runtime > style-to-js",
    "@agent-native/core > react-markdown > remark-parse > mdast-util-from-markdown > micromark > debug",
    "@agent-native/core > recharts > decimal.js-light",
    "@agent-native/core > recharts > eventemitter3",
    "@agent-native/core > recharts > react-is",
    ...(hasDep("clsx", cwd) ? ["clsx"] : []),
    ...(hasDep("tailwind-merge", cwd) ? ["tailwind-merge"] : []),
    ...(hasDep("zustand", cwd) ? ["zustand", "zustand/shallow"] : []),
    ...(hasDep("@agent-native/toolkit", cwd)
      ? [
          "@agent-native/toolkit > @tiptap/react > use-sync-external-store/shim/index.js",
          "@agent-native/toolkit > @tiptap/react > use-sync-external-store/shim/with-selector.js",
          "@agent-native/toolkit > tiptap-markdown > markdown-it-task-lists",
        ]
      : []),
  ];
}

function getAgentKitOptimizeExcludes(
  cwd: string,
  command?: AgentNativeViteCommand,
): string[] {
  if (
    (command === "serve" || (!command && !isBuildCommand(command))) &&
    findCoreSrcDir(cwd) === null
  )
    return [];

  return [
    "@agent-native/agentkit",
    "@agent-native/core",
    ...CORE_CLIENT_SUBPATHS,
    "@agent-native/toolkit",
  ];
}

function getCoreSourceAliases(
  cwd: string,
): Array<{ find: RegExp; replacement: string }> {
  const coreSrc = findCoreSrcDir(cwd);
  if (!coreSrc) return [];

  const entries: Record<string, string> = {
    "@agent-native/core": path.join(coreSrc, "index.browser.ts"),
    "@agent-native/core/server": path.join(coreSrc, "server/index.ts"),
    "@agent-native/core/server/edge": path.join(coreSrc, "server/edge.ts"),
    "@agent-native/core/client": path.join(coreSrc, "client/index.ts"),
    "@agent-native/core/client/agent-chat": path.join(
      coreSrc,
      "client/agent-chat/index.ts",
    ),
    "@agent-native/core/client/agentkit-chat": path.join(
      coreSrc,
      "client/agentkit-chat/index.ts",
    ),
    "@agent-native/core/client/agent-native-icon": path.join(
      coreSrc,
      "client/components/icons/AgentNativeIcon.tsx",
    ),
    "@agent-native/core/client/analytics": path.join(
      coreSrc,
      "client/analytics/index.ts",
    ),
    "@agent-native/core/client/automation": path.join(
      coreSrc,
      "client/automation/index.ts",
    ),
    "@agent-native/core/client/chat": path.join(
      coreSrc,
      "client/chat/index.ts",
    ),
    "@agent-native/core/client/changelog": path.join(
      coreSrc,
      "client/changelog/index.ts",
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
    "@agent-native/core/client/dev-overlay": path.join(
      coreSrc,
      "client/dev-overlay/index.ts",
    ),
    "@agent-native/core/client/editor": path.join(
      coreSrc,
      "client/tombstone/editor.ts",
    ),
    "@agent-native/core/client/rich-markdown-editor": path.join(
      coreSrc,
      "client/tombstone/rich-markdown-editor.ts",
    ),
    "@agent-native/core/client/components/ui/dialog": path.join(
      coreSrc,
      "client/tombstone/ui-dialog.ts",
    ),
    "@agent-native/core/client/components/ui/dropdown-menu": path.join(
      coreSrc,
      "client/tombstone/ui-dropdown-menu.ts",
    ),
    "@agent-native/core/client/components/ui/hover-card": path.join(
      coreSrc,
      "client/tombstone/ui-hover-card.ts",
    ),
    "@agent-native/core/client/components/ui/popover": path.join(
      coreSrc,
      "client/tombstone/ui-popover.ts",
    ),
    "@agent-native/core/client/components/ui/sheet": path.join(
      coreSrc,
      "client/tombstone/ui-sheet.ts",
    ),
    "@agent-native/core/client/components/ui/tooltip": path.join(
      coreSrc,
      "client/tombstone/ui-tooltip.ts",
    ),
    "@agent-native/core/client/components/AgentPresenceChip": path.join(
      coreSrc,
      "client/tombstone/agent-presence-chip.ts",
    ),
    "@agent-native/core/client/components/LiveCursorOverlay": path.join(
      coreSrc,
      "client/tombstone/live-cursor-overlay.ts",
    ),
    "@agent-native/core/client/components/PresenceBar": path.join(
      coreSrc,
      "client/tombstone/presence-bar.ts",
    ),
    "@agent-native/core/client/components/RecentEditHighlights": path.join(
      coreSrc,
      "client/tombstone/recent-edit-highlights.ts",
    ),
    "@agent-native/core/client/components/RemoteSelectionRings": path.join(
      coreSrc,
      "client/tombstone/remote-selection-rings.ts",
    ),
    "@agent-native/core/client/visual-style-controls": path.join(
      coreSrc,
      "client/tombstone/visual-style-controls.ts",
    ),
    "@agent-native/core/client/feature-flags": path.join(
      coreSrc,
      "client/feature-flags/index.ts",
    ),
    "@agent-native/core/feature-flags/registry": path.join(
      coreSrc,
      "feature-flags/registry.ts",
    ),
    "@agent-native/core/client/launchdarkly": path.join(
      coreSrc,
      "client/launchdarkly/index.ts",
    ),
    "@agent-native/core/client/hooks": path.join(
      coreSrc,
      "client/hooks/index.ts",
    ),
    "@agent-native/core/client/host": path.join(
      coreSrc,
      "client/host/index.ts",
    ),
    "@agent-native/core/client/i18n": path.join(coreSrc, "client/i18n.tsx"),
    "@agent-native/core/client/integrations": path.join(
      coreSrc,
      "client/integrations/index.ts",
    ),
    "@agent-native/core/client/navigation": path.join(
      coreSrc,
      "client/navigation/index.ts",
    ),
    "@agent-native/core/client/resources": path.join(
      coreSrc,
      "client/resources/index.ts",
    ),
    "@agent-native/core/client/route-chunk-recovery": path.join(
      coreSrc,
      "client/route-chunk-recovery/index.ts",
    ),
    "@agent-native/core/client/settings": path.join(
      coreSrc,
      "client/settings/index.ts",
    ),
    "@agent-native/core/client/theme": path.join(coreSrc, "client/theme.ts"),
    "@agent-native/core/client/error-boundary": path.join(
      coreSrc,
      "client/ErrorBoundary.tsx",
    ),
    "@agent-native/core/client/feedback": path.join(
      coreSrc,
      "client/FeedbackButton.tsx",
    ),
    "@agent-native/core/client/ui": path.join(coreSrc, "client/ui/index.ts"),
    "@agent-native/core/client/uploads": path.join(
      coreSrc,
      "client/uploads/index.ts",
    ),
    "@agent-native/core/client/widgets": path.join(
      coreSrc,
      "client/widgets/index.ts",
    ),
    "@agent-native/core/client/api-path": path.join(
      coreSrc,
      "client/api-path.ts",
    ),
    "@agent-native/core/client/clipboard": path.join(
      coreSrc,
      "client/clipboard.ts",
    ),
    "@agent-native/core/client/zoom-gesture": path.join(
      coreSrc,
      "client/zoom-gesture.ts",
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
    "@agent-native/core/client/tools": path.join(
      coreSrc,
      "client/extensions/index.ts",
    ),
    "@agent-native/core/client/org": path.join(coreSrc, "client/org/index.ts"),
    "@agent-native/core/client/org-switcher": path.join(
      coreSrc,
      "client/org/OrgSwitcher.tsx",
    ),
    "@agent-native/core/client/team-page": path.join(
      coreSrc,
      "client/org/TeamPage.tsx",
    ),
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
    "@agent-native/core/workspace-connections/credential-key-aliases":
      path.join(coreSrc, "workspace-connections/credential-key-aliases.ts"),
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
    "@agent-native/core/styles/agent-native.css": path.join(
      coreSrc,
      "styles/agent-native.css",
    ),
  };

  return Object.entries(entries).map(([find, replacement]) => ({
    find: new RegExp(`^${find.replace(/[/]/g, "\\/")}$`),
    replacement,
  }));
}

export interface NitroOptions {
  preset?: string;
  srcDir?: string;
  routesDir?: string;
  [key: string]: unknown;
}

export interface ClientConfigOptions {
  port?: number;
  allowedHosts?: NonNullable<NonNullable<UserConfig["server"]>["allowedHosts"]>;
  logLevel?: UserConfig["logLevel"];
  plugins?: any[];
  designSystemTheme?: DesignSystemTheme;
  nitro?: NitroOptions;
  aliases?: Record<string, string>;
  outDir?: string;
  fsAllow?: string[];
  fsDeny?: string[];
  optimizeDeps?: NonNullable<UserConfig["optimizeDeps"]>;
  define?: UserConfig["define"];
  agentNativeConfig?: AgentNativeConfigInput;
  clientCompatibilityVersion?: string;
  routeWarmup?: AgentNativeRouteWarmupConfigInput;
  mcpIntegrations?: McpIntegrationsConfigInput;
  tailwind?: boolean;
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
  legacySpa?: boolean;
}

function autoReloadOnOptimizeDep(): Plugin {
  return {
    name: "agent-native-auto-reload-optimize-dep",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          children: getViteDevRecoveryScript(),
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

function fullReloadOnOptimizeDep504(): Plugin {
  return {
    name: "agent-native-full-reload-optimize-dep-504",
    apply: "serve",
    configureServer(server) {
      let lastReloadAt: number | null = null;
      let reloadHistory: number[] = [];
      server.middlewares.use((req, res, next) => {
        const originalEnd = res.end.bind(res);
        (res as unknown as { end: (...args: unknown[]) => unknown }).end = (
          ...endArgs: unknown[]
        ) => {
          const statusMessage = String(res.statusMessage || "");
          if (
            res.statusCode === 504 &&
            statusMessage === "Outdated Optimize Dep"
          ) {
            const now = Date.now();
            reloadHistory = reloadHistory.filter(
              (timestamp) =>
                now - timestamp < OPTIMIZE_DEP_FULL_RELOAD_WINDOW_MS,
            );
            if (
              (lastReloadAt === null ||
                now - lastReloadAt >= OPTIMIZE_DEP_FULL_RELOAD_COOLDOWN_MS) &&
              reloadHistory.length < OPTIMIZE_DEP_MAX_FULL_RELOADS
            ) {
              lastReloadAt = now;
              reloadHistory.push(now);
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

function baseRedirectGuard(): Plugin {
  return {
    name: "agent-native-base-redirect-guard",
    apply: "serve",
    configureServer(server) {
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
        const secFetchDest = req.headers["sec-fetch-dest"] as
          | string
          | undefined;
        const isNitroPreHandled =
          !secFetchDest ||
          /^(document|iframe|frame|empty|image|video|audio|track)$/.test(
            secFetchDest,
          );
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
          req.url = base;
        }
        next();
      });
    },
  };
}

function frameworkDevDynamicForwarder(): Plugin {
  return {
    name: "agent-native-framework-dev-dynamic-forwarder",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url;
        if (url && isFrameworkDynamicDevPath(url, server.config.base)) {
          const fetchDest = req.headers["sec-fetch-dest"];
          if (
            fetchDest === undefined ||
            !/^(document|iframe|frame|empty)$/.test(String(fetchDest))
          ) {
            req.headers["sec-fetch-dest"] = "empty";
          }
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

const VITE_RUNTIME_MODULE_QUERY_KEYS = new Set([
  "commonjs-proxy",
  "direct",
  "html-proxy",
  "import",
  "inline",
  "inline-css",
  "no-inline",
  "raw",
  "sharedworker",
  "style-attr",
  "transform-only",
  "url",
  "worker",
]);

const VITE_STATIC_ASSET_EXTENSIONS = new Set([
  ".aac",
  ".apng",
  ".avif",
  ".bmp",
  ".css",
  ".cur",
  ".eot",
  ".flac",
  ".gif",
  ".ico",
  ".jfif",
  ".jpeg",
  ".jpg",
  ".jxl",
  ".less",
  ".m4a",
  ".mp3",
  ".mp4",
  ".mov",
  ".ogg",
  ".otf",
  ".pjp",
  ".pjpeg",
  ".pcss",
  ".pdf",
  ".png",
  ".postcss",
  ".opus",
  ".sass",
  ".scss",
  ".svg",
  ".styl",
  ".stylus",
  ".ttf",
  ".txt",
  ".vtt",
  ".wasm",
  ".wav",
  ".webm",
  ".webp",
  ".webmanifest",
  ".woff",
  ".woff2",
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

  const hashStart = runtimeUrl.indexOf("#");
  const searchStart = runtimeUrl.indexOf("?");
  const search =
    searchStart >= 0 && (hashStart < 0 || searchStart < hashStart)
      ? runtimeUrl.slice(searchStart, hashStart < 0 ? undefined : hashStart)
      : "";
  return `${url.pathname}${stripMountedEmbedRuntimeQueryParams(search)}${url.hash}`;
}

function stripMountedEmbedRuntimeQueryParams(search: string): string {
  if (!search) return "";
  const kept = search
    .slice(1)
    .split("&")
    .filter((pair) => {
      const key = pair.split("=", 1)[0];
      return (
        key !== EMBED_TOKEN_QUERY_PARAM &&
        key !== MCP_APP_CHAT_BRIDGE_QUERY_PARAM
      );
    });
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}

function isMountedEmbedStaticAssetRequest(
  req: IncomingMessage,
  runtimeUrl: string,
): boolean {
  const url = new URL(runtimeUrl, "http://agent-native.local");

  const isViteModuleQuery = [...url.searchParams.keys()].some((key) =>
    VITE_RUNTIME_MODULE_QUERY_KEYS.has(key),
  );
  if (isViteModuleQuery) return false;

  const fetchDestination = String(
    req.headers["sec-fetch-dest"] ?? "",
  ).toLowerCase();
  if (
    ["audio", "font", "image", "style", "track", "video"].includes(
      fetchDestination,
    )
  ) {
    return true;
  }

  return VITE_STATIC_ASSET_EXTENSIONS.has(
    path.extname(url.pathname).toLowerCase(),
  );
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

  const result = await server.transformRequest(virtualId ?? runtimeUrl);
  if (typeof result?.code === "string") return result.code;

  if (virtualId) {
    const loaded = await server.pluginContainer?.load?.(virtualId);
    if (typeof loaded === "string") return loaded;
    if (loaded && typeof loaded.code === "string") return loaded.code;
  }
  return null;
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
  if (isMountedEmbedStaticAssetRequest(req, runtimeUrl)) return false;

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
  if (req.headers["sec-fetch-site"] === "same-origin") return false;
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

function devFrameworkRoutePrefixes(): string[] {
  const configured = normalizeFrameworkRoutePrefix(
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX?.trim() ||
      undefined,
    "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX",
  );
  return configured === FRAMEWORK_INTERNAL_ROUTE_PREFIX
    ? [FRAMEWORK_INTERNAL_ROUTE_PREFIX]
    : [FRAMEWORK_INTERNAL_ROUTE_PREFIX, configured];
}

export function isFrameworkDevPath(
  reqUrl: string,
  base: string | undefined,
): boolean {
  const pathname = devPathname(reqUrl);
  const normalizedBase =
    !base || base === "/" ? "" : base.endsWith("/") ? base.slice(0, -1) : base;
  return devFrameworkRoutePrefixes().some(
    (prefix) =>
      matchesPathPrefix(pathname, prefix) ||
      (normalizedBase !== "" &&
        matchesPathPrefix(pathname, `${normalizedBase}${prefix}`)),
  );
}

export function isFrameworkDynamicDevPath(
  reqUrl: string,
  base: string | undefined,
): boolean {
  if (isFrameworkDevPath(reqUrl, base)) return true;
  const pathname = devPathname(reqUrl);
  if (pathname.startsWith("/.well-known/")) return true;
  if (base && base !== "/") {
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    if (pathname.startsWith(`${normalizedBase}/.well-known/`)) return true;
  }
  return false;
}

function rolldownInputFix(): Plugin {
  return {
    name: "agent-native-rolldown-input-fix",
    configEnvironment(_name, config) {
      const input = config.build?.rollupOptions?.input;
      if (!Array.isArray(input)) return;
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

const ALWAYS_SSR_STUBBED = [
  "@xterm/xterm",
  "@xterm/addon-fit",
  "@xterm/addon-web-links",
];

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
    "DOMSerializer",
    "Decoration",
    "DecorationSet",
    "Editor",
    "EditorContent",
    "Extension",
    "FitAddon",
    "Fragment",
    "Image",
    "InputRule",
    "Item",
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
    "Slice",
    "StarterKit",
    "Table",
    "TableCell",
    "TableHeader",
    "TableRow",
    "TaskItem",
    "TaskList",
    "Terminal",
    "Text",
    "TextSelection",
    "ThreadPrimitive",
    "Transform",
    "WebLinksAddon",
    "captureException",
    "codeToHtml",
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
    "getSchema",
    "init",
    "isChangeOrigin",
    "isNodeEmpty",
    "markInputRule",
    "markPasteRule",
    "mergeAttributes",
    "renderToString",
    "applyUpdate",
    "encodeStateVector",
    "encodeStateAsUpdate",
    "mergeUpdates",
    "useAui",
    "useAuiState",
    "useComposer",
    "useComposerRuntime",
    "useCurrentEditor",
    "useEditor",
    "useLocalRuntime",
    "useMessagePartReasoning",
    "useMessagePartRuntime",
    "useMessagePartText",
    "useMessageRuntime",
    "useThread",
    "useThreadRuntime",
    "withScope",
    "ContentType",
    "UndoManager",
    "XmlElement",
    "XmlFragment",
    "XmlText",
  ];
  return {
    name: "agent-native-ssr-stub-heavy-libs",
    enforce: "pre",
    resolveId(id, _importer, opts) {
      if (!opts?.ssr) return null;
      const pkg = id
        .split("/")
        .slice(0, id.startsWith("@") ? 2 : 1)
        .join("/");
      if (stubbed.has(pkg)) return STUB_ID;
      return null;
    },
    load(id) {
      if (id !== STUB_ID) return null;
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

function enterpriseAuthAdapterStubPlugin(enabled: boolean): Plugin | null {
  if (enabled) return null;

  const stubbed = new Set(["@better-auth/sso", "@better-auth/scim"]);
  const stubIdPrefix = "\0agent-native-enterprise-auth-adapter-stub:";
  return {
    name: "agent-native-enterprise-auth-adapter-stub",
    enforce: "pre",
    resolveId(id) {
      const packageName = id
        .split("/")
        .slice(0, id.startsWith("@") ? 2 : 1)
        .join("/");
      return stubbed.has(packageName) ? `${stubIdPrefix}${packageName}` : null;
    },
    load(id) {
      if (!id.startsWith(stubIdPrefix)) return null;
      return "export const sso = undefined; export const scim = undefined;";
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

function devActionBridgePlugin(): Plugin {
  return {
    name: "agent-native-dev-action-bridge",
    apply: "serve",
    configureServer(server) {
      const appRoot = process.cwd();
      server.httpServer?.once("listening", () => {
        const addr = server.httpServer?.address();
        if (!addr || typeof addr !== "object" || !addr.port) return;
        const printedOrigin = devActionBridgeOrigin(server.resolvedUrls);
        if (!printedOrigin) {
          server.config.logger.warn(
            "[agent-native] could not resolve the dev server's printed URL; skipping the dev action discovery file (pnpm action will run in-process)",
          );
          return;
        }
        writeDevActionDiscoveryFile(
          appRoot,
          printedOrigin,
          hashDatabaseKey(getRuntimeDatabaseUrl("pglite:./data/pglite")),
        );
      });
      const cleanup = () => removeDevActionDiscoveryFile(appRoot);
      server.httpServer?.once("close", cleanup);
      process.once("exit", cleanup);
    },
  };
}

function devAppDisplayName(appRoot: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
    ) as { displayName?: string; name?: string };
    return pkg.displayName || pkg.name || path.basename(appRoot);
  } catch {
    // coercion-ok: the banner is cosmetic; an unreadable package.json falls
    return path.basename(appRoot);
  }
}

export function _devServerStartupBanner(): Plugin {
  return {
    name: "agent-native-dev-server-banner",
    apply: "serve",
    configureServer(server) {
      const configuredPort = server.config.server.port;
      server.httpServer?.once("listening", () => {
        if (getAppConfig().workspace.isWorkspace === true) return;
        const addr = server.httpServer?.address();
        if (!addr || typeof addr !== "object" || !addr.port) return;
        const url =
          server.resolvedUrls?.local[0] ??
          server.resolvedUrls?.network[0] ??
          fallbackListeningUrl(
            server.config.base,
            Boolean(server.config.server.https),
            addr,
          );
        console.log(
          `[agent-native] ${devAppDisplayName(server.config.root)} listening on ${url} (root: ${server.config.root})`,
        );
        if (configuredPort && configuredPort !== addr.port) {
          console.log(
            `[agent-native] Port ${configuredPort} was in use; listening on ${addr.port} instead — the URL above is the real one.`,
          );
        }
      });
    },
  };
}

function fallbackListeningUrl(
  base: string,
  https: boolean,
  addr: { address: string; port: number },
): string {
  const hostPort = addr.address.includes(":")
    ? `[${addr.address}]:${addr.port}`
    : `${addr.address}:${addr.port}`;
  const normalizedBase = !base || base === "./" ? "/" : base;
  return `${https ? "https" : "http"}://${hostPort}${normalizedBase}`;
}

function devActionBridgeOrigin(
  resolvedUrls: { local?: string[] } | null | undefined,
): string | undefined {
  const printed = resolvedUrls?.local?.[0];
  if (!printed) return undefined;
  try {
    return new URL(printed).origin;
  } catch {
    // coercion-ok: undefined is the typed "nothing printed" result the caller
    return undefined;
  }
}

function isNitroEnvironmentUnavailable(error: unknown): boolean {
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  return (
    candidate?.name === "NitroViteError" &&
    (candidate.status === 503 || candidate.statusCode === 503) &&
    typeof candidate.message === "string" &&
    /Vite environment .+ is unavailable/.test(candidate.message)
  );
}

type NitroModuleNode = {
  id: string | null;
  ssrError?: Error | null;
  transformResult: unknown;
};

type NitroModuleGraph = {
  idToModuleMap: Map<string, NitroModuleNode>;
};

const NITRO_STARTUP_SETTLE_MS = 3_000;
const NITRO_STARTUP_POLL_INTERVAL_MS = 100;
const NITRO_STARTUP_TIMEOUT_MS = 30_000;
const NITRO_STARTUP_RETRY_DELAY_MS = 1_000;
const NITRO_STARTUP_RETRY_MAX_DELAY_MS = 3_000;
const NITRO_STARTUP_SLOW_HINT_MS = 8_000;

function nitroModuleGraphSignature(environment: unknown): string | null {
  const graph = (environment as { moduleGraph?: NitroModuleGraph } | undefined)
    ?.moduleGraph;
  if (!graph) return null;

  const modules = [...graph.idToModuleMap.values()];
  const entry = modules.find((module) =>
    module.id
      ?.replaceAll("\\", "/")
      .endsWith("/nitro/dist/runtime/internal/vite/dev-entry.mjs"),
  );
  if (!entry?.transformResult && !entry?.ssrError) return null;

  let transformed = 0;
  let errors = 0;
  for (const module of modules) {
    if (module.transformResult) transformed += 1;
    if (module.ssrError) errors += 1;
  }
  return `${modules.length}:${transformed}:${errors}`;
}

function isHtmlDocumentRequest(req: IncomingMessage): boolean {
  return (
    (req.method === "GET" || req.method === "HEAD") &&
    (req.headers.accept ?? "").includes("text/html")
  );
}

function sendNitroStartingResponse(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.statusCode = 503;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("retry-after", "1");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Dev server restarting…</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; color: #171717; background: #fafafa; }
      main { width: min(560px, calc(100vw - 48px)); }
      h1 { margin: 0 0 8px; font-size: 1.25rem; }
      p { margin: 0; color: #737373; }
    </style>
  </head>
  <body>
    <main>
      <h1>Dev server is restarting…</h1>
      <p id="agent-native-nitro-retry-status">Checking again shortly.</p>
    </main>
    <script>
      (() => {
        const status = document.getElementById("agent-native-nitro-retry-status");
        const startedAt = Date.now();
        let delayMs = ${NITRO_STARTUP_RETRY_DELAY_MS};
        const maxDelayMs = ${NITRO_STARTUP_RETRY_MAX_DELAY_MS};
        const slowHintMs = ${NITRO_STARTUP_SLOW_HINT_MS};
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const setStatus = (text) => {
          if (status) status.textContent = text;
        };
        const poll = async () => {
          setStatus("Waiting for the dev server…");
          while (true) {
            if (Date.now() - startedAt >= slowHintMs) {
              setStatus("Still starting… first boot can take a couple of minutes.");
            }
            try {
              const res = await fetch(location.href, {
                cache: "no-store",
                headers: { Accept: "text/html" },
              });
              if (res.status !== 503) {
                location.reload();
                return;
              }
            } catch {
              // Connection reset mid-boot; keep polling.
            }
            await wait(delayMs);
            delayMs = Math.min(delayMs + 500, maxDelayMs);
          }
        };
        void poll();
      })();
    </script>
  </body>
</html>`);
}

function nitroStartupGate(
  options: {
    now?: () => number;
    settleMs?: number;
    timeoutMs?: number;
  } = {},
): Plugin {
  return {
    name: "agent-native-nitro-startup-gate",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      const now = options.now ?? Date.now;
      const settleMs = options.settleMs ?? NITRO_STARTUP_SETTLE_MS;
      const timeoutMs = options.timeoutMs ?? NITRO_STARTUP_TIMEOUT_MS;
      const startedAt = now();
      let graphSignature: string | null = null;
      let graphStableAt: number | undefined;
      let startupComplete = false;
      let readinessTimer: ReturnType<typeof setInterval> | undefined;

      const completeStartup = () => {
        startupComplete = true;
        if (readinessTimer) {
          clearInterval(readinessTimer);
          readinessTimer = undefined;
        }
      };

      const observeStartup = () => {
        if (startupComplete) return;

        const timestamp = now();
        if (timestamp - startedAt >= timeoutMs) {
          completeStartup();
          return;
        }

        const nextGraphSignature = nitroModuleGraphSignature(
          server.environments?.nitro,
        );
        if (nextGraphSignature) {
          if (nextGraphSignature !== graphSignature) {
            graphSignature = nextGraphSignature;
            graphStableAt = timestamp;
          } else if (
            graphStableAt !== undefined &&
            timestamp - graphStableAt >= settleMs
          ) {
            completeStartup();
          }
        } else {
          graphSignature = null;
          graphStableAt = undefined;
        }
      };

      observeStartup();
      if (!startupComplete) {
        readinessTimer = setInterval(
          observeStartup,
          NITRO_STARTUP_POLL_INTERVAL_MS,
        );
        readinessTimer.unref?.();
        server.httpServer?.once("close", () => {
          if (readinessTimer) {
            clearInterval(readinessTimer);
            readinessTimer = undefined;
          }
        });
      }

      server.middlewares.use((req, res, next) => {
        if (startupComplete || !isHtmlDocumentRequest(req)) {
          next();
          return;
        }

        const timestamp = now();
        if (timestamp - startedAt >= timeoutMs) {
          completeStartup();
          next();
          return;
        }

        observeStartup();
        if (startupComplete) {
          next();
          return;
        }

        sendNitroStartingResponse(req, res);
      });
    },
  };
}

function nitroStartupRecovery(): Plugin {
  return {
    name: "agent-native-nitro-startup-recovery",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(function nitroStartupErrorRecovery(
        error: unknown,
        req: IncomingMessage,
        res: ServerResponse,
        next: (error?: unknown) => void,
      ) {
        if (
          !isNitroEnvironmentUnavailable(error) ||
          !isHtmlDocumentRequest(req) ||
          res.headersSent
        ) {
          next(error);
          return;
        }

        sendNitroStartingResponse(req, res);
      });
    },
  };
}

function persistent5xxRecovery(
  options: {
    enabled?: boolean;
    now?: () => number;
    exit?: (code: number) => void;
  } = {},
): Plugin {
  return {
    name: "agent-native-persistent-5xx-recovery",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      if (
        !(options.enabled ?? process.env[DEV_SERVER_SUPERVISOR_ENV] === "1")
      ) {
        return;
      }

      const now = options.now ?? Date.now;
      const exit = options.exit ?? ((code: number) => process.exit(code));
      let hasServedHealthyResponse = false;
      let first5xxAt: number | undefined;
      server.middlewares.use((req, res, next) => {
        if (!isHtmlDocumentRequest(req)) {
          next();
          return;
        }

        res.once("finish", () => {
          if ((res.statusCode ?? 500) < 500) {
            hasServedHealthyResponse = true;
            first5xxAt = undefined;
            return;
          }

          const failedAt = now();
          first5xxAt ??= failedAt;
          if (!hasServedHealthyResponse || failedAt - first5xxAt <= 75_000) {
            return;
          }

          console.error(
            `[agent-native] Dev server kept returning HTTP ${res.statusCode} after recovery; restarting.`,
          );
          exit(DEV_SERVER_RECOVERY_EXIT_CODE);
        });
        next();
      });
    },
  };
}

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
      server.httpServer?.on("connection", (socket) => {
        socket.on("error", (err: Error) => {
          if (!isBenign(err)) throw err;
        });
      });
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
    return null;
  }
}

function createTailwindPlugin(options: Pick<ClientConfigOptions, "tailwind">) {
  if (options.tailwind === false) return null;
  try {
    let tailwindPlugin = require("@tailwindcss/vite");
    if (tailwindPlugin.default) tailwindPlugin = tailwindPlugin.default;
    return tailwindPlugin({ optimize: false });
  } catch {
    return null;
  }
}

const DESIGN_SYSTEM_THEME_MODULE_ID = "virtual:agent-native-theme.css";
const RESOLVED_DESIGN_SYSTEM_THEME_MODULE_ID = `\0${DESIGN_SYSTEM_THEME_MODULE_ID}`;

function createDesignSystemThemePlugin(
  theme: DesignSystemTheme | undefined,
): Plugin | null {
  if (!theme) return null;
  const css = renderDesignSystemThemeCss(theme);

  return {
    name: "agent-native-design-system-theme",
    resolveId(id) {
      if (id === DESIGN_SYSTEM_THEME_MODULE_ID) {
        return RESOLVED_DESIGN_SYSTEM_THEME_MODULE_ID;
      }
    },
    load(id) {
      if (id === RESOLVED_DESIGN_SYSTEM_THEME_MODULE_ID) return css;
    },
    transformIndexHtml() {
      return [
        {
          tag: "style",
          attrs: { "data-agent-native-theme": "" },
          children: css,
          injectTo: "head",
        },
      ];
    },
  };
}

function getConfiguredAppBasePath(): { appBasePath: string; base: string } {
  const appBasePath =
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "/";
  const base = appBasePath.endsWith("/") ? appBasePath : `${appBasePath}/`;
  return { appBasePath, base };
}

function createNitroDevPlugin(
  options: Pick<ClientConfigOptions, "nitro">,
  appBasePath: string,
  cwd = process.cwd(),
) {
  const nitroOptions = options.nitro ?? {};
  const configuredExperimental = (
    nitroOptions as { experimental?: Record<string, unknown> }
  ).experimental;
  const configuredVite = (
    configuredExperimental as
      | { vite?: { services?: Record<string, unknown> } }
      | undefined
  )?.vite;
  const ssrEntry = resolveNitroSsrServiceEntry(
    path.resolve(
      cwd,
      typeof nitroOptions.rootDir === "string" ? nitroOptions.rootDir : ".",
    ),
  );
  return nitroVitePlugin({
    serverDir: "./server",
    ...nitroOptions,
    experimental: {
      ...configuredExperimental,
      ...(ssrEntry
        ? {
            vite: {
              ...configuredVite,
              services: {
                ...configuredVite?.services,
                ssr: configuredVite?.services?.ssr ?? { entry: ssrEntry },
              },
            },
          }
        : {}),
    },
    replace: {
      ...(nitroOptions as { replace?: Record<string, string> }).replace,
      "process.env.AGENT_NATIVE_RELEASE_MIGRATIONS": JSON.stringify(
        process.env.AGENT_NATIVE_RELEASE_MIGRATIONS?.trim() || "",
      ),
      "process.env.AGENT_NATIVE_BETA_SCHEMA_OWNER": JSON.stringify(
        process.env.AGENT_NATIVE_BETA_SCHEMA_OWNER?.trim() || "",
      ),
      [`process.env.${RECURRING_JOBS_BUILD_MARKER_ENV_VAR}`]: JSON.stringify(
        resolveRecurringJobsBuildMarker(process.env),
      ),
    },
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

function resolveNitroSsrServiceEntry(rootDir: string): string | undefined {
  for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
    const candidate = path.join(rootDir, `ssr-entry${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function arrayFrom<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const LOCAL_WORKSPACE_SOURCE_ALIAS_EXCLUDES = new Set([
  "@agent-native/core",
  "@agent-native/pinpoint",
]);

function localWorkspacePackageAliases(
  packages: Array<{ packageName: string; packageDir: string }>,
): any[] {
  const aliases: any[] = [];

  for (const { packageName, packageDir } of packages) {
    if (LOCAL_WORKSPACE_SOURCE_ALIAS_EXCLUDES.has(packageName)) continue;
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

const DEFAULT_VITE_WATCH_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".react-router",
  ".generated",
  ".agents",
  ".claude",
  ".data",
  "data",
  "dist",
  "build",
]);

export function defaultViteWatchIgnored(
  root: string,
): (file: string) => boolean {
  return (file) =>
    path
      .relative(root, file)
      .split(/[\\/]/)
      .slice(0, -1)
      .some((segment) => DEFAULT_VITE_WATCH_IGNORED_DIRS.has(segment));
}

function forceServeOnly(pluginOrPreset: any): any {
  if (Array.isArray(pluginOrPreset)) return pluginOrPreset.map(forceServeOnly);
  return {
    ...pluginOrPreset,
    apply: (config: UserConfig, configEnv: ConfigEnv) =>
      (config as UserConfig & { configFile?: false }).configFile !== false &&
      configEnv.command === "serve" &&
      !(configEnv.isPreview && process.env.IS_RR_BUILD_REQUEST === "yes"),
  };
}

function nitroPresetMarkerPlugin(
  options: ClientConfigOptions | AgentNativeVitePluginOptions,
): Plugin | null {
  const preset = options.nitro?.preset;
  if (typeof preset !== "string" || !preset.trim()) return null;

  return {
    name: "agent-native-nitro-preset-marker",
    configResolved(config) {
      if (config.command === "build") {
        writeAgentNativeNitroPresetMarker(preset);
      }
    },
  };
}

const AUTH_CLIENT_ASSET_PATH = "assets/auth-client.js";

function authClientEntryPath(): string {
  const sourceEntry = path.resolve(__dirname, "../client/auth/entry.tsx");
  return fs.existsSync(sourceEntry)
    ? sourceEntry
    : path.resolve(__dirname, "../client/auth/entry.js");
}

function authClientAssetPlugin(): Plugin {
  const entry = authClientEntryPath();
  let isBuild = false;
  let hasReactRouterHmr = false;
  return {
    name: "agent-native-auth-client-asset",
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    configResolved(config) {
      isBuild = config.command === "build";
      hasReactRouterHmr = config.plugins.some((plugin) =>
        plugin.name?.startsWith("react-router"),
      );
    },
    buildStart() {
      if (!isBuild) return;
      this.emitFile({
        type: "chunk",
        id: entry,
        fileName: AUTH_CLIENT_ASSET_PATH,
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://agent-native.local")
          .pathname;
        if (
          req.method !== "GET" ||
          !pathname.endsWith(`/${AUTH_CLIENT_ASSET_PATH}`)
        ) {
          next();
          return;
        }

        void server
          .transformRequest(entry)
          .then((result) => {
            if (!result?.code) {
              res.statusCode = 500;
              res.end("Unable to transform the auth client asset.");
              return;
            }
            const authClientCode = hasReactRouterHmr
              ? `import ${JSON.stringify(
                  `${server.config.base.replace(/\/+$/, "")}/@id/__x00__virtual:react-router/inject-hmr-runtime`,
                )};\n${result.code}`
              : result.code;
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/javascript");
            res.end(authClientCode);
          })
          .catch(next);
      });
    },
  };
}

function resolveAgentNativeRuntimeEnv(
  cwd: string,
  mode: string,
): Record<string, string | undefined> {
  const workspaceRoot = findWorkspaceRoot(cwd);
  return {
    ...(workspaceRoot && workspaceRoot !== cwd
      ? loadEnv(mode, workspaceRoot, "")
      : {}),
    ...loadEnv(mode, cwd, ""),
    ...process.env,
  };
}

function externalStoreShimPlugin(): Plugin {
  const sourceEntry = path.resolve(__dirname, "external-store-shim.ts");
  const entry = fs.existsSync(sourceEntry)
    ? sourceEntry
    : path.resolve(__dirname, "external-store-shim.js");
  return {
    name: "agent-native-external-store-esm-shim",
    enforce: "pre",
    resolveId(source, _importer, options) {
      if (options?.ssr) return null;
      if (
        source === "use-sync-external-store" ||
        source === "use-sync-external-store/shim" ||
        source === "use-sync-external-store/shim/index.js"
      ) {
        return entry;
      }
      if (
        source === "use-sync-external-store/with-selector" ||
        source === "use-sync-external-store/with-selector.js" ||
        source === "use-sync-external-store/shim/with-selector" ||
        source === "use-sync-external-store/shim/with-selector.js"
      ) {
        return entry;
      }
      return null;
    },
  };
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
  const nitroPlugin = createNitroDevPlugin(options, appBasePath, process.cwd());
  const includeNitro = !isBuildCommand(command);
  const presetMarkerPlugin = nitroPresetMarkerPlugin(options);
  const runtimeEnv = resolveAgentNativeRuntimeEnv(
    process.cwd(),
    process.env.NODE_ENV === "production" ? "production" : "development",
  );
  const enterpriseAuthAdaptersEnabled = [
    runtimeEnv.AUTH_SSO,
    runtimeEnv.AUTH_SCIM,
  ].some((value) =>
    ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? ""),
  );
  const enterpriseAuthSsrStubs =
    isBuildCommand(command) && !enterpriseAuthAdaptersEnabled
      ? ["@better-auth/sso", "@better-auth/scim"]
      : [];

  return [
    persistent5xxRecovery(),
    presetMarkerPlugin,
    ssrStubPlugin([
      ...ALWAYS_SSR_STUBBED,
      ...enterpriseAuthSsrStubs,
      ...(options.ssrStubs ?? []),
    ]),
    enterpriseAuthAdapterStubPlugin(enterpriseAuthAdaptersEnabled),
    ...userPlugins,
    externalStoreShimPlugin(),
    appChangelogRawPlugin(),
    actionTypesPlugin(),
    agentsBundlePlugin({ agentNativeConfig: options.agentNativeConfig }),
    authClientAssetPlugin(),
    autoReloadOnOptimizeDep(),
    fullReloadOnOptimizeDep504(),
    embedDevFrameHeaders(),
    baseRedirectGuard(),
    frameworkDevDynamicForwarder(),
    portExposer(),
    devActionBridgePlugin(),
    _devServerStartupBanner(),
    nitroStartupGate(),
    reactRouterVirtualInvalidationMirrorPlugin(),
    silenceConnectionResets(),
    rolldownInputFix(),
    ...(useServeOnlyNitroPlugin
      ? [forceServeOnly(nitroPlugin)]
      : includeNitro
        ? [nitroPlugin]
        : []),
    nitroStartupRecovery(),
    includeReactTransform ? createReactTransformPlugin() : null,
    createDesignSystemThemePlugin(options.designSystemTheme),
    createTailwindPlugin(options),
    // No-ops unless a Sentry auth token/org/project is configured.
    ...createSentrySourceMapUploadPlugin(runtimeEnv),
  ].filter(Boolean);
}

function resolveAgentNativeTemplate(cwd: string): string {
  const configured = [
    process.env.AGENT_NATIVE_TEMPLATE,
    process.env.VITE_AGENT_NATIVE_TEMPLATE,
    process.env.VITE_APP_TEMPLATE,
  ].find((value) => value?.trim());
  if (configured) return configured.trim().toLowerCase();

  const normalizedCwd = cwd.replaceAll("\\", "/");
  const marker = "/templates/";
  const markerIndex = normalizedCwd.lastIndexOf(marker);
  if (markerIndex === -1) return "";
  return (
    normalizedCwd
      .slice(markerIndex + marker.length)
      .split("/")[0]
      ?.trim()
      .toLowerCase() ?? ""
  );
}

function reportRuntimeConfigDiagnostics(
  appConfig: AgentNativeConfig,
  context: AgentNativeConfigContext,
  mode: string,
  env: Record<string, string | undefined> = process.env,
): void {
  const production =
    mode === "production" || process.env.NODE_ENV === "production";
  if (!production) return;

  const report = getRuntimeConfigReport(
    env,
    {
      authEnabled: appConfig.runtime?.auth?.enabled,
      databaseRequired: appConfig.runtime?.database?.required,
      requiredEnv: appConfig.runtime?.environment?.required,
    },
    {
      environment: "production",
      phase: context.isBuild ? "build" : "runtime",
      appName: process.env.APP_NAME,
    },
  );
  if (report.issues.length === 0) return;

  const key = [
    process.cwd(),
    context.command,
    mode,
    report.issues.map((issue) => `${issue.code}:${issue.severity}`).join(","),
  ].join("|");
  if (emittedRuntimeConfigDiagnostics.has(key)) return;
  emittedRuntimeConfigDiagnostics.add(key);

  const message = formatRuntimeConfigReport(report);
  if (context.isBuild && appConfig.diagnostics?.failOnBuild === true) {
    throw new Error(message);
  }
  console.warn(message);
}

function createAgentNativeConfig(
  options: ClientConfigOptions | AgentNativeVitePluginOptions = {},
  command?: AgentNativeViteCommand,
  userConfig: UserConfig = {},
  mode = process.env.NODE_ENV === "production" ? "production" : "development",
  projectConfig?: AgentNativeConfigInput,
  workspaceConfig?: AgentNativeConfigInput,
): UserConfig {
  const cwd = process.cwd();
  const usesAgentKit = hasDep("@agent-native/agentkit", cwd);
  const configContext = createAgentNativeConfigContext(command, mode);
  const projectConfigInput = projectConfig ?? options.agentNativeConfig;

  const workspaceRoot = findWorkspaceRoot(cwd);
  const envDir = workspaceRoot && workspaceRoot !== cwd ? workspaceRoot : cwd;

  const runtimeEnv = resolveAgentNativeRuntimeEnv(cwd, mode);
  const appConfig = resolveAgentNativeConfig(
    mergeAgentNativeConfigs(
      mergeAgentNativeConfigs(
        mergeAgentNativeConfigs(
          workspaceConfig
            ? resolveAgentNativeConfig(workspaceConfig, configContext)
            : {},
          readAgentNativeJsonConfig(cwd),
        ),
        projectConfigInput
          ? resolveAgentNativeConfig(projectConfigInput, configContext)
          : {},
      ),
      readAgentNativeConfigEnv(runtimeEnv),
      { arrayStrategy: "replace" },
    ),
    configContext,
  );
  const inferredDeploymentEnvironment =
    appConfig.deployment?.environment ??
    inferAgentNativeDeploymentEnvironment(process.env, mode);
  const resolvedAppConfig =
    appConfig.deployment?.environment === undefined &&
    inferredDeploymentEnvironment !== undefined
      ? {
          ...appConfig,
          deployment: {
            ...appConfig.deployment,
            environment: inferredDeploymentEnvironment,
          },
        }
      : appConfig;
  const firstRunOnboardingMode = resolveFirstRunOnboardingBuildReplacement(
    resolvedAppConfig,
    runtimeEnv,
  );
  const harnessMode = resolveHarnessBuildReplacement(resolvedAppConfig);
  if (command === "build") {
    writeAgentNativeBuildConfigMarker(cwd, {
      firstRunOnboarding: firstRunOnboardingMode,
      harness: harnessMode,
    });
  }
  const firstRunOnboardingBuildMode = JSON.stringify(firstRunOnboardingMode);
  const harnessBuildMode = JSON.stringify(harnessMode);
  const buildId = resolveAgentNativeBuildId(process.env, "development");
  const packageVersions = resolveAgentNativePackageVersions(cwd);
  const frameworkRoutePrefix =
    resolvedAppConfig.runtime?.frameworkRoutePrefix ?? "";
  // guard:allow-env-mutation — Vite config phase, set once before the in-process Nitro dev server accepts a request
  process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX =
    frameworkRoutePrefix;

  if (workspaceRoot && workspaceRoot !== cwd) {
    try {
      const dotenv = require("dotenv");
      dotenv.config({
        path: path.join(workspaceRoot, ".env"),
        override: false,
        quiet: true,
      });
    } catch {}
  }

  reportRuntimeConfigDiagnostics(appConfig, configContext, mode, runtimeEnv);

  const { base } = getConfiguredAppBasePath();
  const isWorkspaceChild =
    isTruthyRuntimeValue(process.env.AGENT_NATIVE_WORKSPACE) ||
    isTruthyRuntimeValue(process.env.VITE_AGENT_NATIVE_WORKSPACE) ||
    Boolean(process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON?.trim()) ||
    Boolean(process.env.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON?.trim());
  const monorepoPackageAllow = [
    path.resolve(cwd, "../../packages/core"),
    path.resolve(cwd, "../core"),
    path.resolve(cwd, "../../packages/toolkit"),
    path.resolve(cwd, "../toolkit"),
  ].filter((candidate) => fs.existsSync(path.join(candidate, "package.json")));
  const monorepoNodeModulesAllow = [
    path.resolve(cwd, "../../node_modules"),
  ].filter((candidate) => fs.existsSync(candidate));

  const workspaceCore = findWorkspaceCoreSync(cwd);
  const workspaceCoreFsAllow = workspaceCore
    ? [
        workspaceCore.packageDir,
        path.join(workspaceCore.workspaceRoot, "node_modules"),
      ]
    : [];
  const workspaceNodeModulesAllow = isWorkspaceChild
    ? [path.resolve(cwd, "../../node_modules")]
    : [];
  const packageWorkspaceRoot = workspaceRoot ?? findPnpmWorkspaceRoot(cwd);
  const isStandaloneAgentKitDev =
    usesAgentKit &&
    (command === "serve" || (!command && !isBuildCommand(command))) &&
    findCoreSrcDir(cwd) === null;
  const localWorkspacePackageDeps = findLocalWorkspacePackageDeps(
    cwd,
    packageWorkspaceRoot,
  ).filter(
    (pkg) =>
      !(
        isStandaloneAgentKitDev && pkg.packageName.startsWith("@agent-native/")
      ),
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
  const { rollupOptions: _buildRollupOptionsAlias, ...userBuild } =
    userConfig.build ?? {};
  const { rollupOptions: _depsRollupOptionsAlias, ...userOptimizeDeps } =
    userConfig.optimizeDeps ?? {};

  return {
    nitro: {
      replace: {
        "process.env.AGENT_NATIVE_BUILD_FIRST_RUN_ONBOARDING":
          firstRunOnboardingBuildMode,
        "process.env.AGENT_NATIVE_BUILD_HARNESS": harnessBuildMode,
      },
    },
    logLevel:
      options.logLevel ??
      userConfig.logLevel ??
      (isWorkspaceChild ? "warn" : undefined),
    envDir,
    base,
    define: {
      ...(userConfig.define ?? {}),
      ...(options.define ?? {}),
      __AGENT_NATIVE_BUILD_ID__: JSON.stringify(buildId),
      __AGENT_NATIVE_PACKAGE_VERSIONS__: JSON.stringify(packageVersions),
      __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__: JSON.stringify(
        options.clientCompatibilityVersion?.trim() || "",
      ),
      __AGENT_NATIVE_APP_CONFIG__: JSON.stringify(resolvedAppConfig),
      "process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX":
        JSON.stringify(frameworkRoutePrefix),
      __AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__: JSON.stringify(
        process.env.GA_MEASUREMENT_ID?.trim() || "",
      ),
      "process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID": JSON.stringify(
        process.env.GA_MEASUREMENT_ID?.trim() || "",
      ),
      "process.env.AGENT_NATIVE_BUILD_ANALYTICS_PUBLIC_KEY": JSON.stringify(
        process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY?.trim() ||
          process.env.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY?.trim() ||
          "",
      ),
      "process.env.AGENT_NATIVE_BUILD_ANALYTICS_ENDPOINT": JSON.stringify(
        process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT?.trim() ||
          process.env.VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT?.trim() ||
          "",
      ),
      "process.env.AGENT_NATIVE_RELEASE_MIGRATIONS": JSON.stringify(
        process.env.AGENT_NATIVE_RELEASE_MIGRATIONS?.trim() || "",
      ),
      "process.env.AGENT_NATIVE_BETA_SCHEMA_OWNER": JSON.stringify(
        process.env.AGENT_NATIVE_BETA_SCHEMA_OWNER?.trim() || "",
      ),
      [`process.env.${RECURRING_JOBS_BUILD_MARKER_ENV_VAR}`]: JSON.stringify(
        resolveRecurringJobsBuildMarker(process.env),
      ),
      "process.env.AGENT_NATIVE_BUILD_FIRST_RUN_ONBOARDING":
        firstRunOnboardingBuildMode,
      "process.env.AGENT_NATIVE_BUILD_HARNESS": harnessBuildMode,
      ...(resolvedAppConfig.deployment?.environment
        ? {
            "process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT": JSON.stringify(
              resolvedAppConfig.deployment.environment,
            ),
          }
        : {}),
      __AGENT_NATIVE_BUILD_GTM_CONTAINER_ID__: JSON.stringify(
        process.env.GTM_CONTAINER_ID?.trim() || "",
      ),
      "process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID": JSON.stringify(
        process.env.GTM_CONTAINER_ID?.trim() || "",
      ),
      __AGENT_NATIVE_ROUTE_WARMUP_CONFIG__: JSON.stringify(
        normalizeAgentNativeRouteWarmupConfig(options.routeWarmup),
      ),
      __AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__: JSON.stringify(
        normalizeMcpIntegrationsConfig(options.mcpIntegrations),
      ),
      __AGENT_NATIVE_TEMPLATE__: JSON.stringify(
        resolveAgentNativeTemplate(cwd),
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
          defaultViteWatchIgnored(path.resolve(cwd, userConfig.root ?? "")),
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
          ...monorepoPackageAllow,
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
      ...userBuild,
      outDir: options.outDir ?? userConfig.build?.outDir ?? "dist/spa",
      cssMinify: userConfig.build?.cssMinify ?? "esbuild",
      cssTarget: userConfig.build?.cssTarget ?? ["es2020", "safari18"],
      // sourceMappingURL comment, so production never serves them directly.
      sourcemap:
        userConfig.build?.sourcemap ??
        (isSentrySourceMapUploadEnabled(runtimeEnv) ? "hidden" : false),
    },
    ssr: isBuildCommand(command)
      ? {
          ...(userConfig.ssr ?? {}),
          noExternal:
            /^(?!(?:react|react-dom|react-router|@tanstack\/react-query)(?:\/|$))(?!node:)/,
          external: [
            "yjs",
            "@agent-native/core",
            "react",
            "react-dom",
            "react-router",
            "@tanstack/react-query",
            ...arrayFrom((userConfig.ssr as { external?: any })?.external),
          ],
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
          noExternal: [
            /^@agent-native\/core(\/.*)?$/,
            ...(hasDep("react-router", cwd) ? [/^react-router(\/.*)?$/] : []),
            /^@radix-ui\//,
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
      ...userOptimizeDeps,
      noDiscovery: usesAgentKit
        ? (userConfig.optimizeDeps?.noDiscovery ?? true)
        : userConfig.optimizeDeps?.noDiscovery,
      include: [
        ...(usesAgentKit
          ? getAgentKitOptimizeDeps(cwd)
          : getDefaultOptimizeDeps(cwd)),
        ...(hasDep("@agent-native/pinpoint", cwd)
          ? ["@agent-native/pinpoint/react"]
          : []),
        ...(userConfig.optimizeDeps?.include ?? []),
        ...(options.optimizeDeps?.include ?? []),
      ],
      exclude: [
        ...(findCoreSrcDir(cwd) !== null ? CORE_CLIENT_SUBPATHS : []),
        ...(usesAgentKit ? getAgentKitOptimizeExcludes(cwd, command) : []),
        ...localWorkspacePackageDeps
          .filter(
            (pkg) =>
              !LOCAL_WORKSPACE_SOURCE_ALIAS_EXCLUDES.has(pkg.packageName),
          )
          .map((pkg) => pkg.packageName),
        ...(userConfig.optimizeDeps?.exclude ?? []),
        ...(options.optimizeDeps?.exclude ?? []),
      ],
      ...(process.env.AGENT_NATIVE_DEP_SOURCEMAPS === "1"
        ? {}
        : {
            rolldownOptions: {
              ...(userConfig.optimizeDeps?.rolldownOptions ?? {}),
              plugins: [
                ...arrayFrom(userConfig.optimizeDeps?.rolldownOptions?.plugins),
                externalStoreShimPlugin(),
                disableDepSourcemapsPlugin,
              ],
            },
          }),
    },
    resolve: {
      ...(userConfig.resolve ?? {}),
      dedupe: [
        ...getClientDedupe(cwd),
        ...arrayFrom((userConfig.resolve as { dedupe?: any })?.dedupe),
      ],
      alias: [
        ...(isBuildCommand(command) ? [] : getReactRouterAliases(cwd)),
        ...getAssistantUiAliases(cwd),
        ...(isBuildCommand(command) ? [] : getCoreSourceAliases(cwd)),
        ...localWorkspacePackageResolveAliases,
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

function createAgentNativeConfigPlugin(
  options: ClientConfigOptions | AgentNativeVitePluginOptions,
): Plugin {
  return {
    name: "agent-native-config",
    enforce: "pre",
    async config(config: UserConfig, env: ConfigEnv) {
      const workspaceConfig = await loadWorkspaceAgentNativeConfigFile(
        process.cwd(),
      );
      const projectConfig =
        options.agentNativeConfig ??
        (await loadAgentNativeConfigFile(process.cwd()));
      return createAgentNativeConfig(
        options,
        env.command,
        config,
        env.mode,
        projectConfig,
        workspaceConfig,
      );
    },
  };
}

export function agentNative(
  options: AgentNativeVitePluginOptions = {},
): Plugin[] {
  return [
    createAgentNativeConfigPlugin(options),
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
    plugins: [
      createAgentNativeConfigPlugin(options),
      ...createAgentNativePlugins(options, {
        includeReactTransform,
        userPlugins: options.plugins,
      }),
    ],
  };
}

export {
  devActionBridgePlugin as _devActionBridgePlugin,
  devActionBridgeOrigin as _devActionBridgeOrigin,
  getClientDedupe as _getClientDedupe,
  getDefaultOptimizeDeps as _getDefaultOptimizeDeps,
  findCorePackageRoot as _findCorePackageRoot,
  getReactRouterAliases as _getReactRouterAliases,
  nitroStartupGate as _nitroStartupGate,
  nitroStartupRecovery as _nitroStartupRecovery,
  persistent5xxRecovery as _persistent5xxRecovery,
  nitroModuleGraphSignature as _nitroModuleGraphSignature,
  resolveNitroSsrServiceEntry as _resolveNitroSsrServiceEntry,
  debounceNitroFullReloadHotUpdate as _debounceNitroFullReloadHotUpdate,
  installReactRouterVirtualInvalidationMirror as _installReactRouterVirtualInvalidationMirror,
  mirrorReactRouterVirtualInvalidation as _mirrorReactRouterVirtualInvalidation,
};
