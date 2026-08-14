import { defineAction } from "@agent-native/core";
import { z } from "zod";

import bigquery from "./bigquery";

/**
 * Keep dashboard extensions authored with the old action name working while
 * the canonical agent action remains `bigquery`.
 */
export default defineAction({
  agentTool: false,
  description:
    "Compatibility HTTP alias for the Analytics BigQuery query action. Use `bigquery` from the agent.",
  schema: z.object({
    sql: z.string().describe("SQL query to execute"),
  }),
  http: { method: "POST" },
  readOnly: true,
  toolCallable: true,
  grounding: true,
  run: bigquery.run,
});
