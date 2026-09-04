import { createGetDb } from "./create-get-db.js";

export type DrizzleDb = ReturnType<typeof createGetDb>;

export { createGetDb } from "./create-get-db.js";
export {
  deferMigration,
  MIGRATION_DEFERRED,
  runMigrations,
  withMigrationRuntime,
  type MigrationEntry,
  type MigrationRunResult,
  type MigrationSource,
  type MigrationSql,
} from "./migrations.js";
export {
  getDbExec,
  createDbExec,
  getDatabaseUrl,
  getRuntimeDatabaseUrl,
  getRuntimeDatabaseSource,
  isLocalDatabase,
  assertSchemaMutationAllowed,
  isSchemaMutationStatement,
  isProductionServerlessFunctionRuntime,
  intType,
  closeDbExec,
  type DbExec,
  type DbExecConfig,
  type DbExecQuery,
  type DbExecStatement,
} from "./client.js";
export { table, text, integer, real, now } from "./schema.js";
export {
  ensureAdditiveColumns,
  type EnsureAdditiveColumnsOptions,
  type EnsureAdditiveColumnsResult,
  type EnsureAdditiveColumnsLogger,
} from "./ensure-additive-columns.js";
