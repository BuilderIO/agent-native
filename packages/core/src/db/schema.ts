/** Shared Postgres schema exports for templates and framework stores. */

import { sql } from "drizzle-orm";
import {
  alias,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export {
  alias,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable as table,
  text,
  uniqueIndex,
};
export { doublePrecision as real };

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
