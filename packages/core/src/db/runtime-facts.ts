import { getAsyncLocalStorageCtor } from "../shared/optional-node-builtins.js";

/**
 * Dependency-free database runtime facts. Kept out of `./client.js` so the
 * store runner does not require every `vi.mock("../db/client.js")` to stub them.
 */

export async function retryOnDdlRace<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (!isPgCatalogRace(e)) throw e;
    return await fn();
  }
}

function isPgCatalogRace(e: any): boolean {
  const msg = String(e?.message ?? "");
  if (e?.code === "42P07") return true;
  if (e?.code === "42710") {
    const routine = String(e?.routine ?? "");
    return routine === "TypeCreate" || /type .* already exists/i.test(msg);
  }
  if (e?.code !== "23505") return false;
  const constraint = String(e?.constraint_name ?? e?.constraint ?? "");
  const detail = String(e?.detail ?? "");
  return (
    constraint.startsWith("pg_type") ||
    constraint.startsWith("pg_class") ||
    detail.includes("pg_type") ||
    detail.includes("pg_class") ||
    /relation .* already exists/i.test(msg)
  );
}

/**
 * Bumped by `closeDbExec()` and dev reloads. State cached per database (schema
 * snapshots, store readiness) compares against it instead of importing the
 * client, so modules that mock `./client.js` keep working.
 */
export function dbClientGeneration(): number {
  const proc = (globalThis as { process?: unknown }).process as
    | { __agentNativePgliteClientGeneration?: number }
    | undefined;
  return proc?.__agentNativePgliteClientGeneration ?? 0;
}

const AsyncLocalStorageCtor = getAsyncLocalStorageCtor();
const recordingStoreMigration = AsyncLocalStorageCtor
  ? new AsyncLocalStorageCtor<true>()
  : undefined;

/**
 * True while a store migration runs that the ledger will record once it
 * resolves. Helpers that swallow failures elsewhere must rethrow here, or the
 * ledger records a step that never happened and never retries it.
 */
export function isRecordingStoreMigration(): boolean {
  return recordingStoreMigration?.getStore() === true;
}

export function runRecordingStoreMigration<T>(
  run: () => Promise<T>,
): Promise<T> {
  return recordingStoreMigration
    ? recordingStoreMigration.run(true, run)
    : run();
}
