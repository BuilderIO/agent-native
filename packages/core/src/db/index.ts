import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";

export type DbConfig =
  | { driver: "sqlite"; filename: string }
  | { driver: "d1"; binding: any }
  | { driver: "postgres" | "neon"; connectionString: string };

/**
 * Create a Drizzle ORM database instance.
 * Currently supports SQLite via better-sqlite3.
 * D1 and Postgres/Neon support added as needed.
 */
export function createDb(config: DbConfig) {
  if (config.driver === "sqlite") {
    const sqlite = new Database(config.filename);
    // Enable WAL mode for better concurrent read performance
    sqlite.pragma("journal_mode = WAL");
    return drizzle(sqlite);
  }
  throw new Error(`Unsupported driver: ${(config as any).driver}`);
}

export type DrizzleDb = ReturnType<typeof createDb>;

export { createGetDb } from "./create-get-db.js";
export { runMigrations } from "./migrations.js";
