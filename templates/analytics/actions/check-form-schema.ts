import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description:
    "Get the schema of the HubSpot form_submissions table in BigQuery.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const sql = `
    SELECT column_name, data_type
    FROM \`.hubspot.INFORMATION_SCHEMA.COLUMNS\`
    WHERE table_name = 'form_submissions'
    ORDER BY ordinal_position
  `;

    const result = await runQuery(sql);
    return result.rows;
  },
});
