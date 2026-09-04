import { getAppConfig } from "../app-config/index.js";
import {
  createDbExec,
  getDbExec,
  getMigrationDatabaseUrl,
  isPgliteUrl,
  retryOnDdlRace,
  type DbExec,
} from "./client.js";
import { isMigrationAuthorizedRuntime } from "./migration-runtime.js";

// Core plugins share one direct connection while boot-time DDL is running.
let migrationExecPromise: Promise<DbExec> | null = null;
let migrationExecRefCount = 0;

async function acquireMigrationExec(): Promise<DbExec> {
  if (!migrationExecPromise) {
    const opened = createDbExec({ url: getMigrationDatabaseUrl() });
    migrationExecPromise = opened;
    opened.catch(() => {
      if (migrationExecPromise === opened) {
        migrationExecPromise = null;
        migrationExecRefCount = 0;
      }
    });
  }
  migrationExecRefCount++;
  return migrationExecPromise;
}

async function releaseMigrationExec(): Promise<void> {
  migrationExecRefCount--;
  if (migrationExecRefCount > 0) return;
  const execPromise = migrationExecPromise;
  migrationExecPromise = null;
  migrationExecRefCount = 0;
  if (!execPromise) return;
  const migrationUrl = getMigrationDatabaseUrl();
  if (!migrationUrl || isPgliteUrl(migrationUrl)) return;
  try {
    const exec = await execPromise;
    await exec.close?.();
  } catch (err) {
    console.warn("[db] Migration connection cleanup failed:", err);
  }
}

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/** True when an ADD COLUMN statement reports an existing column. */
export function isDuplicateColumnError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? "";
  return /column .* already exists/i.test(msg) || /duplicate_object/i.test(msg);
}

/** True when the connected Postgres role cannot apply the migration. */
export function isPermissionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  if (e?.code === "42501") return true;
  const msg = e?.message ?? "";
  return (
    /must be owner of/i.test(msg) ||
    /permission denied/i.test(msg) ||
    /insufficient privilege/i.test(msg)
  );
}

function isMissingRelationError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  return (
    e?.code === "42P01" || /relation .* does not exist/i.test(e?.message ?? "")
  );
}

