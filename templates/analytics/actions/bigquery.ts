import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description:
    "Query the BigQuery data warehouse. Use this for ALL warehouse tables and any table NOT in the app's own SQL database. Pass standard SQL. Do NOT use db-query for BigQuery data — it only reaches the app database.",
  schema: z.object({
    sql: z.string().describe("SQL query to execute"),
  }),
  http: false,
  run: async (args) => {
    return await runQuery(args.sql);
  },
});
