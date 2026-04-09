import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runQuery } from "../server/lib/postgres";

export default defineAction({
  description:
    "Run an arbitrary SQL query against a connected PostgreSQL database.",
  schema: z.object({
    sql: z.string().optional().describe("SQL query to execute"),
  }),
  http: false,
  run: async (args) => {
    if (!args.sql)
      return { error: '--sql is required. Example: --sql="SELECT 1"' };
    return await runQuery(args.sql);
  },
});
