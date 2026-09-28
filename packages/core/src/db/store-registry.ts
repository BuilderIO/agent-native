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

import { getAppConfig } from "../app-config/index.js";
import { getDbExec, isLocalDatabase, type DbExec } from "./client.js";
import { isMigrationAuthorizedRuntime } from "./migration-runtime.js";
import {
  isProductionServerlessFunctionRuntime,
  retryOnDdlRace,
} from "./runtime-facts.js";

export const STORE_MIGRATIONS_TABLE = "_an_store_migrations";

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${STORE_MIGRATIONS_TABLE} (
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  applied_at BIGINT NOT NULL,
  PRIMARY KEY (store_id, name)
)`;

const STORE_ID = /^[a-z][a-z0-9_]*$/;
const MIGRATION_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export interface StoreMigration {
  /** Stable, never renamed: the ledger records it. */
  readonly name: string;
  readonly sql?: string | readonly string[];
  readonly run?: (exec: DbExec) => Promise<void>;
}

export interface StoreDefinition {
  readonly id: string;
  /** Append-only. Every entry must be idempotent: first runs can race. */
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
        "This runtime does not own the schema; run the release migration step " +
        "(scripts/migrate-production.ts) against this database.",
    );
    this.name = "SchemaNotMigratedError";
    this.storeId = storeId;
    this.missing = missing;
  }
}

type Readiness = "apply" | "verify" | "replay";

/**
 * Hosted functions never own schema, and neither does a deployment that
 * declared release-owned migrations. A local database always self-provisions.
 */
export function schemaIsReleaseOwned(): boolean {
  if (isProductionServerlessFunctionRuntime()) return true;
  const migration = getAppConfig().migration;
  const declared =
    migration?.releaseMigrations === true ||
    migration?.betaSchemaOwner?.toLowerCase() === "production";
  return declared && !isLocalDatabase();
}

function readiness(): Readiness {
  if (isMigrationAuthorizedRuntime()) return "apply";
  if (schemaIsReleaseOwned()) return "verify";
  return "replay";
}

function statementsOf(migration: StoreMigration): readonly string[] {
  if (migration.sql === undefined) return [];
  return typeof migration.sql === "string" ? [migration.sql] : migration.sql;
}

async function runMigration(
  migration: StoreMigration,
  exec: DbExec,
): Promise<void> {
  for (const statement of statementsOf(migration)) {
    await retryOnDdlRace(() => exec.execute(statement));
  }
  if (migration.run) await migration.run(exec);
}

async function applyWithLedger(store: StoreDefinition): Promise<void> {
  const exec = getDbExec();
  await retryOnDdlRace(() => exec.execute(LEDGER_DDL));
  const { rows } = await exec.execute({
    sql: `SELECT name FROM ${STORE_MIGRATIONS_TABLE} WHERE store_id = ?`,
    args: [store.id],
  });
  const applied = new Set(rows.map((row) => String(row.name)));
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
      sql: `INSERT INTO ${STORE_MIGRATIONS_TABLE} (store_id, name, applied_at) VALUES (?, ?, ?) ON CONFLICT (store_id, name) DO NOTHING`,
      args: [store.id, migration.name, Date.now()],
    });
  }
}

async function replay(store: StoreDefinition): Promise<void> {
  const exec = getDbExec();
  for (const migration of store.migrations) {
    await runMigration(migration, exec);
  }
}

let ledgerSnapshot: Promise<Map<string, Set<string>>> | undefined;

function isMissingRelation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  return (
    e?.code === "42P01" || /relation .* does not exist/i.test(e?.message ?? "")
  );
}

async function loadLedger(): Promise<Map<string, Set<string>>> {
  const { rows } = await getDbExec().execute(
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

async function verify(store: StoreDefinition): Promise<void> {
  ledgerSnapshot ??= loadLedger();
  let ledger: Map<string, Set<string>>;
  try {
    ledger = await ledgerSnapshot;
  } catch (err) {
    ledgerSnapshot = undefined;
    if (isMissingRelation(err)) {
      throw new SchemaNotMigratedError(
        store.id,
        store.migrations.map((m) => m.name),
        `${STORE_MIGRATIONS_TABLE} does not exist`,
      );
    }
    throw err;
  }
  const applied = ledger.get(store.id);
  const missing = store.migrations
    .map((m) => m.name)
    .filter((name) => !applied?.has(name));
  if (missing.length > 0) {
    // Re-read next time so a release that lands mid-process is picked up.
    ledgerSnapshot = undefined;
    throw new SchemaNotMigratedError(
      store.id,
      missing,
      `missing ${missing.join(", ")}`,
    );
  }
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
  const store: Store = {
    id,
    migrations,
    ready() {
      const mode = readiness();
      const existing = pending.get(mode);
      if (existing) return existing;
      const run =
        mode === "apply"
          ? applyWithLedger(store)
          : mode === "verify"
            ? verify(store)
            : replay(store);
      const tracked = run.catch((err) => {
        if (pending.get(mode) === tracked) pending.delete(mode);
        throw err;
      });
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
}
