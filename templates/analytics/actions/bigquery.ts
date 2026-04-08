import { defineAction } from "@agent-native/core";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description: "Run an arbitrary SQL query against BigQuery.",
  parameters: {
    sql: { type: "string", description: "SQL query to execute" },
  },
  http: false,
  run: async (args) => {
    if (!args.sql)
      return { error: '--sql is required. Example: --sql="SELECT 1"' };
    return await runQuery(args.sql);
  },
});
