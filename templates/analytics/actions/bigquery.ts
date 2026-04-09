import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description: "Run an arbitrary SQL query against BigQuery.",
  schema: z.object({
    sql: z.string().describe("SQL query to execute"),
  }),
  http: false,
  run: async (args) => {
    return await runQuery(args.sql);
  },
});
