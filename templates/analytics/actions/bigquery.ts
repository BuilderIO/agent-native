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

function stopForBigQueryFailure(code: string, message: string): never {
  const detail = extractBigQueryMessage(message);
  throw new AgentActionStopError(
    [
      "I couldn't complete the BigQuery query.",
      "",
      `BigQuery returned: ${detail}`,
      "",
      "I stopped here instead of retrying automatically. Tell me whether to adjust the SQL, use another source, or try again.",
    ].join("\n"),
    {
      errorCode: code,
      toolResult: JSON.stringify(
        {
          error: code,
          message: detail,
          retryable: false,
          stopped: true,
        },
        null,
        2,
      ),
    },
  );
}

export default defineAction({
  description:
    "Query the user-configured BigQuery data warehouse. Use this for warehouse tables and views from connected analytics sources. Pass standard SQL via the `sql` arg. Do NOT use `db-query` for warehouse data (it only reaches the app's own SQL database). If BigQuery returns any error, stop and report it to the user instead of retrying or reformulating more queries in the same turn.",
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
        stopForBigQueryFailure(
          "bigquery_not_configured",
          "BigQuery isn't connected for this workspace yet. Open Settings -> Data sources and add BIGQUERY_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS_JSON (a service-account JSON key).",
        );
      }
      if (
        /BigQuery (API|poll) error/i.test(msg) ||
        /BigQuery query timed out/i.test(msg)
      ) {
        stopForBigQueryFailure("bigquery_query_failed", msg);
      }
      throw err;
    }
  },
});
