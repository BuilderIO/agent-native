import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { minimatch } from "minimatch";

const BRIDGE_KEY = Symbol.for("agent-native.react-router-dev-recovery");
const ATTEMPT_STATE_KEY = Symbol.for(
  "agent-native.react-router-dev-recovery-attempts",
);

const ROUTE_MODULE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".md",
  ".mdx",
]);
const NON_ROUTE_PATTERNS = [
  "**/*.test.{js,jsx,ts,tsx,md,mdx}",
  "**/*.spec.{js,jsx,ts,tsx,md,mdx}",
  "**/*.test/**",
  "**/*.spec/**",
  "**/__tests__/**",
  "**/__snapshots__/**",
];

export type ReactRouterRecoveryRequest =
  | "started"
  | "pending"
  | "cooldown"
  | "bounded";

export interface ReactRouterDiscoveryRoot {
  appDirectory: string;
  directory: string;
  ignoredRouteFiles: readonly string[];
}

export interface ReactRouterRouteScope {
  exactRouteFiles: readonly string[];
  discoveryRoots: readonly ReactRouterDiscoveryRoot[];
}

export interface ReactRouterDevRecoveryBridge {
  routeScope: ReactRouterRouteScope;
  requestFallback(input: {
    modulePath: string;
    requestPathname: string;
    reason: string;
  }): ReactRouterRecoveryRequest;
  markSsrSuccess(requestPathname: string): void;
}

interface RecoveryCoordinatorOptions {
  restart: () => Promise<void>;
  cooldownMs?: number;
  maxConsecutiveAttempts?: number;
  now?: () => number;
  setTimer?: typeof setTimeout;
  onOutcome?: (message: string, error?: unknown) => void;
  persistentStateKey?: string;
}

interface RecoveryAttemptState {
  fallbackAttemptsByModule: Map<string, number>;
  pathnameModules: Map<string, string>;
  lastStartedAt: number;
}

interface RecoveryRequest {
  fallbackReasons: Map<string, string>;
  topologyReason?: string;
}

export interface ReactRouterRecoveryCoordinator extends ReactRouterDevRecoveryBridge {
  requestTopology(reason: string): ReactRouterRecoveryRequest;
  dispose(): void;
}

function globalBridgeStore(): typeof globalThis & {
  [BRIDGE_KEY]?: ReactRouterDevRecoveryBridge;
  [ATTEMPT_STATE_KEY]?: Map<string, RecoveryAttemptState>;
} {
  return globalThis as typeof globalThis & {
    [BRIDGE_KEY]?: ReactRouterDevRecoveryBridge;
    [ATTEMPT_STATE_KEY]?: Map<string, RecoveryAttemptState>;
  };
}

function newAttemptState(): RecoveryAttemptState {
  return {
    fallbackAttemptsByModule: new Map(),
    pathnameModules: new Map(),
    lastStartedAt: Number.NEGATIVE_INFINITY,
  };
}

function recoveryAttemptState(key?: string): RecoveryAttemptState {
  if (!key) return newAttemptState();
  const store = globalBridgeStore();
  store[ATTEMPT_STATE_KEY] ??= new Map();
  const existing = store[ATTEMPT_STATE_KEY].get(key);
  if (existing) return existing;
  const state = newAttemptState();
  store[ATTEMPT_STATE_KEY].set(key, state);
  return state;
}

export function registerReactRouterDevRecovery(
  bridge: ReactRouterDevRecoveryBridge,
): () => void {
  const store = globalBridgeStore();
  store[BRIDGE_KEY] = bridge;
  return () => {
    if (store[BRIDGE_KEY] === bridge) delete store[BRIDGE_KEY];
  };
}

export function getReactRouterDevRecovery():
  | ReactRouterDevRecoveryBridge
  | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return globalBridgeStore()[BRIDGE_KEY];
}

function normalizeFile(file: string): string {
  return path.resolve(file);
}

function relativeInside(file: string, root: string): string | undefined {
  const relative = path.relative(root, file);
  if (relative === "") return "";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.replaceAll(path.sep, "/");
}

function hasDotPathSegment(relative: string): boolean {
  return relative.split("/").some((segment) => segment.startsWith("."));
}

function isIgnoredRoutePath(
  relativeToApp: string,
  ignoredRouteFiles: readonly string[],
  directory = false,
): boolean {
  if (hasDotPathSegment(relativeToApp)) return true;
  return [...NON_ROUTE_PATTERNS, ...ignoredRouteFiles].some(
    (pattern) =>
      minimatch(relativeToApp, pattern, { dot: true }) ||
      (directory &&
        minimatch(`${relativeToApp}/__route.tsx`, pattern, { dot: true })),
  );
}

