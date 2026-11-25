import { defineAction } from "@agent-native/core";
import { fail } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { runDashboardPanelQuery } from "../server/lib/dashboard-panel-query";
import { assertReadOnlySql } from "../server/lib/read-only-sql";

export const QUERY_POSTGRES_MAX_ROWS = 5000;

const errors = {
  unauthenticated: "no authenticated user",
};

export function boundPostgresSql(sql: string): string {
  const statement = sql.trim().replace(/;\s*$/, "");
  return [
    "SELECT * FROM (",
    statement,
    ") AS query_postgres_rows LIMIT " + String(QUERY_POSTGRES_MAX_ROWS + 1),
  ].join("\n");
}

export default defineAction({
  description:
    "Run one read-only SELECT or WITH statement against the PostgreSQL database connected in Data Sources (POSTGRES_URL). Use it when the user asks about tables or data in their own PostgreSQL database; it is not the first-party event store (use query-agent-native-analytics for that). Returns at most 5,000 rows; aggregate or add a LIMIT for large reads. Read-only safety ultimately comes from the database role behind POSTGRES_URL.",
  schema: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        "A single SELECT or WITH statement. Use literal values, not bind placeholders.",
      ),
  }),
  outputSchema: z.union([
    z.object({
      rows: z.array(z.record(z.string(), z.unknown())),
      schema: z.array(z.object({ name: z.string(), type: z.string() })),
      truncated: z.boolean(),
    }),
    z.object({
      error: z.literal("missing_api_key"),
      key: z.string(),
      label: z.string(),
      message: z.string(),
      settingsPath: z.string(),
    }),
  ]),
  readOnly: true,
  mcpTool: false,
  http: false,
  grounding: true,
  run: async (args, actionContext) => {
    const ctx = getCredentialContext();
    if (!ctx) return fail(errors.unauthenticated, { statusCode: 401 });
    assertReadOnlySql(args.query);
    const result = await runDashboardPanelQuery({
      source: "postgres",
      query: boundPostgresSql(args.query),
      ctx,
      ...(actionContext?.signal ? { signal: actionContext.signal } : {}),
    });
    if ("error" in result) {
      if (result.error === "missing_api_key") return result;
      return fail(result.message, { statusCode: 422 });
    }
    const truncated = result.rows.length > QUERY_POSTGRES_MAX_ROWS;
    return {
      rows: truncated
        ? result.rows.slice(0, QUERY_POSTGRES_MAX_ROWS)
        : result.rows,
      schema: result.schema,
      truncated,
    };
  },
});
