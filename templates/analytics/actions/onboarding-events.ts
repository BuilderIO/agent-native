import { defineAction } from "@agent-native/core";
import { runQuery } from "../server/lib/bigquery";

export default defineAction({
  description: "Query onboarding-related events from Amplitude via BigQuery.",
  parameters: {
    days: {
      type: "string",
      description: "Number of days to look back (default 90)",
    },
  },
  http: false,
  run: async (args) => {
    const days = parseInt(args.days || "90", 10);

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
  AND (
    LOWER(event_type) LIKE '%onboard%'
    OR LOWER(event_type) LIKE '%signup%'
    OR LOWER(event_type) LIKE '%getting%started%'
    OR LOWER(event_type) LIKE '%welcome%'
    OR LOWER(event_type) LIKE '%tutorial%'
    OR LOWER(event_type) LIKE '%first%'
    OR LOWER(event_type) LIKE '%setup%'
    OR LOWER(event_type) LIKE '%activation%'
    OR LOWER(event_type) LIKE '%invited%'
    OR LOWER(event_type) LIKE '%team%create%'
    OR LOWER(event_type) LIKE '%workspace%'
  )
GROUP BY
  event_type
ORDER BY
  event_count DESC
`;

    const result = await runQuery(sql);
    return result.rows;
  },
});