export function isReactRouterRouteModulePath(
  file: string,
  scope: ReactRouterRouteScope,
): boolean {
  const absolute = normalizeFile(file);
  if (
    scope.exactRouteFiles.some(
      (candidate) => normalizeFile(candidate) === absolute,
    )
  ) {
    return true;
  }
  if (!ROUTE_MODULE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
    return false;
  }
  return scope.discoveryRoots.some((root) => {
    const directory = normalizeFile(root.directory);
    const appDirectory = normalizeFile(root.appDirectory);
    const relativeToRoot = relativeInside(absolute, directory);
    const relativeToApp = relativeInside(absolute, appDirectory);
    if (relativeToRoot === undefined || relativeToApp === undefined)
      return false;
    const segments = relativeToRoot.split("/");
    if (segments.length > 2) return false;
    if (segments.length === 2) {
      const moduleName = path.basename(segments[1], path.extname(segments[1]));
      if (moduleName !== "route" && moduleName !== "index") return false;
    }
    return !isIgnoredRoutePath(relativeToApp, root.ignoredRouteFiles);
  });
}

export function isReactRouterRouteDirectoryPath(
  directory: string,
  scope: ReactRouterRouteScope,
): boolean {
  const absolute = normalizeFile(directory);
  return scope.discoveryRoots.some((root) => {
    const discoveryRoot = normalizeFile(root.directory);
    const appDirectory = normalizeFile(root.appDirectory);
    const relativeToRoot = relativeInside(absolute, discoveryRoot);
    const relativeToApp = relativeInside(absolute, appDirectory);
    if (relativeToRoot === undefined || relativeToApp === undefined)
      return false;
    if (relativeToRoot && relativeToRoot.includes("/")) return false;
    return !isIgnoredRoutePath(relativeToApp, root.ignoredRouteFiles, true);
  });
}

export function createReactRouterRecoveryCoordinator(
  routeScope: ReactRouterRouteScope,
  options: RecoveryCoordinatorOptions,
): ReactRouterRecoveryCoordinator {
  const cooldownMs = options.cooldownMs ?? 500;
  const maxConsecutiveAttempts = options.maxConsecutiveAttempts ?? 3;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const attemptState = recoveryAttemptState(options.persistentStateKey);
  let running = false;
  let pendingRequest: RecoveryRequest | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const hasWork = (request: RecoveryRequest | undefined) =>
    Boolean(
      request && (request.topologyReason || request.fallbackReasons.size > 0),
    );

  const recoveryReason = (request: RecoveryRequest) =>
    [request.topologyReason, ...request.fallbackReasons.values()]
      .filter(Boolean)
      .join(", ");

  const clearPending = () => {
    pendingRequest = undefined;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
  };

  const mergePending = (request: RecoveryRequest) => {
    if (!pendingRequest) {
      pendingRequest = {
        fallbackReasons: new Map(request.fallbackReasons),
        topologyReason: request.topologyReason,
      };
      return;
    }
    if (request.topologyReason) {
      pendingRequest.topologyReason = request.topologyReason;
    }
    for (const [module, reason] of request.fallbackReasons) {
      pendingRequest.fallbackReasons.set(module, reason);
    }
  };

  const schedulePending = () => {
    if (!hasWork(pendingRequest) || pendingTimer || disposed) return;
    const delay = Math.max(
      0,
      cooldownMs - (now() - attemptState.lastStartedAt),
    );
    pendingTimer = setTimer(() => {
      pendingTimer = undefined;
      if (disposed || !hasWork(pendingRequest)) return;
      if (running) return;
      const remainingCooldown =
        cooldownMs - (now() - attemptState.lastStartedAt);
      if (remainingCooldown > 0) {
        schedulePending();
        return;
      }
      const request = pendingRequest;
      pendingRequest = undefined;
      if (request) run(request);
    }, delay);
    pendingTimer.unref?.();
  };

  const run = (request: RecoveryRequest) => {
    if (disposed) return;
    if (running) {
      mergePending(request);
      return;
    }
    running = true;
    for (const module of request.fallbackReasons.keys()) {
      const attempts = attemptState.fallbackAttemptsByModule.get(module) ?? 0;
      attemptState.fallbackAttemptsByModule.set(module, attempts + 1);
    }
    attemptState.lastStartedAt = now();
    let restart: Promise<void>;
    try {
      restart = options.restart();
    } catch (error) {
      restart = Promise.reject(error);
    }
    void restart
      .then(
        () =>
          options.onOutcome?.(
            `React Router route recovery completed: ${recoveryReason(request)}`,
          ),
        (error) =>
          options.onOutcome?.(
            `React Router route recovery failed: ${recoveryReason(request)}`,
            error,
          ),
      )
      .finally(() => {
        running = false;
        if (disposed || !hasWork(pendingRequest)) return;
        schedulePending();
      });
  };

  const request = (
    nextRequest: RecoveryRequest,
  ): ReactRouterRecoveryRequest => {
    if (disposed) return "bounded";
    if (hasWork(pendingRequest) || pendingTimer) {
      mergePending(nextRequest);
      if (!running) schedulePending();
      return running ? "pending" : "cooldown";
    }
    if (running) {
      mergePending(nextRequest);
      return "pending";
    }
    if (now() - attemptState.lastStartedAt < cooldownMs) {
      mergePending(nextRequest);
      schedulePending();
      return "cooldown";
    }
    run(nextRequest);
    return "started";
  };

  return {
    routeScope: {
      exactRouteFiles: routeScope.exactRouteFiles.map(normalizeFile),
      discoveryRoots: routeScope.discoveryRoots.map((root) => ({
        appDirectory: normalizeFile(root.appDirectory),
        directory: normalizeFile(root.directory),
        ignoredRouteFiles: [...root.ignoredRouteFiles],
      })),
    },
    requestFallback({ modulePath, requestPathname, reason }) {
      const module = normalizeFile(modulePath);
      attemptState.pathnameModules.set(requestPathname, module);
      const attempts = attemptState.fallbackAttemptsByModule.get(module) ?? 0;
      if (attempts >= maxConsecutiveAttempts) return "bounded";
      return request({
        fallbackReasons: new Map([[module, reason]]),
      });
    },
    requestTopology(reason) {
      return request({
        fallbackReasons: new Map(),
        topologyReason: reason,
      });
    },
    markSsrSuccess(requestPathname) {
      const module = attemptState.pathnameModules.get(requestPathname);
      if (!module) return;
      attemptState.fallbackAttemptsByModule.delete(module);
      for (const [pathname, associatedModule] of attemptState.pathnameModules) {
        if (associatedModule === module) {
          attemptState.pathnameModules.delete(pathname);
        }
      }
      pendingRequest?.fallbackReasons.delete(module);
      if (!hasWork(pendingRequest)) clearPending();
    },
    dispose() {
      disposed = true;
      clearPending();
    },
  };
}