/** Split a multi-statement SQL blob while preserving quoted semicolons. */
function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inSingle && ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "'") {
      buf += ch;
      if (inSingle && next === "'") {
        buf += next;
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (ch === ";" && !inSingle) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export interface RunMigrationsOptions {
  runInServerlessRequest?: boolean;
  /** Each template needs a private bookkeeping table. */
  table: string;
}

export type MigrationSql = string | { postgres?: string };

export const MIGRATION_DEFERRED = Symbol("migration-deferred");

export function deferMigration(): typeof MIGRATION_DEFERRED {
  return MIGRATION_DEFERRED;
}

export type MigrationRunResult = void | typeof MIGRATION_DEFERRED;

export interface MigrationEntry {
  version: number;
  sql: MigrationSql;
  /** Generated entries keep their stable name without advancing the legacy gate. */
  name?: string;
  run?: () => Promise<MigrationRunResult>;
}

export type MigrationSource =
  | Array<MigrationEntry>
  | (() => Array<MigrationEntry> | Promise<Array<MigrationEntry>>);

function resolveMigrationSql(sql: MigrationSql): string | null {
  if (typeof sql === "string") return sql;
  return sql.postgres ?? null;
}

function isServerlessRequestRuntime(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return (
    process.env.NETLIFY === "true" ||
    Boolean(process.env.NETLIFY_FUNCTION_NAME) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.LAMBDA_TASK_ROOT) ||
    process.env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda") === true ||
    process.env.VERCEL === "1"
  );
}

function appMigratesAtRelease(): boolean {
  const { migration } = getAppConfig();
  return (
    migration.releaseMigrations ||
    migration.betaSchemaOwner?.toLowerCase() === "production"
  );
}

export { withMigrationRuntime } from "./migration-runtime.js";

function validateMigrationNames(
  migrations: Array<MigrationEntry>,
  table: string,
): void {
  const seenNames = new Set<string>();
  for (const migration of migrations) {
    if (!migration.name) continue;
    if (seenNames.has(migration.name)) {
      throw new Error(
        `runMigrations: duplicate migration name "${migration.name}" in the migration list for table "${table}". ` +
          "Migration names must be unique - pick a different stable slug.",
      );
    }
    seenNames.add(migration.name);
  }
}

export function runMigrations(
  migrationSource: MigrationSource,
  options: RunMigrationsOptions,
): NitroPluginDef {
  const table = options?.table;
  if (
    !table ||
    typeof table !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)
  ) {
    throw new Error(
      "runMigrations: `table` option is required and must be a valid SQL identifier.",
    );
  }
  if (Array.isArray(migrationSource)) {
    validateMigrationNames(migrationSource, table);
    if (migrationSource.length === 0) return async () => {};
  }

  const namedTable = `${table}_named`;
  return async () => {
    if (
      options?.runInServerlessRequest !== true &&
      isServerlessRequestRuntime() &&
      appMigratesAtRelease() &&
      !isMigrationAuthorizedRuntime()
    ) {
      console.info(
        `[migrations] Skipping "${table}" migrations in a serverless request runtime`,
      );
      return;
    }

    try {
      const migrations =
        typeof migrationSource === "function"
          ? await migrationSource()
          : migrationSource;
      if (!Array.isArray(migrations)) {
        throw new Error(
          "runMigrations: a lazy migration source must return an array of migration entries",
        );
      }
      if (typeof migrationSource === "function") {
        validateMigrationNames(migrations, table);
      }
      if (migrations.length === 0) return;

      let current = -1;
      let namedRowsMissing = false;
      const hasNamedMigrations = migrations.some((migration) => migration.name);
      let appliedNames = new Set<string>();

      try {
        const { rows } = await getDbExec().execute(
          `SELECT MAX(version) as v FROM ${table}`,
        );
        current = (rows[0]?.v as number) ?? 0;
      } catch (err) {
        if (!isMissingRelationError(err)) throw err;
      }
      if (hasNamedMigrations) {
        try {
          const { rows } = await getDbExec().execute(
            `SELECT name FROM ${namedTable}`,
          );
          appliedNames = new Set(rows.map((row) => String(row.name)));
        } catch (err) {
          if (!isMissingRelationError(err)) throw err;
          namedRowsMissing = true;
        }
      }

      const pendingFast = migrations.filter((migration) =>
        migration.name
          ? !appliedNames.has(migration.name)
          : migration.version > current,
      );
      if (pendingFast.length === 0) return;

      const runOnlyPending =
        current >= 0 &&
        !namedRowsMissing &&
        pendingFast.every(
          (migration) => resolveMigrationSql(migration.sql) === null,
        );
      const exec = runOnlyPending ? getDbExec() : await acquireMigrationExec();

      try {
        if (!runOnlyPending) {
          await retryOnDdlRace(() =>
            exec.execute(
              `CREATE TABLE IF NOT EXISTS ${table} (version BIGINT PRIMARY KEY)`,
            ),
          );
          await retryOnDdlRace(() =>
            exec.execute(
              `CREATE TABLE IF NOT EXISTS ${namedTable} (name TEXT PRIMARY KEY, version BIGINT, applied_at TIMESTAMP NOT NULL DEFAULT now())`,
            ),
          );
        }

        if (current === -1 || (hasNamedMigrations && namedRowsMissing)) {
          if (current === -1) {
            const { rows } = await exec.execute(
              `SELECT MAX(version) as v FROM ${table}`,
            );
            current = (rows[0]?.v as number) ?? 0;
          }
          if (hasNamedMigrations && namedRowsMissing) {
            const { rows } = await exec.execute(
              `SELECT name FROM ${namedTable}`,
            );
            appliedNames = new Set(rows.map((row) => String(row.name)));
          }
        }

        const insertVersionSql = `INSERT INTO ${table} (version) VALUES (?) ON CONFLICT DO NOTHING`;
        const insertNamedSql = `INSERT INTO ${namedTable} (name, version) VALUES (?, ?) ON CONFLICT DO NOTHING`;
        const pending = runOnlyPending
          ? pendingFast
          : migrations.filter((migration) =>
              migration.name
                ? !appliedNames.has(migration.name)
                : migration.version > current,
            );

        if (pending.length > 0) {
          console.log(
            `[db] Applying ${pending.length} migration(s) on Postgres...`,
          );
        }

        for (const migration of pending) {
          const raw = resolveMigrationSql(migration.sql);
          const label = migration.name
            ? `"${migration.name}" (v${migration.version})`
            : `v${migration.version}`;
          const advancesLegacyVersion = migration.version > current;
          const recordSql: Array<{ sql: string; args: unknown[] }> = [];
          if (migration.name) {
            recordSql.push({
              sql: insertNamedSql,
              args: [migration.name, migration.version],
            });
          }
          if (advancesLegacyVersion) {
            recordSql.push({
              sql: insertVersionSql,
              args: [migration.version],
            });
          }

          const runResult = migration.run ? await migration.run() : undefined;
          if (runResult === MIGRATION_DEFERRED) {
            console.info(
              `[db] Deferred migration ${label}; it remains pending for a later boot`,
            );
            continue;
          }

          if (raw == null) {
            for (const statement of recordSql) await exec.execute(statement);
            if (advancesLegacyVersion) current = migration.version;
            if (migration.name) appliedNames.add(migration.name);
            continue;
          }

          const statements = splitSqlStatements(raw);
          let currentStatement = "";
          try {
            for (const statement of statements) {
              currentStatement = statement;
              await retryOnDdlRace(() => exec.execute(statement));
            }
            for (const statement of recordSql) await exec.execute(statement);
            if (advancesLegacyVersion) current = migration.version;
            if (migration.name) appliedNames.add(migration.name);
            console.log(
              `[db] Applied migration ${label} (${statements.length} statement${statements.length === 1 ? "" : "s"})`,
            );
          } catch (err) {
            if (isPermissionError(err)) {
              console.warn(
                `[db] Migration ${label} skipped - insufficient privilege: ${(err as Error).message}. ` +
                  "Apply it with a database role that owns the table. Halting further migrations.",
                "\nStatement:",
                currentStatement,
              );
              break;
            }
            console.error(
              `[db] Migration ${label} FAILED:`,
              (err as Error).message,
              "\nStatement:",
              currentStatement,
            );
            throw err;
          }
        }
      } finally {
        if (!runOnlyPending) await releaseMigrationExec();
      }
    } catch (err) {
      console.error("[db] Migration failed:", (err as Error).message);
      if (isMigrationAuthorizedRuntime()) throw err;
      const isServerless =
        !!globalThis.process?.env?.NETLIFY ||
        !!globalThis.process?.env?.AWS_LAMBDA_FUNCTION_NAME ||
        !!globalThis.process?.env?.VERCEL ||
        "__cf_env" in globalThis ||
        "__env__" in globalThis;
      if (typeof globalThis.process?.exit === "function" && !isServerless) {
        process.exit(1);
      }
    }
  };
}
