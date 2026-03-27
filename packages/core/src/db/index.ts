import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";

export type DbConfig =
  | { driver: "sqlite"; filename: string }
  | { driver: "d1"; binding: any }
  | { driver: "postgres"; connectionString: string };

/**
 * Create a Drizzle ORM database instance.
 * Supports SQLite via better-sqlite3 and Postgres via postgres-js.
 * Postgres driver is loaded dynamically to avoid bundling in edge runtimes.
 */
export async function createDb(config: DbConfig) {
  if (config.driver === "postgres") {
    const { drizzle: drizzlePg } = await import("drizzle-orm/postgres-js");
    const { default: pg } = await import("postgres");
    return drizzlePg(pg(config.connectionString));
  }
  if (config.driver === "sqlite") {
    const sqlite = new Database(config.filename);
    sqlite.pragma("journal_mode = WAL");
    return drizzle(sqlite);
  }
  throw new Error(`Unsupported driver: ${(config as any).driver}`);
}

export type DrizzleDb = Awaited<ReturnType<typeof createDb>>;

export { createGetDb } from "./create-get-db.js";
export { runMigrations } from "./migrations.js";
export {
  getDbExec,
  getDialect,
  isPostgres,
  closeDbExec,
  type DbExec,
  type Dialect,
} from "./client.js";
