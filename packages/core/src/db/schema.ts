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

export {
  ownableColumns,
  createSharesTable,
  type Visibility,
  type ShareRole,
  type PrincipalType,
} from "../sharing/schema.js";
