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
  request(reason: string): ReactRouterRecoveryRequest;
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
  attempts: number;
  lastStartedAt: number;
}

export interface ReactRouterRecoveryCoordinator extends ReactRouterDevRecoveryBridge {
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
    return { attempts: 0, lastStartedAt: Number.NEGATIVE_INFINITY };
  }
  const store = globalBridgeStore();
  store[ATTEMPT_STATE_KEY] ??= new Map();
  const existing = store[ATTEMPT_STATE_KEY].get(key);
  if (existing) return existing;
  const state = { attempts: 0, lastStartedAt: Number.NEGATIVE_INFINITY };
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
  let pendingReason: string | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const schedulePending = () => {
    if (!pendingReason || pendingTimer || disposed) return;
    const delay = Math.max(
      0,
      cooldownMs - (now() - attemptState.lastStartedAt),
    );
    pendingTimer = setTimer(() => {
      pendingTimer = undefined;
      const reason = pendingReason;
      pendingReason = undefined;
      if (reason) run(reason);
    }, delay);
    pendingTimer.unref?.();
  };

  const run = (reason: string) => {
    if (disposed || attemptState.attempts >= maxConsecutiveAttempts) return;
    running = true;
    attemptState.attempts += 1;
    attemptState.lastStartedAt = now();
    void options
      .restart()
      .then(
        () =>
          options.onOutcome?.(
            `React Router route recovery completed: ${reason}`,
          ),
        (error) =>
          options.onOutcome?.(
            `React Router route recovery failed: ${reason}`,
            error,
          ),
      )
      .finally(() => {
        running = false;
        if (!pendingReason || disposed) return;
        if (attemptState.attempts >= maxConsecutiveAttempts) {
          pendingReason = undefined;
          return;
        }
        schedulePending();
      });
  };

  return {
    routeRoots: routeRoots.map((root) => path.resolve(root)),
    request(reason) {
      if (disposed || attemptState.attempts >= maxConsecutiveAttempts) {
        return "bounded";
      }
      if (running) {
        pendingReason ??= reason;
        return "pending";
      }
      if (now() - attemptState.lastStartedAt < cooldownMs) {
        pendingReason ??= reason;
        schedulePending();
        return "cooldown";
      }
      run(reason);
      return "started";
    },
    markSsrSuccess() {
      attemptState.attempts = 0;
      attemptState.lastStartedAt = Number.NEGATIVE_INFINITY;
      pendingReason = undefined;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = undefined;
    },
    dispose() {
      disposed = true;
      pendingReason = undefined;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = undefined;
    },
  };
}

function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    chain.push(record);
    pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors);
  }
  return chain;
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
  for (const candidate of errorChain(error)) {
    if (candidate.code !== "ERR_LOAD_URL") continue;
    const context = [
      candidate.message,
      candidate.importer,
      candidate.plugin,
      candidate.id,
      candidate.url,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (!context.includes("virtual:react-router/server-build")) continue;
    const file = extractViteLoadUrlPath(candidate);
    if (!file) continue;
    if (!routeRoots.some((root) => isWithinRoot(file, path.resolve(root))))
      continue;
    if (fs.existsSync(file)) continue;
    return { file };
  }
  return undefined;
}
