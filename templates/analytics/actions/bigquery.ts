import { AgentActionStopError, defineAction } from "@agent-native/core";
import { z } from "zod";
import { runQuery } from "../server/lib/bigquery";

function extractBigQueryMessage(message: string): string {
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as {
        error?: {
          message?: string;
          errors?: Array<{ message?: string; reason?: string }>;
        };
      };
      const detail =
        parsed.error?.message ??
        parsed.error?.errors?.find((e) => e.message)?.message;
      if (detail) return detail.trim();
    } catch {
      // Fall back to the raw error text below.
    }
  }

  return message
    .replace(/^BigQuery (API|poll) error \d+:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Only credentials/not-configured failures stop the turn: retrying a missing
// service account is pointless, so a clean stop pointing at Settings is the
// right behavior. Query/SQL errors are NOT stopped here — they are returned as
// a normal recoverable result so the model can introspect the schema and retry
// (see the run() catch block below).
function stopForBigQueryNotConfigured(message: string): never {
  const detail = extractBigQueryMessage(message);
  throw new AgentActionStopError(detail, {
    errorCode: "bigquery_not_configured",
    toolResult: JSON.stringify(
      {
        error: "bigquery_not_configured",
        message: detail,
        recoverable: false,
      },
      null,
      2,
    ),
  });
}

export default defineAction({
  description:
    "Query the user-configured BigQuery data warehouse. Use this when the user asks for warehouse SQL, BigQuery, or a data-dictionary metric/table that lives in BigQuery. If the user names a provider action such as Jira or Pylon, use that provider action first and do not use BigQuery unless the user explicitly asks for a warehouse copy. Pass standard SQL via the `sql` arg. Do NOT use `db-query` for warehouse data (it only reaches the app's own SQL database). If a query fails with a schema or SQL error (unknown dataset/table/column, syntax), treat it as a normal debugging signal: inspect the real schema with `search-bigquery-schema` (or query INFORMATION_SCHEMA), correct the query based on the error, and run it again — a few corrective attempts are expected. Surface the error to the user only if it still fails after a few attempts or is non-recoverable (missing credentials, permission, quota). Never rerun identical failing SQL, and never substitute made-up numbers for data you could not query.",
  schema: z.object({
    sql: z.string().describe("SQL query to execute"),
  }),
  readOnly: true,
  toolCallable: true,
  run: async (args) => {
    try {
      return await runQuery(args.sql);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        /GOOGLE_APPLICATION_CREDENTIALS_JSON not configured/i.test(msg) ||
        /BIGQUERY_PROJECT_ID/i.test(msg) ||
        /service account/i.test(msg) ||
        /Token exchange failed/i.test(msg)
      ) {
        stopForBigQueryNotConfigured(
          "BigQuery isn't connected for this workspace yet. Open Settings -> Data sources and add BIGQUERY_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS_JSON (a service-account JSON key).",
        );
      }
      if (
        /BigQuery (API|poll) error/i.test(msg) ||
        /BigQuery query timed out/i.test(msg)
      ) {
        // Recoverable: hand the real error back to the model so it can inspect
        // the schema and self-correct, instead of force-ending the turn.
        return {
          error: "bigquery_query_failed",
          message: extractBigQueryMessage(msg),
          recoverable: true,
          hint: "Likely a schema mismatch (wrong dataset, table, or column) or a SQL issue. Use search-bigquery-schema to get the exact datasets/tables/columns (or query INFORMATION_SCHEMA), correct the SQL based on this error, and run it again. Change the query based on the error — do not rerun identical SQL — and never substitute made-up numbers for data you could not query.",
        };
      }
      throw err;
    }
  },
});
