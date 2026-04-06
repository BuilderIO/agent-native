/**
 * Dialect-agnostic Drizzle schema helpers.
 *
 * Templates import `table`, `text`, `integer`, and `now` from here instead of
 * importing directly from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core`.
 * The correct dialect is chosen at runtime based on `DATABASE_URL`.
 *
 * Usage:
 *   import { table, text, integer, now } from "@agent-native/core/db/schema";
 *
 *   export const users = table("users", {
 *     id: text("id").primaryKey(),
 *     name: text("name").notNull(),
 *     active: integer("active", { mode: "boolean" }).notNull().default(true),
 *     createdAt: text("created_at").notNull().default(now()),
 *   });
 */

import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
} from "drizzle-orm/sqlite-core";
import {
  pgTable,
  text as pgText,
  integer as pgInteger,
  boolean as pgBoolean,
  doublePrecision as pgDoublePrecision,
} from "drizzle-orm/pg-core";
import { getDialect } from "./client.js";

// No caching — getDialect() handles its own caching once env is available.
// On CF Workers, this runs at import time before env bindings are set, so
// caching here would lock in the wrong dialect.
function pg(): boolean {
  return getDialect() === "postgres";
}

/**
 * Define a table. Delegates to `pgTable` or `sqliteTable` based on dialect.
 */
export const table: typeof sqliteTable = ((...args: any[]) =>
  pg() ? (pgTable as any)(...args) : (sqliteTable as any)(...args)) as any;

/**
 * Text column. Works identically in both dialects.
 * Supports `{ enum: [...] }` config in both.
 */
export const text: typeof sqliteText = ((...args: any[]) =>
  pg() ? (pgText as any)(...args) : (sqliteText as any)(...args)) as any;

/**
 * Integer column.
 *
 * Handles `{ mode: "boolean" }` transparently — maps to Postgres `boolean`
 * type when running against Postgres, and SQLite `integer` with boolean
 * coercion when running against SQLite.
 */
export const integer: typeof sqliteInteger = ((...args: any[]) => {
  if (pg() && args[1]?.mode === "boolean") {
    return (pgBoolean as any)(args[0]);
  }
  return pg() ? (pgInteger as any)(...args) : (sqliteInteger as any)(...args);
}) as any;

/**
 * Real/float column.
 * Maps to `real` on SQLite and `double precision` on Postgres.
 */
export const real: typeof sqliteReal = ((...args: any[]) =>
  pg()
    ? (pgDoublePrecision as any)(...args)
    : (sqliteReal as any)(...args)) as any;

/**
 * Dialect-agnostic "current timestamp" SQL expression.
 * Use with `.default(now())` on text columns storing timestamps.
 *
 * - Postgres: `now()`
 * - SQLite:   `(datetime('now'))`
 */
export function now() {
  return pg() ? sql`now()` : sql`(datetime('now'))`;
}

export { sql } from "drizzle-orm";
