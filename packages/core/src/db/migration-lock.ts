import { createHash } from "node:crypto";

import { isNeonUrl } from "./create-get-db.js";

/**
 * Cross-process Postgres advisory lock around the shared framework migration
 * critical section (see `runFrameworkReleaseMigrations`).
 *
 * A workspace's apps each run their own `migrate:production` release job
 * against the SAME database, and every one of them applies the SAME
 * framework migrations (better-auth, org, oauth tokens, workspace
 * connections, ...). `withMigrationLock` in `./migrations.js` only ever
 * serialized migration runners inside one process - it does nothing when two
 * apps' release jobs run as separate processes, which is exactly what lets a
 * workspace parallelize `migrate:production` across apps. This adds the
 * missing cross-process half: a session-level `pg_advisory_lock` held on one
 * dedicated connection for the whole framework release batch, so two
 * processes pointed at the same database can never apply the same pending
 * migration - or race its bookkeeping insert - at the same time.
 *
 * Session lock, not `pg_advisory_xact_lock`: framework migrations run
 * statement-by-statement in autocommit (see `migrations.ts`), not inside one
 * wrapping transaction, so a transaction-scoped lock would release after the
 * very first statement instead of covering the whole run.
 *
 * A session lock only protects a connection that survives for the run's
 * duration. Neon's pooler (and any PgBouncer in transaction-pooling mode)
 * resets session state between statements, silently dropping the lock -
 * callers must pass `getMigrationDatabaseUrl()`, which already resolves to
 * the direct/unpooled endpoint for Neon. Other transaction-mode poolers (e.g.
 * Supabase's port-6543 pooler) need their own direct or session-mode URL
 * supplied as `DATABASE_URL_UNPOOLED`; this module has no way to detect that
 * on its own.
 */

const MIGRATION_LOCK_NAMESPACE = "agent-native:migrations";
const MIGRATION_LOCK_APPLICATION_NAME = "agent-native:migration-lock";

/**
 * Stable 64-bit signed key derived once from a fixed namespace - not from a
 * table name or connection URL - so every app that shares one database
 * contends on the exact same `pg_advisory_lock` key. Postgres advisory locks
 * are already scoped to the connected database, so a single fixed key is
 * enough: two apps pointed at different databases never collide, and two
 * apps pointed at the same one always do.
 */
export function migrationAdvisoryLockKey(): bigint {
  const digest = createHash("sha256").update(MIGRATION_LOCK_NAMESPACE).digest();
  const unsigned = digest.readBigUInt64BE(0);
  // pg_advisory_lock takes a signed bigint; fold the top half of the
  // unsigned hash into Postgres's two's-complement negative range.
  return unsigned >= 0x8000000000000000n
    ? unsigned - 0x10000000000000000n
    : unsigned;
}

interface AdvisoryLockConnection {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): Promise<void>;
}

async function openNeonAdvisoryLockConnection(
  url: string,
): Promise<AdvisoryLockConnection> {
  const { Client } = await import("@neondatabase/serverless");
  const client = new Client({
    connectionString: url,
    application_name: MIGRATION_LOCK_APPLICATION_NAME,
  });
  await client.connect();
  return {
    query: (sql) => client.query(sql),
    close: () => client.end(),
  };
}

async function openPostgresAdvisoryLockConnection(
  url: string,
): Promise<AdvisoryLockConnection> {
  const { default: postgres } = await import("postgres");
  // A dedicated single connection held for the whole migration run - do NOT
  // reuse `pgPoolOptions()`. Its serverless `idle_timeout` (20s) exists to let
  // an idle pool shed connections quickly, which would reap THIS connection
  // mid-migration and silently drop the session lock long before the run
  // finishes.
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: MIGRATION_LOCK_APPLICATION_NAME },
  });
  return {
    query: async (query) => ({ rows: Array.from(await sql.unsafe(query)) }),
    close: () => sql.end(),
  };
}

function openAdvisoryLockConnection(
  url: string,
): Promise<AdvisoryLockConnection> {
  return isNeonUrl(url)
    ? openNeonAdvisoryLockConnection(url)
    : openPostgresAdvisoryLockConnection(url);
}

function isPostgresUrl(url: string): boolean {
  return /^postgres(?:ql)?:\/\//i.test(url);
}

// Refcounted like `acquireMigrationExec`/`releaseMigrationExec` in
// `migrations.ts`: one dedicated connection per process, shared by however
// many nested or concurrent callers currently hold the lock, opened on the
// first acquire and closed once the last holder releases it. Module scope
// (not `globalThis`) is deliberate here - unlike the in-process mutex this
// backs a real, singly-held Postgres session, and this module is never
// duplicated across Vite module runners the way `migrations.ts` is.
let lockConnectionPromise: Promise<AdvisoryLockConnection> | null = null;
let lockRefCount = 0;

async function acquireMigrationAdvisoryLock(url: string): Promise<void> {
  lockRefCount++;
  if (!lockConnectionPromise) {
    const key = migrationAdvisoryLockKey().toString();
    lockConnectionPromise = openAdvisoryLockConnection(url).then(
      async (conn) => {
        try {
          await conn.query(`SELECT pg_advisory_lock(${key})`);
        } catch (err) {
          await conn.close().catch(() => {});
          throw err;
        }
        return conn;
      },
    );
    lockConnectionPromise.catch(() => {
      lockConnectionPromise = null;
      lockRefCount = 0;
    });
  }
  try {
    await lockConnectionPromise;
  } catch (err) {
    throw new Error(
      `Failed to acquire the cross-process migration lock: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}

async function releaseMigrationAdvisoryLock(): Promise<void> {
  lockRefCount = Math.max(0, lockRefCount - 1);
  if (lockRefCount > 0) return;
  const pending = lockConnectionPromise;
  lockConnectionPromise = null;
  if (!pending) return;
  const conn = await pending;
  const key = migrationAdvisoryLockKey().toString();
  try {
    const { rows } = await conn.query(
      `SELECT pg_advisory_unlock(${key}) AS unlocked`,
    );
    if (rows[0]?.unlocked !== true) {
      throw new Error(
        "pg_advisory_unlock reported the migration lock was not held by " +
          "this session. The connection was likely recycled by a pooler " +
          "mid-migration, which means the run may not have been protected.",
      );
    }
  } finally {
    await conn.close();
  }
}

/**
 * Run `run()` while holding the cross-process migration advisory lock.
 *
 * No-op for non-Postgres URLs (PGlite keeps its own process/directory lock,
 * see `client.ts`). Acquire failures reject before `run()` is ever called -
 * this never falls back to running unlocked. A release failure (including an
 * unlock that reports the lock was already lost) always surfaces: on the
 * success path it rejects the call; if `run()` itself threw, the release
 * failure is logged instead of replacing that original error.
 */
export async function withMigrationAdvisoryLock<T>(
  url: string,
  run: () => Promise<T>,
): Promise<T> {
  if (!isPostgresUrl(url)) return run();

  await acquireMigrationAdvisoryLock(url);
  let result: T;
  try {
    result = await run();
  } catch (err) {
    await releaseMigrationAdvisoryLock().catch((releaseErr) => {
      console.error(
        "[db] Failed to release the migration advisory lock after a migration error:",
        releaseErr,
      );
    });
    throw err;
  }
  await releaseMigrationAdvisoryLock();
  return result;
}
