#!/usr/bin/env tsx
import { parseArgs, output } from "./helpers";
import { runQuery } from "../server/lib/bigquery";

const args = parseArgs();
const days = parseInt(args.days || "30", 10);

// Macy's org IDs from learnings.md
const MACYS_ORG_IDS = [
  "9060c246119d414a97029d535e99b322",
  "05d13a2470824298aeacdabc2a3ace1c",
  "42edb541a73f4cb6ba52c70092534a64",
  "ceb199b063d34a47ad2b03c9d1e019df",
];
const orgIdList = MACYS_ORG_IDS.map((id) => `'${id}'`).join(",");

const result = await runQuery(`
  SELECT
    DATE(event_time) as date,
    COALESCE(JSON_VALUE(user_properties, '$.email'), user_id) as email,
    COUNT(*) as message_count
  FROM amplitude.EVENTS_182198
  WHERE event_type = 'fusion chat message submitted'
    AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
    AND event_time <= CURRENT_TIMESTAMP()
    AND JSON_VALUE(event_properties, '$.rootOrganizationId') IN (${orgIdList})
  GROUP BY date, email
  ORDER BY date, message_count DESC
`);

output(result.rows);
