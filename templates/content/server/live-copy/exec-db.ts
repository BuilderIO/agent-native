import type { DbExec } from "@agent-native/core/db";
import { drizzle } from "drizzle-orm/pg-proxy";

import { schema, type getDb } from "../db/index.js";

type ContentDb = ReturnType<typeof getDb>;

// `"table"."column"` or `"column"`, capturing the column.
const QUOTED_COLUMN = /(?:"[^"]+"\.)?"([^"]+)"(?!\.)/g;

/**
 * Drizzle reads selected columns by position, but `DbExec` returns each row
 * as an object, so two selected columns with one name collapse into one key
 * and every later column shifts left. Refuse such a query instead.
 */
function assertDistinctColumnNames(sql: string): void {
  const lower = sql.toLowerCase();
  const returning = lower.lastIndexOf(" returning ");
  const from = lower.indexOf(" from ");
  const list =
    returning >= 0
      ? sql.slice(returning)
      : lower.startsWith("select ")
        ? sql.slice(0, from < 0 ? undefined : from)
        : "";
  const seen = new Set<string>();
  for (const [, column] of list.matchAll(QUOTED_COLUMN)) {
    if (seen.has(column)) {
      throw new Error(
        `A query on the live-copy transaction selects two columns named "${column}"; alias one, since its rows are mapped by position.`,
      );
    }
    seen.add(column);
  }
}

/**
 * A Drizzle handle whose queries all run on `exec`. Inside a live-copy
 * `persist`, `getDb()` would query another connection, outside the row locks
 * the commit holds.
 */
export function drizzleOverExec(exec: DbExec): ContentDb {
  return drizzle(
    async (sql, args, method) => {
      if (method === "all") assertDistinctColumnNames(sql);
      const result = await exec.execute({ sql, args });
      return {
        rows:
          method === "all"
            ? result.rows.map((row) =>
                Array.isArray(row) ? row : Object.values(row),
              )
            : result.rows,
      };
    },
    { schema },
  ) as unknown as ContentDb;
}
