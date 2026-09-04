/**
 * Shared Postgres schema helpers for templates and framework stores.
 *
 * The small `integer` compatibility wrapper keeps existing template schemas
 * readable while mapping boolean columns to Postgres BOOLEAN columns.
 */

import { sql } from "drizzle-orm";
import {
  alias,
  boolean,
  doublePrecision,
  index,
  integer as pgInteger,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export { alias, index, pgTable as table, text, uniqueIndex };

export function integer(
  name: string,
  config?: { mode?: "boolean" | "number" },
): any {
  return config?.mode === "boolean" ? boolean(name) : pgInteger(name);
}

export const real = doublePrecision;

export function now() {
  return sql`now()`;
}

export { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

// Ownership / sharing primitives - templates opt a resource into the
// framework sharing system by spreading ownableColumns() into the table and
// pairing it with createSharesTable().
export {
  ownableColumns,
  createSharesTable,
  type Visibility,
  type ShareRole,
  type PrincipalType,
} from "../sharing/schema.js";
