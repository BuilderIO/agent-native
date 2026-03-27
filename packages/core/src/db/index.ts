import { drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import Database from "better-sqlite3";
import pg from "postgres";

export type DbConfig =
  | { driver: "sqlite"; filename: string }
  | { driver: "d1"; binding: any }
  | { driver: "postgres" | "neon"; connectionString: string };

/**
 * Create a Drizzle ORM database instance.
 * Supports SQLite via better-sqlite3 and Postgres/Neon via postgres-js.
 */
export function createDb(config: DbConfig) {
  if (config.driver === "postgres" || config.driver === "neon") {
    return drizzlePg(pg(config.connectionString));
  }
  if (config.driver === "sqlite") {
    const sqlite = new Database(config.filename);
    sqlite.pragma("journal_mode = WAL");
    return drizzle(sqlite);
  }
  throw new Error(`Unsupported driver: ${(config as any).driver}`);
}

export type DrizzleDb = ReturnType<typeof createDb>;

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
