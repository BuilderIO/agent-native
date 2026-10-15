/**
 * The single entry point for framework-owned schema.
 *
 * A store declares its tables as an ordered list of named migrations with
 * `defineStore()`. The release step applies them once per database and records
 * each in `_an_store_migrations`; request runtimes that do not own the schema
 * only verify that ledger — one query per process, shared by every store — and
 * never issue DDL. See docs/plans/2026-09-28-store-registry-schema-ownership.md.
 *
 * Stores are discovered by `scripts/gen-store-registry.ts`, which writes the
 * explicit import list in `store-registry.generated.ts`. Registration is never a
 * module side effect: `package.json#sideEffects` lets a bundler drop an import
 * kept only for that.
 */

import { getAsyncLocalStorageCtor } from "../shared/optional-node-builtins.js";
import { getDbExec, type DbExec } from "./client.js";
import {
  appMigratesAtRelease,
  schemaEnsureSkipRequested,
} from "./migration-policy.js";
import {
  isHostedFunctionInvocationRuntime,
  isMigrationAuthorizedRuntime,
  isProductionServerlessFunctionRuntime,
  withMigrationExecutionRuntime,
} from "./migration-runtime.js";
import { retainRequestDbPoolScope } from "./request-pool-context.js";
import { dbClientGeneration, retryOnDdlRace } from "./runtime-facts.js";

export const STORE_MIGRATIONS_TABLE = "_an_store_migrations";

