import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Thrown when code running inside a transaction asks for a connection from the
 * pool whose only connection that transaction already holds. Waiting can never
 * succeed, so the caller gets this immediately instead of after every acquire
 * timeout and retry. It is deliberately not a connection error: retrying a
 * deadlock only repeats it.
 */
export class DbPoolSelfDeadlockError extends Error {
  readonly code = "DB_POOL_SELF_DEADLOCK";

  constructor(operation: string) {
    super(
      `${operation} needs a database connection, but the pool has exactly one ` +
        "and the transaction this code is running inside already holds it. " +
        "Run the query on the transaction handle, or after the transaction commits.",
    );
    this.name = "DbPoolSelfDeadlockError";
  }
}

const heldPools = new AsyncLocalStorage<ReadonlySet<object>>();

/** Marks `run`, and everything it awaits, as holding `pool`'s connection. */
export function runHoldingPoolConnection<T>(
  pool: object | undefined,
  run: () => T,
): T {
  if (!pool) return run();
  return heldPools.run(new Set([...(heldPools.getStore() ?? []), pool]), run);
}

function hasSingleConnection(pool: object): boolean {
  const max = (pool as { options?: { max?: unknown } }).options?.max;
  return max === 1;
}

/**
 * TRAP: only a pool that provably has one connection can deadlock itself. A
 * pool whose size is unreadable is left to the acquire timeout rather than
 * failed on a guess.
 */
export function assertPoolConnectionAvailable(
  pool: object,
  operation: string,
): void {
  if (!heldPools.getStore()?.has(pool)) return;
  if (!hasSingleConnection(pool)) return;
  throw new DbPoolSelfDeadlockError(operation);
}
