import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseOperationKind = "connect" | "query";

export interface DatabaseRequestTelemetry {
  operationCount: number;
  queryCount: number;
  connectCount: number;
  retryCount: number;
  errorCount: number;
  timeoutCount: number;
  operationTotalMs: number;
  operationWallMs: number;
  queryTotalMs: number;
  connectTotalMs: number;
  slowestOperationMs: number;
  activeOperationCount: number;
  activeWindowStartedAt?: number;
}

const STORAGE_KEY = Symbol.for(
  "@agent-native/core/db.request-telemetry-storage",
);
const STARTUP_STATE_KEY = Symbol.for(
  "@agent-native/core/db.startup-telemetry-state",
);
const STARTUP_CAPTURE_WINDOW_MS = 120_000;
interface StartupDatabaseTelemetryState {
  captureUntil: number;
  claimed: boolean;
  telemetry: DatabaseRequestTelemetry;
}
type GlobalWithDatabaseTelemetry = typeof globalThis & {
  [STORAGE_KEY]?: AsyncLocalStorage<DatabaseRequestTelemetry>;
  [STARTUP_STATE_KEY]?: StartupDatabaseTelemetryState;
};

const globalRef = globalThis as GlobalWithDatabaseTelemetry;
const storage =
  globalRef[STORAGE_KEY] ??
  (globalRef[STORAGE_KEY] = new AsyncLocalStorage<DatabaseRequestTelemetry>());

export function createDatabaseRequestTelemetry(): DatabaseRequestTelemetry {
  return {
    operationCount: 0,
    queryCount: 0,
    connectCount: 0,
    retryCount: 0,
    errorCount: 0,
    timeoutCount: 0,
    operationTotalMs: 0,
    operationWallMs: 0,
    queryTotalMs: 0,
    connectTotalMs: 0,
    slowestOperationMs: 0,
    activeOperationCount: 0,
  };
}

const startupState =
  globalRef[STARTUP_STATE_KEY] ??
  (globalRef[STARTUP_STATE_KEY] = {
    captureUntil: Date.now() + STARTUP_CAPTURE_WINDOW_MS,
    claimed: false,
    telemetry: createDatabaseRequestTelemetry(),
  });

function currentDatabaseTelemetry(): DatabaseRequestTelemetry | undefined {
  const requestTelemetry = storage.getStore();
  if (requestTelemetry) return requestTelemetry;
  if (!startupState.claimed && Date.now() <= startupState.captureUntil) {
    return startupState.telemetry;
  }
  return undefined;
}

export function claimStartupDatabaseTelemetry():
  | DatabaseRequestTelemetry
  | undefined {
  if (startupState.claimed) return undefined;
  startupState.claimed = true;
  return startupState.telemetry;
}

export function runWithDatabaseRequestTelemetry<T>(
  telemetry: DatabaseRequestTelemetry,
  fn: () => T,
): T {
  return storage.run(telemetry, fn);
}

export function enterDatabaseRequestTelemetry(
  telemetry: DatabaseRequestTelemetry,
): void {
  storage.enterWith(telemetry);
}

export function beginDatabaseOperation(
  operation: DatabaseOperationKind,
): (outcome: "success" | "error" | "timeout") => void {
  const telemetry = currentDatabaseTelemetry();
  if (!telemetry) return () => {};

  const startedAt = Date.now();
  if (telemetry.activeOperationCount === 0) {
    telemetry.activeWindowStartedAt = startedAt;
  }
  telemetry.activeOperationCount += 1;
  let completed = false;

  return (outcome) => {
    if (completed) return;
    completed = true;
    const completedAt = Date.now();
    const duration = Math.max(0, completedAt - startedAt);
    telemetry.operationCount += 1;
    telemetry.operationTotalMs += duration;
    telemetry.slowestOperationMs = Math.max(
      telemetry.slowestOperationMs,
      duration,
    );

    if (operation === "connect") {
      telemetry.connectCount += 1;
      telemetry.connectTotalMs += duration;
    } else {
      telemetry.queryCount += 1;
      telemetry.queryTotalMs += duration;
    }

    if (outcome !== "success") telemetry.errorCount += 1;
    if (outcome === "timeout") telemetry.timeoutCount += 1;

    telemetry.activeOperationCount = Math.max(
      0,
      telemetry.activeOperationCount - 1,
    );
    if (
      telemetry.activeOperationCount === 0 &&
      telemetry.activeWindowStartedAt !== undefined
    ) {
      telemetry.operationWallMs += Math.max(
        0,
        completedAt - telemetry.activeWindowStartedAt,
      );
      telemetry.activeWindowStartedAt = undefined;
    }
  };
}

export function recordDatabaseRetry(): void {
  const telemetry = currentDatabaseTelemetry();
  if (telemetry) telemetry.retryCount += 1;
}