// checksum, kind, source and core_version are written now because Phase 2
// (snapshot installs, checksum enforcement) needs them for rows that already
// exist; they cannot be backfilled later.
const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${STORE_MIGRATIONS_TABLE} (
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  applied_at BIGINT NOT NULL,
  checksum TEXT,
  kind TEXT,
  source TEXT,
  core_version TEXT,
  PRIMARY KEY (store_id, name)
)`;

const STORE_ID = /^[a-z][a-z0-9_]*$/;
const MIGRATION_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export interface StoreMigration {
  /** Stable, never renamed: the ledger records it. */
  readonly name: string;
  /**
   * `data` for backfills and seeds. A schema snapshot cannot stand in for a
   * data migration, so Phase 2 snapshot installs still run these.
   */
  readonly kind?: "schema" | "data";
  readonly sql?: string | readonly string[];
  readonly run?: (exec: DbExec) => Promise<void>;
}

export interface StoreDefinition {
  readonly id: string;
  /**
   * Never provision from a request, even for hosted apps that do not migrate
   * at release: the release step (or a versioned list) is the only creator.
   */
  readonly releaseOnly?: boolean;
  /**
   * Append-only. Every entry must be idempotent: first runs can race. A
   * migration may only touch this store's own tables: stores apply in registry
   * order, which is by id, not by dependency.
   */
  readonly migrations: readonly StoreMigration[];
}

export interface Store extends StoreDefinition {
  /** Resolves once this store's schema is usable in the current runtime. */
  ready(): Promise<void>;
  reset(): void;
}

export class SchemaNotMigratedError extends Error {
  readonly storeId: string;
  readonly missing: readonly string[];

  constructor(storeId: string, missing: readonly string[], reason: string) {
    super(
      `Store "${storeId}" is not migrated (${reason}). ` +
        "Run the release migration step (scripts/migrate-production.ts) " +
        "against this database.",
    );
    this.name = "SchemaNotMigratedError";
    this.storeId = storeId;
    this.missing = missing;
  }
}

type Readiness = "apply" | "trust" | "replay" | "hosted-replay" | "skip";

function isHostedRuntime(): boolean {
  return (
    isHostedFunctionInvocationRuntime() ||
    isProductionServerlessFunctionRuntime()
  );
}

/**
 * Hosted functions of an app that migrates at release do no schema work at
 * all: the release step applied and verified every store before they were
 * published. Same predicate `ddl-guard` uses, so the runner and the guards
 * cannot disagree.
 */
export function schemaIsReleaseOwned(): boolean {
  return appMigratesAtRelease() && isHostedRuntime();
}

/**
 * Only the release step writes the ledger. Requests never do: PR previews
 * share the production database, and a request's writes can roll back with
 * the caller's transaction, so a ledger row written there could claim a
 * migration that production never kept.
 */
function readiness(): Readiness {
  if (isMigrationAuthorizedRuntime() && !isHostedFunctionInvocationRuntime()) {
    return "apply";
  }
  // No ledger read here: a cold start does zero schema queries, and a missed
  // release is caught by the release step's own verification, not turned into
  // a sitewide error by every request.
  if (schemaIsReleaseOwned()) return "trust";
  if (schemaEnsureSkipRequested()) return "skip";
  return isHostedRuntime() ? "hosted-replay" : "replay";
}

function statementsOf(migration: StoreMigration): readonly string[] {
  if (migration.sql === undefined) return [];
  return typeof migration.sql === "string" ? [migration.sql] : migration.sql;
}

/** Stable across bundlers; `run` bodies are not hashed because minifiers rewrite them. */
export function migrationChecksum(migration: StoreMigration): string | null {
  const statements = statementsOf(migration);
  if (statements.length === 0) return null;
  const text = statements.join("\n;\n");
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, "0") +
    (h1 >>> 0).toString(16).padStart(8, "0")
  );
}

async function runMigration(
  migration: StoreMigration,
  exec: DbExec,
): Promise<void> {
  for (const statement of statementsOf(migration)) {
    await retryOnDdlRace(() => exec.execute(statement));
  }
  // Callbacks are idempotent by contract, so a catalog race is safe to retry.
  if (migration.run) await retryOnDdlRace(() => migration.run!(exec));
}

async function applyWithLedger(store: StoreDefinition): Promise<void> {
  const exec = getDbExec();
  if (!ledgerPresent) {
    await retryOnDdlRace(() => exec.execute(LEDGER_DDL));
    ledgerPresent = true;
  }
  const recorded = (await readLedgerSnapshot()).get(store.id);
  if (recorded && store.migrations.every((m) => recorded.has(m.name))) return;

  const applied = new Set(recorded);
  for (const migration of store.migrations) {
    if (applied.has(migration.name)) continue;
    try {
      await runMigration(migration, exec);
    } catch (err) {
      throw new Error(
        `Store "${store.id}" migration "${migration.name}" failed: ${
          (err as Error)?.message ?? String(err)
        }`,
        { cause: err },
      );
    }
    await exec.execute({
      sql: `INSERT INTO ${STORE_MIGRATIONS_TABLE} (store_id, name, applied_at, checksum, kind, source) VALUES (?, ?, ?, ?, ?, 'step') ON CONFLICT (store_id, name) DO NOTHING`,
      args: [
        store.id,
        migration.name,
        Date.now(),
        migrationChecksum(migration),
        migration.kind ?? "schema",
      ],
    });
    applied.add(migration.name);
  }
  ledgerSnapshot = undefined;
}

async function replay(store: StoreDefinition): Promise<void> {
  const exec = getDbExec();
  for (const migration of store.migrations) {
    await runMigration(migration, exec);
  }
}

let ledgerSnapshot: Promise<Map<string, Set<string>>> | undefined;
let ledgerPresent = false;
const allPending = new Set<Map<Readiness, Promise<void>>>();
let stateGeneration: number | undefined;

/**
 * Ledger state and every store's memo describe one database. Closing the
 * database clients (tests, dev reloads, a process that migrates several
 * databases) may point the next query at another, so start over.
 */
function syncWithDatabaseGeneration(): void {
  const generation = dbClientGeneration();
  if (stateGeneration === generation) return;
  stateGeneration = generation;
  ledgerSnapshot = undefined;
  ledgerPresent = false;
  for (const pending of allPending) pending.clear();
}

async function loadLedger(): Promise<Map<string, Set<string>>> {
  const { rows } = await getDbExec().execute(
    // guard:allow-unbounded-read — one row per declared migration; this is the single shared read
    `SELECT store_id, name FROM ${STORE_MIGRATIONS_TABLE}`,
  );
  const ledger = new Map<string, Set<string>>();
  for (const row of rows) {
    const storeId = String(row.store_id);
    let names = ledger.get(storeId);
    if (!names) ledger.set(storeId, (names = new Set()));
    names.add(String(row.name));
  }
  return ledger;
}

function readLedgerSnapshot(): Promise<Map<string, Set<string>>> {
  const snapshot = (ledgerSnapshot ??= loadLedger());
  snapshot.catch(() => {
    if (ledgerSnapshot === snapshot) ledgerSnapshot = undefined;
  });
  return snapshot;
}

/**
 * Every registered store's migrations that the ledger does not list. The
 * release step calls this after applying, so a deploy whose ledger disagrees
 * with the code it is about to publish fails there instead of in a request.
 */
export async function findUnappliedStoreMigrations(
  stores: readonly StoreDefinition[],
): Promise<Array<{ storeId: string; missing: string[] }>> {
  ledgerSnapshot = undefined;
  const ledger = await readLedgerSnapshot();
  return stores
    .map((store) => ({
      storeId: store.id,
      missing: store.migrations
        .map((m) => m.name)
        .filter((name) => !ledger.get(store.id)?.has(name)),
    }))
    .filter((entry) => entry.missing.length > 0);
}

const LOCK_TABLE = "_an_store_migration_lock";
const LOCK_LEASE_MS = 15 * 60 * 1000;
const LOCK_POLL_MS = 2_000;

// Async context, not a counter: a second release running concurrently in the
// same process must wait for the lease, not inherit it.
const AsyncLocalStorageCtor = getAsyncLocalStorageCtor();
const heldLock = AsyncLocalStorageCtor
  ? new AsyncLocalStorageCtor<true>()
  : undefined;

/**
 * Serializes release steps against one database (a beta and production
 * pointed at the same schema, or a retried deploy) for the whole release, not
 * just the store pass. A lease row, not `pg_advisory_lock`: session locks do
 * not survive transaction poolers such as Neon's, where the lock and unlock
 * can land on different connections. The holder renews the lease while it
 * runs; a crashed holder's lease expires. Reentrant within a process, so the
 * store pass can take it inside a release that already holds it.
 */
export async function withStoreMigrationLock<T>(
  run: () => Promise<T>,
  options: { leaseMs?: number; pollMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  if (heldLock?.getStore()) return run();
  const leaseMs = options.leaseMs ?? LOCK_LEASE_MS;
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? leaseMs);
  const exec = getDbExec();
  const holder = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await retryOnDdlRace(() =>
    exec.execute(
      `CREATE TABLE IF NOT EXISTS ${LOCK_TABLE} (id INTEGER PRIMARY KEY, holder TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
    ),
  );
  for (;;) {
    const now = Date.now();
    const { rows } = await exec.execute({
      sql: `INSERT INTO ${LOCK_TABLE} (id, holder, expires_at) VALUES (1, ?, ?)
            ON CONFLICT (id) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
            WHERE ${LOCK_TABLE}.expires_at < ?
            RETURNING holder`,
      args: [holder, now + leaseMs, now],
    });
    if (rows[0]?.holder === holder) break;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for another release step to finish migrating this database (${LOCK_TABLE}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  let lost: Error | undefined;
  const renew = setInterval(
    () => {
      exec
        .execute({
          sql: `UPDATE ${LOCK_TABLE} SET expires_at = ? WHERE id = 1 AND holder = ?`,
          args: [Date.now() + leaseMs, holder],
        })
        .then(({ rowsAffected }) => {
          if (rowsAffected === 0) {
            lost ??= new Error(
              `Lost the release migration lease (${LOCK_TABLE}); another release step may have run concurrently.`,
            );
          }
        })
        .catch((err: unknown) => {
          lost ??= err instanceof Error ? err : new Error(String(err));
        });
    },
    Math.max(1, Math.floor(leaseMs / 3)),
  );
  (renew as { unref?: () => void }).unref?.();

  let result: T;
  try {
    result = heldLock ? await heldLock.run(true, run) : await run();
  } catch (err) {
    clearInterval(renew);
    // Report the migration's own error; a failed unlock only leaves a lease
    // that expires.
    await releaseLease(exec, holder).catch(() => {});
    throw err;
  }
  clearInterval(renew);
  await releaseLease(exec, holder);
  if (lost) throw lost;
  return result;
}

async function releaseLease(exec: DbExec, holder: string): Promise<void> {
  await exec.execute({
    sql: `DELETE FROM ${LOCK_TABLE} WHERE id = 1 AND holder = ?`,
    args: [holder],
  });
}

export function defineStore(definition: StoreDefinition): Store {
  const { id, migrations } = definition;
  if (!STORE_ID.test(id)) {
    throw new Error(`defineStore: invalid store id "${id}"`);
  }
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (!MIGRATION_NAME.test(migration.name)) {
      throw new Error(
        `defineStore(${id}): invalid migration name "${migration.name}"`,
      );
    }
    if (seen.has(migration.name)) {
      throw new Error(
        `defineStore(${id}): duplicate migration "${migration.name}"`,
      );
    }
    seen.add(migration.name);
    if (!migration.sql && !migration.run) {
      throw new Error(
        `defineStore(${id}): migration "${migration.name}" has no sql or run`,
      );
    }
  }

  const pending = new Map<Readiness, Promise<void>>();
  allPending.add(pending);
  const store: Store = {
    id,
    releaseOnly: definition.releaseOnly,
    migrations,
    ready() {
      syncWithDatabaseGeneration();
      const mode = readiness();
      const existing = pending.get(mode);
      if (existing) return existing;
      const run =
        mode === "apply"
          ? applyWithLedger(store)
          : mode === "hosted-replay"
            ? definition.releaseOnly
              ? Promise.resolve()
              : withMigrationExecutionRuntime(() => replay(store))
            : mode === "replay"
              ? replay(store)
              : Promise.resolve();
      // The memo outlives the request that started it; on Workers that
      // request's pool must stay open until the work settles.
      const tracked = retainRequestDbPoolScope(
        run.catch((err) => {
          if (pending.get(mode) === tracked) pending.delete(mode);
          throw err;
        }),
      );
      pending.set(mode, tracked);
      return tracked;
    },
    reset() {
      pending.clear();
    },
  };
  return store;
}

export function __resetStoreLedgerSnapshotForTests(): void {
  ledgerSnapshot = undefined;
  ledgerPresent = false;
}
