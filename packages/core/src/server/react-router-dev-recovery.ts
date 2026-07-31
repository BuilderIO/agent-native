import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE_KEY = Symbol.for("agent-native.react-router-dev-recovery");
const ATTEMPT_STATE_KEY = Symbol.for(
  "agent-native.react-router-dev-recovery-attempts",
);

export type ReactRouterRecoveryRequest =
  | "started"
  | "pending"
  | "cooldown"
  | "bounded";

export interface ReactRouterDevRecoveryBridge {
  routeRoots: readonly string[];
  requestFallback(reason: string): ReactRouterRecoveryRequest;
  markSsrSuccess(): void;
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
  fallbackAttempts: number;
  lastStartedAt: number;
}

interface RecoveryRequest {
  fallback: boolean;
  reason: string;
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

function recoveryAttemptState(key?: string): RecoveryAttemptState {
  if (!key) {
    return { fallbackAttempts: 0, lastStartedAt: Number.NEGATIVE_INFINITY };
  }
  const store = globalBridgeStore();
  store[ATTEMPT_STATE_KEY] ??= new Map();
  const existing = store[ATTEMPT_STATE_KEY].get(key);
  if (existing) return existing;
  const state = {
    fallbackAttempts: 0,
    lastStartedAt: Number.NEGATIVE_INFINITY,
  };
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

export function createReactRouterRecoveryCoordinator(
  routeRoots: readonly string[],
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

  const schedulePending = () => {
    if (!pendingRequest || pendingTimer || disposed) return;
    const delay = Math.max(
      0,
      cooldownMs - (now() - attemptState.lastStartedAt),
    );
    pendingTimer = setTimer(() => {
      pendingTimer = undefined;
      const request = pendingRequest;
      pendingRequest = undefined;
      if (request) run(request);
    }, delay);
    pendingTimer.unref?.();
  };

  const run = (request: RecoveryRequest) => {
    if (disposed) return;
    running = true;
    if (request.fallback) attemptState.fallbackAttempts += 1;
    attemptState.lastStartedAt = now();
    void options
      .restart()
      .then(
        () =>
          options.onOutcome?.(
            `React Router route recovery completed: ${request.reason}`,
          ),
        (error) =>
          options.onOutcome?.(
            `React Router route recovery failed: ${request.reason}`,
            error,
          ),
      )
      .finally(() => {
        running = false;
        if (!pendingRequest || disposed) return;
        schedulePending();
      });
  };

  const request = (
    nextRequest: RecoveryRequest,
  ): ReactRouterRecoveryRequest => {
    if (disposed) return "bounded";
    if (
      nextRequest.fallback &&
      attemptState.fallbackAttempts >= maxConsecutiveAttempts
    ) {
      return "bounded";
    }
    if (running) {
      pendingRequest = pendingRequest
        ? {
            fallback: pendingRequest.fallback || nextRequest.fallback,
            reason: nextRequest.reason,
          }
        : nextRequest;
      return "pending";
    }
    if (now() - attemptState.lastStartedAt < cooldownMs) {
      pendingRequest = pendingRequest
        ? {
            fallback: pendingRequest.fallback || nextRequest.fallback,
            reason: nextRequest.reason,
          }
        : nextRequest;
      schedulePending();
      return "cooldown";
    }
    run(nextRequest);
    return "started";
  };

  return {
    routeRoots: routeRoots.map((root) => path.resolve(root)),
    requestFallback(reason) {
      return request({ fallback: true, reason });
    },
    requestTopology(reason) {
      return request({ fallback: false, reason });
    },
    markSsrSuccess() {
      attemptState.fallbackAttempts = 0;
    },
    dispose() {
      disposed = true;
      pendingRequest = undefined;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = undefined;
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

function isWithinRoot(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function classifyStaleReactRouterRouteError(
  error: unknown,
  routeRoots: readonly string[],
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
      if (!file) continue;
      if (!routeRoots.some((root) => isWithinRoot(file, path.resolve(root))))
        continue;
      if (fs.existsSync(file)) continue;
      return { file };
    }
  }
  return undefined;
}
