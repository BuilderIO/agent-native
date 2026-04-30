import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description:
    "Query the BigQuery data warehouse. Always-available native tool — call this directly for any `dbt_analytics.*`, `dbt_mart.*`, or other warehouse table. Pass standard SQL via the `sql` arg. Do NOT use `db-query` for warehouse data (it only reaches the app's own SQL database). If credentials aren't configured, this returns a clear error with the settings path — surface that to the user; never claim the tool is missing or unregistered.",
  schema: z.object({
    sql: z.string().describe("SQL query to execute"),
  }),
  http: false,
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
        return {
          error: "bigquery_not_configured",
          message:
            "BigQuery isn't connected for this workspace yet. Ask the user to open Settings → Data sources and add BIGQUERY_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS_JSON (a service-account JSON key). Once those are saved, retry the query.",
          settingsPath: "/data-sources",
          underlying: msg,
        };
      }
      throw err;
    }
  },
});
