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

/**
 * A runtime that is ALLOWED to migrate: release scripts, scheduled jobs, and
 * durable background workers, which are off the request path and may take as
 * long as they need. Claimed with {@link withMigrationRuntime}.
 */
export function isMigrationAuthorizedRuntime(): boolean {
  return (
    (globalThis as MigrationRuntimeGlobal)
      .__AGENT_NATIVE_MIGRATION_RUNTIME__ === true
  );
}

/**
 * Run an explicit release-time migration job with migration duty enabled.
 *
 * The flag is process-local and restored even when the job fails, so a build
 * step can opt in without creating a permanent escape hatch for request code.
 */
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
