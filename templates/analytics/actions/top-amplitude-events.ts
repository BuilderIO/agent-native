import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description: "Get the top 20 Amplitude events by count from BigQuery.",
  schema: z.object({
    days: z.coerce
      .number()
      .optional()
      .describe("Number of days to look back (default 90)"),
  }),
  http: false,
  run: async (args) => {
    const days = args.days ?? 90;

    const sql = `
SELECT
  event_type,
  COUNT(*) as event_count,
  COUNT(DISTINCT user_id) as unique_users,
  MIN(event_time) as first_seen,
  MAX(event_time) as last_seen
FROM
  \`your-gcp-project-id.amplitude.EVENTS_182198\`
WHERE
  event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
  AND event_type IS NOT NULL
GROUP BY
  event_type
ORDER BY
  event_count DESC
LIMIT 20
`;

    const result = await runQuery(sql);
    return result.rows;
  },
});
