/**
 * Guards for on-demand `ensureTable()` DDL so the common already-migrated path
 * takes NO `ACCESS EXCLUSIVE` lock on Postgres.
 *
 * Lives in its own module (like `./widen-columns.js`) so stores can import it
 * without every `vi.mock("../db/client.js")` test needing to stub it: the
 * helpers resolve `isPostgres()` / `getDbExec()` through `client.js`, so a test
 * that mocks the client to SQLite (`isPostgres: () => false`) makes the
 * Postgres-only existence checks no-ops automatically.
 *
 * ## Why
 *
 * `ensureTable()` runs once per process on first DB touch. In a long-lived Node
 * server the cost is paid once and is invisible. In a Netlify `-background`
 * function the process is fresh, so this is the FIRST touch — and the
 * `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN` DDL it issues takes an
 * `ACCESS EXCLUSIVE` lock on the shared Neon Postgres database. Behind a
 * concurrent connection that already holds a conflicting lock, that DDL can
 * block ~indefinitely (observed >16s hangs in the bg worker vs ~1s inline).
 *
 * The tables/columns are essentially always already present in production, so
 * the DDL is redundant in the hot path. These helpers let a store cheaply check
 * `information_schema` first and only issue DDL when something is actually
 * missing — and when DDL must run, wrap it in a short `lock_timeout` so a
 * contended lock fails fast instead of hanging.
 *
 * All of this is Postgres-only behaviour gated on `isPostgres()`. On SQLite
 * (local dev) there is no such lock problem, so callers keep their existing
 * behaviour there.
 */

import { isPostgres, getDbExec, type DbExec } from "./client.js";

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * True when running against Postgres AND the given table already exists in the
 * `public` schema. Returns `false` on SQLite (callers gate their own behaviour
 * there), for invalid identifiers, or when `information_schema` is unreadable —
 * the conservative answer "not known to exist" makes the caller fall through to
 * its idempotent `CREATE TABLE IF NOT EXISTS`, preserving today's behaviour.
 *
 * This is a plain read (no lock), so it never blocks on an `ACCESS EXCLUSIVE`
 * lock the way `CREATE`/`ALTER` would.
 */
export async function pgTableExists(
  table: string,
  injectedClient?: DbExec,
): Promise<boolean> {
  if (!isPostgres() || !PLAIN_IDENTIFIER.test(table)) return false;
  const client = injectedClient ?? getDbExec();
  try {
    const { rows } = await client.execute({
      sql: `SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ? LIMIT 1`,
      args: [table],
    });
    return rows.length > 0;
  } catch {
    // information_schema unreadable (permissions / non-standard backend) —
    // report "unknown" so the caller falls back to IF NOT EXISTS.
    return false;
  }
}

/**
 * True when running against Postgres AND the given column already exists on the
 * given table in the `public` schema. Returns `false` on SQLite, for invalid
 * identifiers, or when `information_schema` is unreadable.
 *
 * Plain read — no lock taken.
 */
export async function pgColumnExists(
  table: string,
  column: string,
  injectedClient?: DbExec,
): Promise<boolean> {
  if (!isPostgres()) return false;
  if (!PLAIN_IDENTIFIER.test(table) || !PLAIN_IDENTIFIER.test(column)) {
    return false;
  }
  const client = injectedClient ?? getDbExec();
  try {
    const { rows } = await client.execute({
      sql: `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
            LIMIT 1`,
      args: [table, column],
    });
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * True when running against Postgres AND an index with the given name already
 * exists in the `public` schema. Returns `false` on SQLite, for invalid
 * identifiers, or when `pg_indexes` is unreadable.
 *
 * `CREATE INDEX` (without CONCURRENTLY) takes a `SHARE` lock that blocks
 * writes, so on a fresh background-worker process behind a concurrent
 * connection this can hang just like a `CREATE`/`ALTER` would; checking first
 * skips the lock on the already-migrated hot path.
 */
export async function pgIndexExists(
  indexName: string,
  injectedClient?: DbExec,
): Promise<boolean> {
  if (!isPostgres() || !PLAIN_IDENTIFIER.test(indexName)) return false;
  const client = injectedClient ?? getDbExec();
  try {
    const { rows } = await client.execute({
      sql: `SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = ? LIMIT 1`,
      args: [indexName],
    });
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** True when an error looks like a Postgres `lock_timeout` (SQLSTATE 55P03). */
export function isLockTimeoutError(err: unknown): boolean {
  const anyErr = err as { code?: unknown; message?: unknown } | null;
  if (anyErr?.code === "55P03") return true;
  const msg = String(anyErr?.message ?? anyErr ?? "");
  return /lock[_ ]?timeout|canceling statement due to lock timeout/i.test(msg);
}

/**
 * Run a DDL statement that MUST execute (the schema is actually missing), with
 * a short `lock_timeout` so a contended `ACCESS EXCLUSIVE` lock fails fast
 * instead of hanging the whole process.
 *
 * Postgres path: wrap the DDL in an explicit transaction and set
 * `SET LOCAL lock_timeout` so the timeout is scoped to THIS transaction only
 * and reset automatically on COMMIT/ROLLBACK — it never leaks onto the pooled
 * (session-reused) connection the way a bare `SET lock_timeout` would. If the
 * DbExec has no `transaction` (shouldn't happen for Postgres, but defensively),
 * fall back to a session `SET` + `RESET` in a finally. A lock-timeout error is
 * swallowed: the table/column is virtually always already correct by the time a
 * contended boot retries, and the caller's memoization should still resolve so
 * the path isn't retried in a tight loop. Any non-lock-timeout error rethrows.
 *
 * SQLite path: no lock problem — just run the DDL directly.
 *
 * @returns `true` if the DDL ran to completion, `false` if it was skipped due to
 *          a lock-timeout (so the caller can decide whether to log).
 */
export async function runGuardedDdl(
  ddl: string,
  options: { lockTimeout?: string; injectedClient?: DbExec } = {},
): Promise<boolean> {
  const client = options.injectedClient ?? getDbExec();
  if (!isPostgres()) {
    await client.execute(ddl);
    return true;
  }

  const lockTimeout = options.lockTimeout ?? "3s";
  try {
    if (typeof client.transaction === "function") {
      await client.transaction(async (tx) => {
        // SET LOCAL is transaction-scoped: it reverts on COMMIT/ROLLBACK and
        // never persists on the pooled connection.
        await tx.execute(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        await tx.execute(ddl);
      });
    } else {
      // Defensive fallback: no transaction support. Use a session SET and
      // guarantee a RESET so the timeout never leaks onto a reused connection.
      try {
        await client.execute(`SET lock_timeout = '${lockTimeout}'`);
        await client.execute(ddl);
      } finally {
        await client.execute(`RESET lock_timeout`).catch(() => {});
      }
    }
    return true;
  } catch (err) {
    if (isLockTimeoutError(err)) {
      // Contended lock — the schema is virtually always already correct by now.
      // Proceed; the caller's memoization still resolves so we don't loop.
      return false;
    }
    throw err;
  }
}
