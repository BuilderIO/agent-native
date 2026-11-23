import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
  sql,
  type DbExec,
} from "@agent-native/core/db";

import {
  REQUIRED_ANALYTICS_TABLES,
  analyticsMigrations,
} from "../db/migrations.js";
import * as schema from "../db/schema.js";

/** Drizzle tables are objects carrying the table symbol; the schema module also exports types. */
function isDrizzleTable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((symbol) =>
      symbol.toString().includes("drizzle"),
    )
  );
}

const schemaTables = Object.values(schema).filter(isDrizzleTable);

const migrate = runMigrations([...analyticsMigrations], {
  table: "analytics2_migrations",
});

export class AnalyticsDatabaseError extends Error {
  readonly code = "analytics_database_unavailable";
  readonly statusCode = 503;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AnalyticsDatabaseError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause });
    }
  }
}

export async function missingAnalyticsTables(exec: DbExec): Promise<string[]> {
  // Composed with the core SQL helper; values are bound, never spliced into a
  // statement string.
  const result = await exec.execute(
    sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ${sql.in([...REQUIRED_ANALYTICS_TABLES])}`,
  );
  const present = new Set<string>();
  for (const row of result.rows as unknown as { table_name?: unknown }[]) {
    if (typeof row.table_name === "string") present.add(row.table_name);
  }
  return REQUIRED_ANALYTICS_TABLES.filter((table) => !present.has(table));
}

let initialization: Promise<void> | undefined;

async function initialize(): Promise<void> {
  await migrate(undefined);
  const summary = await ensureAdditiveColumns({
    db: getDbExec(),
    tables: schemaTables,
  });
  if (summary.errors.length > 0) {
    throw new AggregateError(
      summary.errors,
      "Analytics workspace additive-column verification failed",
    );
  }
  const missing = await missingAnalyticsTables(getDbExec());
  if (missing.length > 0) {
    throw new Error(
      `Analytics workspace tables are missing after migration: ${missing.join(", ")}`,
    );
  }
}

/**
 * Brings the workspace database up to date: run the additive migrations, then
 * verify every table and column the stores read is present.
 *
 * Migrations are idempotent, so the check runs once per process even when
 * several requests arrive together.
 */
export async function ensureAnalyticsDatabase(): Promise<void> {
  initialization ??= initialize();
  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    throw new AnalyticsDatabaseError(
      "The workspace database is temporarily unavailable. Try again shortly.",
      error,
    );
  }
}
