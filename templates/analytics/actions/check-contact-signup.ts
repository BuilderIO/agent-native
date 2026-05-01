import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description:
    "Check contacts with signup timestamps from BigQuery dim_hs_contacts.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const sql = `
    SELECT
      contact_id,
      email,
      builder_user_id,
      sign_up_time_stamp,
      sign_up_time_stamp_time
    FROM \`.dbt_mart.dim_hs_contacts\`
    WHERE sign_up_time_stamp IS NOT NULL
    ORDER BY sign_up_time_stamp DESC
    LIMIT 10
  `;

    const result = await runQuery(sql);
    return result.rows;
  },
});
