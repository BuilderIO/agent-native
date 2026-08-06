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
 * Skip on-demand schema DDL entirely. For deployments that run real migrations,
 * where the probe → DDL machinery below is pure cold-start latency.
 *
 * Implemented at the PROBE layer, not per store: every `ensureTable()` in the
 * codebase reaches the database through these three helpers, and there are ~390
 * call sites across ~57 stores. Reporting "present" here makes
 * `ensureSchemaObject` a no-op without touching any of them.
 *
 * This does not fail closed, and cannot: the only honest signal that schema is
 * missing is the real query failing, which it will, loudly, at the first read.
 * Silently reporting "absent" instead would be worse — it would send every store
 * down the DDL path this flag exists to avoid.
 */
function schemaEnsureDisabled(): boolean {
  const raw = process.env.AGENT_NATIVE_SKIP_ENSURE_TABLES?.trim();
  return !!raw && ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

/**
 * One introspection pass per database, instead of one probe per object.
 *
 * `ensureTable()` fans out to N probes on a store's first DB touch, and on
 * serverless "first touch" is EVERY cold start. Across ~390 probe sites that is
 * up to ~390 serial round trips before any real work, on the critical path of a
 * user request. Production showed 608k of them. Two queries build the whole
 * picture instead.
 *
 * ## Keyed per client, never process-globally
 *
 * `pgTableExists`/`pgIndexExists` accept an `injectedClient` because the hosted
 * multi-app gateway probes a DIFFERENT app's Postgres database from a process
 * whose own global DB may be absent or SQLite. A single shared `Set` would
 * answer one app's probe with another app's schema — a correctness bug, not a
 * perf regression. The global singleton gets its own slot; injected clients are
 * keyed on the client object itself.
 */
type SchemaSnapshot = {
  tables: Set<string>;
  /** `table.column`, lowercased. */
  columns: Set<string>;
  indexes: Set<string>;
};

const injectedSnapshots = new WeakMap<DbExec, Promise<SchemaSnapshot | null>>();
let globalSnapshot: Promise<SchemaSnapshot | null> | undefined;

/**
 * Drop the cached picture after any successful DDL, so a freshly created object
 * is visible to the next probe rather than reported absent for the life of the
 * process.
 */
export function invalidateSchemaSnapshot(injectedClient?: DbExec): void {
  // The global snapshot always goes: a store may create an object through an
  // injected client and later probe through the global one (or the reverse), so
  // after DDL neither picture is trustworthy and both are cheap to rebuild.
  globalSnapshot = undefined;
  if (injectedClient) injectedSnapshots.delete(injectedClient);
}

/** Test seam — the snapshots are module state, so suites must clear them. */
export function __resetSchemaSnapshotForTests(): void {
  globalSnapshot = undefined;
}

async function loadSchemaSnapshot(
  client: DbExec,
): Promise<SchemaSnapshot | null> {
  try {
    const [columnRows, indexRows] = await Promise.all([
      client.execute(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
      ),
      client.execute(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      ),
    ]);
    // An EMPTY result is a valid snapshot (a fresh database really has nothing
    // in `public`). A result whose rows lack the columns we asked for is not —
    // it means something other than Postgres answered, and treating it as "these
    // are the objects that exist" would report every table absent and send every
    // store down the DDL path. Fall back to per-object probes instead.
    const columnData = columnRows.rows as Record<string, unknown>[];
    const indexData = indexRows.rows as Record<string, unknown>[];
    if (columnData.length > 0 && !("table_name" in columnData[0])) return null;
    if (indexData.length > 0 && !("indexname" in indexData[0])) return null;

    const tables = new Set<string>();
    const columns = new Set<string>();
    for (const row of columnData) {
      const table = String(row.table_name ?? "").toLowerCase();
      const column = String(row.column_name ?? "").toLowerCase();
      if (!table) continue;
      tables.add(table);
      if (column) columns.add(`${table}.${column}`);
    }
    const indexes = new Set<string>();
    for (const row of indexData) {
      const name = String(row.indexname ?? "").toLowerCase();
      if (name) indexes.add(name);
    }
    return { tables, columns, indexes };
  } catch (err) {
    // `information_schema` unreadable (permissions / non-standard backend).
    // `null` is a typed "no snapshot" the caller tells apart from an empty one:
    // each probe falls back to its original per-object query. It does NOT mean
    // "the schema is empty", which would make every store issue DDL it does not
    // need. Say so once — the fallback is correct but costs a few hundred round
    // trips per cold start, which is invisible otherwise.
    warnIntrospectionUnavailableOnce(err);
    return null;
  }
}

let _warnedIntrospectionUnavailable = false;

function warnIntrospectionUnavailableOnce(err: unknown): void {
  if (_warnedIntrospectionUnavailable) return;
  _warnedIntrospectionUnavailable = true;
  console.warn(
    "[db] batched schema introspection unavailable; falling back to one probe " +
      "per table/column/index (slower cold starts, same behaviour): " +
      ((err as Error)?.message ?? err),
  );
}

// `loadSchemaSnapshot` resolves to `null` on failure rather than rejecting, so
// these need no `.catch()` — adding one would be dead code hiding that contract.
function schemaSnapshot(client: DbExec, injected: boolean) {
  if (injected) {
    let pending = injectedSnapshots.get(client);
    if (!pending) {
      pending = loadSchemaSnapshot(client);
      injectedSnapshots.set(client, pending);
    }
    return pending;
  }
  if (!globalSnapshot) {
    globalSnapshot = loadSchemaSnapshot(client);
  }
  return globalSnapshot;
}

/**
 * `true`/`false` from the cached picture, or `undefined` when there is no usable
 * snapshot and the caller must fall back to its own single-object probe.
 *
 * A snapshot MISS is authoritative: the snapshot lists every object in `public`,
 * so "not in the set" means the object really is absent and the caller should
 * proceed to DDL. That is what makes this a replacement for the per-object
 * probe rather than a layer in front of it.
 */
async function snapshotHas(
  kind: "table" | "column" | "index",
  key: string,
  client: DbExec,
  injected: boolean,
): Promise<boolean | undefined> {
  const snapshot = await schemaSnapshot(client, injected);
  if (!snapshot) return undefined;
  const set =
    kind === "table"
      ? snapshot.tables
      : kind === "column"
        ? snapshot.columns
        : snapshot.indexes;
  return set.has(key.toLowerCase());
}

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
  dialectIsPostgres?: boolean,
): Promise<boolean> {
  // The dialect override travels with an injected client: a multi-app process
  // (the hosted Realtime Gateway) probes a per-app Postgres DB even when its
  // own process-global DB is absent or SQLite.
  if (!(dialectIsPostgres ?? isPostgres()) || !PLAIN_IDENTIFIER.test(table)) {
    return false;
  }
  if (schemaEnsureDisabled()) return true;
  const client = injectedClient ?? getDbExec();
  const cached = await snapshotHas("table", table, client, !!injectedClient);
  if (cached !== undefined) return cached;
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
  if (schemaEnsureDisabled()) return true;
  const client = injectedClient ?? getDbExec();
  const cached = await snapshotHas(
    "column",
    `${table}.${column}`,
    client,
    !!injectedClient,
  );
  if (cached !== undefined) return cached;
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
  dialectIsPostgres?: boolean,
): Promise<boolean> {
  if (
    !(dialectIsPostgres ?? isPostgres()) ||
    !PLAIN_IDENTIFIER.test(indexName)
  ) {
    return false;
  }
  if (schemaEnsureDisabled()) return true;
  const client = injectedClient ?? getDbExec();
  const cached = await snapshotHas(
    "index",
    indexName,
    client,
    !!injectedClient,
  );
  if (cached !== undefined) return cached;
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

/**
 * Probe → guarded-DDL → re-probe sequence for one piece of on-demand schema.
 *
 * This is the single safe primitive every `ensureTable()` should use so a
 * swallowed `lock_timeout` can NEVER poison a store's init memo with missing
 * schema. The flow:
 *
 *   1. `probe()` — cheap, lock-free existence check (pgTableExists / etc.).
 *      Already present → return `false` (nothing to do; the hot path takes NO
 *      lock).
 *   2. Missing → run `ddl` through `runGuardedDdl` (bounded `lock_timeout`).
 *      - DDL completed → return `true`.
 *      - DDL was swallowed by a lock-timeout (`runGuardedDdl` returned `false`)
 *        → RE-PROBE. A concurrent connection virtually always created the
 *        object meanwhile, so the re-probe usually now reports it present →
 *        return `true`. But if it is STILL missing, the required schema does
 *        NOT exist and we must NOT let the caller memoize success — so THROW.
 *        The caller's `_initPromise` rejects and the next call retries instead
 *        of running forever against absent schema.
 *
 * On SQLite the probe is always `false` (helpers no-op there) and the SQLite
 * branch of each store keeps its own create-then-catch behaviour, so this is a
 * Postgres-path primitive in practice. Returns `true` when the object exists
 * after this call (either pre-existing-after-timeout-race or freshly created),
 * `false` only when it already existed up front (no DDL issued).
 */
export async function ensureSchemaObject(options: {
  /** Lock-free existence check; `true` ⇒ already present, skip DDL. */
  probe: () => Promise<boolean>;
  /** DDL to run only when `probe()` reports the object missing. */
  ddl: string;
  /** Human-readable name of what's being ensured, for the error message. */
  label: string;
  /** Forwarded to `runGuardedDdl`. */
  lockTimeout?: string;
  /** Injectable client for tests. */
  injectedClient?: DbExec;
  /** Dialect override for injected per-app clients; defaults to the global. */
  dialectIsPostgres?: boolean;
}): Promise<boolean> {
  const { probe, ddl, label, lockTimeout, injectedClient, dialectIsPostgres } =
    options;
  if (await probe()) return false;
  const ran = await runGuardedDdl(ddl, {
    lockTimeout,
    injectedClient,
    dialectIsPostgres,
  });
  // The cached picture predates this object. Drop it before anyone probes again,
  // or a sibling `ensureTable` in the same boot is told the object it just
  // created does not exist.
  invalidateSchemaSnapshot(injectedClient);
  if (ran) return true;
  // The DDL was swallowed by a lock-timeout. The object is virtually always
  // already correct by the time a contended boot retries (a concurrent
  // connection created it), so re-probe before giving up.
  if (await probe()) return true;
  // Still missing after a swallowed timeout: do NOT memoize success with absent
  // schema. Throw so the caller's init promise rejects and the next call
  // retries, rather than leaving ensureTable "initialized" against a table/
  // column/index that does not exist.
  throw new Error(
    `ensureSchemaObject: required schema "${label}" is still missing after a ` +
      `lock-timed-out DDL; refusing to memoize init success. The next call will retry.`,
  );
}

/**
 * Convenience wrapper: ensure a TABLE exists (probe via `pgTableExists`).
 * No-op-returns `false` on SQLite (probe is always false there) — callers run
 * the SQLite create on their own branch, so this is used on the Postgres path.
 */
export async function ensureTableExists(
  table: string,
  createSql: string,
  options: {
    lockTimeout?: string;
    injectedClient?: DbExec;
    dialectIsPostgres?: boolean;
  } = {},
): Promise<boolean> {
  return ensureSchemaObject({
    probe: () =>
      pgTableExists(table, options.injectedClient, options.dialectIsPostgres),
    ddl: createSql,
    label: `table ${table}`,
    lockTimeout: options.lockTimeout,
    injectedClient: options.injectedClient,
    dialectIsPostgres: options.dialectIsPostgres,
  });
}

/**
 * Convenience wrapper: ensure a COLUMN exists (probe via `pgColumnExists`).
 * `addColumnSql` should be the full `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`.
 */
export async function ensureColumnExists(
  table: string,
  column: string,
  addColumnSql: string,
  options: { lockTimeout?: string; injectedClient?: DbExec } = {},
): Promise<boolean> {
  return ensureSchemaObject({
    probe: () => pgColumnExists(table, column, options.injectedClient),
    ddl: addColumnSql,
    label: `column ${table}.${column}`,
    lockTimeout: options.lockTimeout,
    injectedClient: options.injectedClient,
  });
}

/**
 * Convenience wrapper: ensure an INDEX exists (probe via `pgIndexExists`).
 * `createIndexSql` should be the full `CREATE INDEX IF NOT EXISTS <name> …`.
 */
export async function ensureIndexExists(
  indexName: string,
  createIndexSql: string,
  options: {
    lockTimeout?: string;
    injectedClient?: DbExec;
    dialectIsPostgres?: boolean;
  } = {},
): Promise<boolean> {
  return ensureSchemaObject({
    probe: () =>
      pgIndexExists(
        indexName,
        options.injectedClient,
        options.dialectIsPostgres,
      ),
    ddl: createIndexSql,
    label: `index ${indexName}`,
    lockTimeout: options.lockTimeout,
    injectedClient: options.injectedClient,
    dialectIsPostgres: options.dialectIsPostgres,
  });
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
  options: {
    lockTimeout?: string;
    idleInTransactionTimeout?: string;
    injectedClient?: DbExec;
    dialectIsPostgres?: boolean;
  } = {},
): Promise<boolean> {
  const client = options.injectedClient ?? getDbExec();
  if (!(options.dialectIsPostgres ?? isPostgres())) {
    await client.execute(ddl);
    return true;
  }

  const lockTimeout = options.lockTimeout ?? "3s";
  // Comfortably longer than any DDL this guard runs (it only ever executes
  // statements already probed as necessary), so it can only fire on a
  // transaction nobody is driving any more.
  const idleInTransactionTimeout = options.idleInTransactionTimeout ?? "30s";
  try {
    if (typeof client.transaction === "function") {
      await client.transaction(async (tx) => {
        // SET LOCAL is transaction-scoped: it reverts on COMMIT/ROLLBACK and
        // never persists on the pooled connection.
        await tx.execute(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        // A serverless worker that is killed mid-transaction — OOM, function
        // wall, cold-start reap — never reaches COMMIT or ROLLBACK, and the
        // pooled connection goes back to the pool still inside this
        // transaction, holding its locks until something reaps it. Nothing
        // does. Measured in production: 11 sessions stuck `idle in
        // transaction` for up to 283s, every one of them last executing the
        // SET LOCAL above, while ordinary queries on that database went from
        // ~1.5s to 5-7s. Postgres reaps these itself when told to, and the
        // timeout is the only part of this that survives the process dying.
        await tx.execute(
          `SET LOCAL idle_in_transaction_session_timeout = '${idleInTransactionTimeout}'`,
        );
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
