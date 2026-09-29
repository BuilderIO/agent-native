import { toPostgresParams, type DbExec } from "@agent-native/core/db";
import { sql } from "drizzle-orm";

import type { getDb } from "../server/db/index.js";

export function transactionAccessExecutor(
  transaction: Pick<ReturnType<typeof getDb>, "execute">,
): DbExec {
  return {
    async execute(statement) {
      const query =
        typeof statement === "string" ? { sql: statement } : statement;
      const text = toPostgresParams(query.sql);
      const prepared = sql.raw(text);
      // PgDialect.sqlToQuery calls sql.toQuery to preserve these bindings.
      // The shared pool fixture fails if Drizzle stops honoring this override.
      prepared.toQuery = () => ({ sql: text, params: query.args ?? [] });
      const result = (await transaction.execute(prepared)) as unknown as (
        | Record<string, unknown>[]
        | { rows: Record<string, unknown>[] }
      ) & { rowCount?: number; count?: number; affectedRows?: number };
      const rows = Array.isArray(result) ? result : result.rows;
      if (!Array.isArray(rows)) {
        throw new Error("Transaction access query returned no row array");
      }
      return {
        rows,
        rowsAffected:
          result.rowCount ?? result.count ?? result.affectedRows ?? rows.length,
      };
    },
  };
}
