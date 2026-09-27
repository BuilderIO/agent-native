/**
 * Migration duty: the process-local claim that the current call is allowed to
 * create or alter schema.
 *
 * Its own module, and deliberately dependency-free, because both `./client.js`
 * and `./ddl-guard.js` need to read it. Putting the reader on `client.js` would
 * mean every `vi.mock("../db/client.js")` in the codebase has to stub one more
 * export to keep `ensureTable()` working — the exact coupling `ddl-guard.ts`
 * was split out to avoid.
 */

type MigrationRuntimeGlobal = typeof globalThis & {
  __AGENT_NATIVE_MIGRATION_RUNTIME__?: boolean;
};

export function isMigrationAuthorizedRuntime(): boolean {
  return (
    (globalThis as MigrationRuntimeGlobal)
      .__AGENT_NATIVE_MIGRATION_RUNTIME__ === true
  );
}

export async function withMigrationRuntime<T>(
  run: () => Promise<T>,
): Promise<T> {
  const runtime = globalThis as MigrationRuntimeGlobal;
  const previous = runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__;
  runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__ = true;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__;
    } else {
      runtime.__AGENT_NATIVE_MIGRATION_RUNTIME__ = previous;
    }
  }
}
