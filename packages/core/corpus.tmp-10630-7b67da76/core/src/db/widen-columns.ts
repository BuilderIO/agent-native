/**
 * In-place widening of legacy 32-bit `integer` columns to 64-bit `BIGINT` on
 * Postgres.
 *
 * Lives in its own module (rather than `client.js`) so that stores can import
 * it without every `vi.mock("../db/client.js")` test needing to stub it: the
 * helper resolves `isPostgres()` / `getDbExec()` through `client.js`, so a test
 * that mocks the client to SQLite (`isPostgres: () => false`) makes this a
 * no-op automatically.
 */

import { isPostgres, getDbExec, type DbExec } from "./client.js";

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Widen pre-existing 32-bit `integer` columns to 64-bit `BIGINT` in place on
 * Postgres. No-op on SQLite, whose `INTEGER` is already 64-bit.
 *
 * Several stores historically created millisecond-timestamp columns (e.g.
 * `agent_runs.started_at`, `application_state.updated_at`) as a literal
 * `INTEGER`. On Postgres that is int4 (max 2,147,483,647), so a millisecond
 * epoch such as 1782269273204 overflows with:
 *   `value "1782269273204" is out of range for type integer`
 * The CREATE TABLE source was later switched to `intType()` (BIGINT on PG),
 * but `CREATE TABLE IF NOT EXISTS` cannot re-type a column that already
 * exists, so long-lived Neon databases keep the int4 column and every write
 * into it fails. (Migrations don't hit this — the migration runner rewrites
 * `INTEGER` → `BIGINT` for Postgres; only raw `ensureTable()` CREATE strings
 * that predate `intType()` are affected.)
 *
 * This widens such columns once, then no-ops: it only ALTERs columns whose
 * current type is `integer`, so already-bigint tables are never rewritten.
 * Widening int4 → int8 is additive and non-destructive (no data loss, no
 * narrowing), so it is safe to run unconditionally on every boot.
 *
 * Call from a store's `ensureTable()` right after its `CREATE TABLE IF NOT
 * EXISTS`, passing the millisecond-timestamp columns for that table. Pass the
 * UNQUALIFIED table name (the lookup is scoped to the `public` schema); the
 * `ALTER` resolves the table through the search path.
 */
export async function widenIntColumnsToBigInt(
  table: string,
  columns: string[],
  // Injectable for tests; production callers use the configured client.
  injectedClient?: DbExec,
): Promise<void> {
  if (!isPostgres() || columns.length === 0) return;
  if (!PLAIN_IDENTIFIER.test(table)) return;
  const client = injectedClient ?? getDbExec();
  let int4Columns: Set<string>;
  try {
    const { rows } = await client.execute({
      sql: `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? AND data_type = 'integer'`,
      args: [table],
    });
    int4Columns = new Set(rows.map((r) => String(r.column_name)));
  } catch {
    // information_schema unreadable (permissions / non-standard backend) —
    // skip silently and leave the pre-existing behaviour unchanged.
    return;
  }
  for (const col of columns) {
    if (!int4Columns.has(col) || !PLAIN_IDENTIFIER.test(col)) continue;
    try {
      await client.execute(
        `ALTER TABLE ${table} ALTER COLUMN ${col} TYPE BIGINT`,
      );
    } catch {
      // A concurrent boot already widened it, or the role lacks ALTER — both
      // are safe to ignore; a later boot retries if still needed.
    }
  }
}
