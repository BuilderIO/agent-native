#!/usr/bin/env tsx
import { parseArgs, output } from "./helpers";
import { runQuery } from "../server/lib/bigquery";

const args = parseArgs();
const days = parseInt(args.days || "90", 10);

const sql = `
SELECT
  event_type,
  COUNT(*) as event_count,
  COUNT(DISTINCT user_id) as unique_users,
  MIN(event_time) as first_seen,
  MAX(event_time) as last_seen
FROM
  \`builder-3b0a2.amplitude.EVENTS_182198\`
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
output(result.rows);