function errorChains(error: unknown): Record<string, unknown>[][] {
  const visit = (
    current: unknown,
    chain: Record<string, unknown>[],
    seen: Set<unknown>,
  ): Record<string, unknown>[][] => {
    if (!current || typeof current !== "object" || seen.has(current)) {
      return chain.length > 0 ? [chain] : [];
    }
    const nextSeen = new Set(seen).add(current);
    const record = current as Record<string, unknown>;
    const nextChain = [...chain, record];
    const children = [
      record.cause,
      ...(Array.isArray(record.errors) ? record.errors : []),
    ].filter(Boolean);
    if (children.length === 0) return [nextChain];
    return children.flatMap((child) => visit(child, nextChain, nextSeen));
  };
  return visit(error, [], new Set());
}

function cleanReferencedPath(value: string): string | undefined {
  let candidate = value.trim().replace(/^['"]|['"]$/g, "");
  candidate = candidate.split(/[?#]/, 1)[0] ?? candidate;
  if (candidate.startsWith("file://")) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      return undefined;
    }
  }
  if (candidate.startsWith("/@fs/")) candidate = candidate.slice(4);
  if (!path.isAbsolute(candidate)) return undefined;
  try {
    return path.resolve(decodeURIComponent(candidate));
  } catch {
    return undefined;
  }
}

export function extractViteLoadUrlPath(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const direct = [record.id, record.file, record.url].find(
    (value): value is string => typeof value === "string",
  );
  if (direct) {
    const cleaned = cleanReferencedPath(direct);
    if (cleaned) return cleaned;
  }
  const message = typeof record.message === "string" ? record.message : "";
  const resolved = message.match(/\(resolved id:\s*([^\)]+)\)/)?.[1];
  if (resolved) {
    const cleaned = cleanReferencedPath(resolved);
    if (cleaned) return cleaned;
  }
  const loaded = message.match(
    /Failed to load url\s+(.+?)(?:\s+\(resolved id:|\s+in\s+)/,
  )?.[1];
  return loaded ? cleanReferencedPath(loaded) : undefined;
}

export function classifyStaleReactRouterRouteError(
  error: unknown,
  routeScope: ReactRouterRouteScope,
): { file: string } | undefined {
  for (const chain of errorChains(error)) {
    if (!chain.some((candidate) => candidate.code === "ERR_LOAD_URL")) continue;
    const context = chain
      .flatMap((candidate) => [
        candidate.message,
        candidate.importer,
        candidate.plugin,
        candidate.id,
        candidate.url,
      ])
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (!context.includes("virtual:react-router/server-build")) continue;
    for (const candidate of chain) {
      const file = extractViteLoadUrlPath(candidate);
      if (!file || !isReactRouterRouteModulePath(file, routeScope)) continue;
      if (fs.existsSync(file)) continue;
      return { file };
    }
  }
  return undefined;
}
