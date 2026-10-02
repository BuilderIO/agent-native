import { createHash } from "node:crypto";

import { loadDashboardSeed } from "./dashboard-seeds";
import {
  buildPanel,
  FIRST_PARTY_DASHBOARD_ID,
  FIRST_PARTY_TEMPLATE_SCOPED_METRIC_KEYS,
  firstPartyTemplateFilter,
  LEGACY_SIGNUPS_OVER_TIME_SQL,
  LEGACY_SEED_SIGNUPS_OVER_TIME_SQL,
  PRE_COHORT_HISTORY_RETENTION_OVER_TIME_SQL,
  PRE_CAPPED_RETENTION_OVER_TIME_SQL,
  PRE_SOURCE_SCAN_BOUNDS_RETENTION_OVER_TIME_SQL,
  PRE_CAPPED_SIGNUPS_OVER_TIME_SQL,
  PRE_CUSTOM_SPINE_SIGNUPS_OVER_TIME_SQL,
  SIGNUPS_OVER_TIME_SQL,
  type ExactFirstPartyPanelReplacement,
  repairFirstPartyObservedRetentionPanels,
} from "./first-party-metric-catalog";

export const FIRST_PARTY_BIGQUERY_DASHBOARD_ID =
  "agent-native-templates-first-party-bigquery-v2";

const BIGQUERY_SESSION_STATUS_EVENT_FILTER =
  "event_name IN ('session status', 'session_status')";
const BIGQUERY_SIGNED_IN_ACTIVITY_FILTER = `(((${BIGQUERY_SESSION_STATUS_EVENT_FILTER} AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND NULLIF(user_key, '') IS NOT NULL)`;
const BIGQUERY_CONTENT_OR_CHAT_ACTIVITY_FILTER = `(
  (event_name IN ('action_completed', 'core_action_completed')
    AND COALESCE(JSON_VALUE(properties, '$.success'), 'true') = 'true'
    AND NULLIF(JSON_VALUE(properties, '$.output_id'), '') IS NOT NULL)
  OR event_name IN ('generation_completed', 'design_created', 'plan_created', 'recording_ready', 'run_started')
  OR (event_name = 'app.first_action' AND JSON_VALUE(properties, '$.action') = 'chat_submit')
  OR (event_name = 'core_action_started' AND JSON_VALUE(properties, '$.action_name') = 'chat_submit')
) AND NULLIF(JSON_VALUE(properties, '$.auth_user_id'), '') IS NOT NULL`;

export const FIRST_PARTY_BIGQUERY_WAU_SQL = `WITH base AS (
  SELECT
    event_date,
    user_key AS visitor_key,
    COALESCE(
      NULLIF(template, ''),
      NULLIF(JSON_VALUE(properties, '$.templateId'), ''),
      NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''),
      NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''),
      NULLIF(app, ''),
      NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''),
      NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''),
      'unknown'
    ) AS template
  FROM \`builder-3b0a2.analytics.first_party_analytics_events_raw_query\`
  WHERE org_id = 'PlRt3bfcpJNnOyF_Wfgsh'
    AND ${BIGQUERY_SIGNED_IN_ACTIVITY_FILTER}
    AND ('{{emailFilter}}' IN ('', 'all')
      OR ('{{emailFilter}}' = 'exclude_builder' AND LOWER(COALESCE(user_id, '')) NOT LIKE '%@builder.io')
      OR ('{{emailFilter}}' = 'only_builder' AND LOWER(COALESCE(user_id, '')) LIKE '%@builder.io'))
    AND ('{{appFilter}}' IN ('', 'all')
      OR LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''), 'unknown')) = LOWER('{{appFilter}}'))
    AND LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''), 'unknown')) IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides')
    AND ('{{timeRange}}' IN ('', 'all') OR event_date >= CASE
      WHEN '{{timeRange}}' = 'custom' THEN DATE_SUB(DATE('{{timeRangeStart}}'), INTERVAL 6 DAY)
      WHEN '{{timeRange}}' = '7d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 13 DAY)
      WHEN '{{timeRange}}' = '30d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 36 DAY)
      WHEN '{{timeRange}}' = '90d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 96 DAY)
      WHEN '{{timeRange}}' = '180d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 186 DAY)
      WHEN '{{timeRange}}' = '365d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 371 DAY)
      ELSE DATE_SUB(CURRENT_DATE(), INTERVAL 96 DAY)
    END)
    AND event_date <= IF('{{timeRange}}' = 'custom', LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()), CURRENT_DATE())
), date_spine AS (
  SELECT date
  FROM UNNEST(GENERATE_DATE_ARRAY(
    CASE
      WHEN '{{timeRange}}' = 'custom' THEN DATE('{{timeRangeStart}}')
      WHEN '{{timeRange}}' = '7d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY)
      WHEN '{{timeRange}}' = '30d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY)
      WHEN '{{timeRange}}' = '90d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 89 DAY)
      WHEN '{{timeRange}}' = '180d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 179 DAY)
      WHEN '{{timeRange}}' = '365d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 364 DAY)
      WHEN '{{timeRange}}' IN ('', 'all') THEN COALESCE((SELECT MIN(event_date) FROM base), CURRENT_DATE())
      ELSE DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    END,
    IF('{{timeRange}}' = 'custom', LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()), CURRENT_DATE())
  )) AS date
), wau AS (
  SELECT d.date, b.template, COUNT(DISTINCT b.visitor_key) AS visitors
  FROM date_spine d
  JOIN base b
    ON b.event_date BETWEEN DATE_SUB(d.date, INTERVAL 6 DAY) AND d.date
  GROUP BY d.date, b.template
)
SELECT date, template, visitors
FROM wau
ORDER BY date, template`;

export const PRE_CUSTOM_FIRST_PARTY_BIGQUERY_WAU_SQL =
  FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
    "      WHEN '{{timeRange}}' = 'custom' THEN DATE_SUB(DATE('{{timeRangeStart}}'), INTERVAL 6 DAY)\n",
    "",
  )
    .split(
      "IF('{{timeRange}}' = 'custom', LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()), CURRENT_DATE())",
    )
    .join("CURRENT_DATE()")
    .replace(
      "      WHEN '{{timeRange}}' = 'custom' THEN DATE('{{timeRangeStart}}')\n",
      "",
    );

export const LEGACY_FIRST_PARTY_BIGQUERY_RETENTION_SQL = `WITH base AS (SELECT NULLIF(user_key, '') AS user_key, event_date, user_id
FROM \`builder-3b0a2.analytics.first_party_analytics_events_raw\`
WHERE event_name = 'session status'
  AND signed_in = 'true'
  AND NULLIF(user_key, '') IS NOT NULL
  AND org_id = 'PlRt3bfcpJNnOyF_Wfgsh'
  AND event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
  AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND LOWER(COALESCE(NULLIF(user_id, ''), '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND LOWER(COALESCE(NULLIF(user_id, ''), '')) LIKE '%@builder.io'))
  AND LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), 'unknown'))
    IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides')),
first_seen AS (SELECT user_key, MIN(event_date) AS cohort_date FROM base GROUP BY user_key),
range_days AS (SELECT CASE '{{timeRange}}' WHEN '7d' THEN 7 WHEN '30d' THEN 30 WHEN '90d' THEN 90 WHEN '180d' THEN 180 WHEN '365d' THEN 365 ELSE 365 END AS n),
anchor_dates AS (
 SELECT date FROM range_days,
 UNNEST(GENERATE_DATE_ARRAY(DATE_SUB(CURRENT_DATE(), INTERVAL n - 1 DAY), CURRENT_DATE())) AS date
),
cohort_windows AS (
 SELECT a.date, f.user_key, f.cohort_date
 FROM anchor_dates a JOIN first_seen f
 ON f.cohort_date >= DATE_SUB(a.date, INTERVAL 6 DAY)
 AND f.cohort_date <= a.date
),
cohort_sizes AS (SELECT date, COUNT(DISTINCT user_key) AS users FROM cohort_windows GROUP BY date),
r1 AS (
 SELECT cw.date, '1-7d return' AS period, COUNT(DISTINCT cw.user_key) AS retained
 FROM cohort_windows cw JOIN base b
 ON b.user_key = cw.user_key
 AND b.event_date > cw.cohort_date
 AND b.event_date <= DATE_ADD(cw.cohort_date, INTERVAL 7 DAY)
 GROUP BY cw.date
),
r2 AS (
 SELECT cw.date, '7-14d return' AS period, COUNT(DISTINCT cw.user_key) AS retained
 FROM cohort_windows cw JOIN base b
 ON b.user_key = cw.user_key
 AND b.event_date >= DATE_ADD(cw.cohort_date, INTERVAL 7 DAY)
 AND b.event_date <= DATE_ADD(cw.cohort_date, INTERVAL 14 DAY)
 GROUP BY cw.date
),
all_r AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2),
periods AS (SELECT '1-7d return' AS period, 7 AS maturity_days UNION ALL SELECT '7-14d return', 14)
SELECT FORMAT_DATE('%Y-%m-%d', a.date) AS date,
 p.period,
 CASE WHEN a.date <= DATE_SUB(CURRENT_DATE(), INTERVAL p.maturity_days DAY)
           AND COALESCE(cs.users, 0) >= 5
      THEN COALESCE(ar.retained, 0)
      ELSE NULL END AS retained_users,
 COALESCE(cs.users, 0) AS cohort_users,
 CASE WHEN a.date <= DATE_SUB(CURRENT_DATE(), INTERVAL p.maturity_days DAY)
           AND COALESCE(cs.users, 0) >= 5
      THEN COALESCE(CAST(ar.retained AS FLOAT64) / NULLIF(cs.users, 0), 0)
      ELSE NULL END AS rate
FROM anchor_dates a CROSS JOIN periods p
LEFT JOIN cohort_sizes cs ON cs.date = a.date
LEFT JOIN all_r ar ON ar.date = a.date AND ar.period = p.period
ORDER BY date, p.period`;

const PRE_CUSTOM_RETENTION_BASE_RANGE =
  "  AND event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)";
const CUSTOM_RETENTION_BASE_RANGE = `  AND event_date >= IF('{{timeRange}}' = 'custom', DATE_SUB(DATE('{{timeRangeStart}}'), INTERVAL 365 DAY), DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY))
  AND event_date <= IF('{{timeRange}}' = 'custom', LEAST(DATE_ADD(LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()), INTERVAL 14 DAY), CURRENT_DATE()), CURRENT_DATE())`;
const PRE_CUSTOM_RETENTION_COVERAGE_RANGE =
  "   AND event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)\n   AND event_date <= CURRENT_DATE()";
const CUSTOM_RETENTION_COVERAGE_RANGE = `   AND event_date >= IF('{{timeRange}}' = 'custom', DATE_SUB(DATE('{{timeRangeStart}}'), INTERVAL 5 DAY), DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY))
   AND event_date <= IF('{{timeRange}}' = 'custom', LEAST(DATE_ADD(LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()), INTERVAL 14 DAY), CURRENT_DATE()), CURRENT_DATE())`;
const PRE_CUSTOM_RETENTION_ANCHOR_RANGE =
  "UNNEST(GENERATE_DATE_ARRAY(DATE_SUB(CURRENT_DATE(), INTERVAL n - 1 DAY), CURRENT_DATE())) AS date";
const CUSTOM_RETENTION_ANCHOR_RANGE =
  "UNNEST(GENERATE_DATE_ARRAY(\n   CASE WHEN '{{timeRange}}' = 'custom' THEN DATE('{{timeRangeStart}}') ELSE DATE_SUB(CURRENT_DATE(), INTERVAL n - 1 DAY) END,\n   CASE WHEN '{{timeRange}}' = 'custom' THEN LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()) ELSE CURRENT_DATE() END\n )) AS date";
const LEGACY_BIGQUERY_RETENTION_TEMPLATE_FILTER =
  "LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), 'unknown'))";
const BIGQUERY_RETENTION_TEMPLATE_FILTER =
  "LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''), 'unknown'))";
const BIGQUERY_RETENTION_IDENTITY_EMAILS_CTE = `identity_emails AS (
 SELECT
   NULLIF(JSON_VALUE(properties, '$.auth_user_id'), '') AS user_key,
   LOWER(ARRAY_AGG(NULLIF(user_id, '') IGNORE NULLS ORDER BY timestamp DESC, user_id DESC LIMIT 1)[SAFE_OFFSET(0)]) AS email
 FROM \`builder-3b0a2.analytics.first_party_analytics_events_raw\`
 WHERE org_id = 'PlRt3bfcpJNnOyF_Wfgsh'
   AND NULLIF(JSON_VALUE(properties, '$.auth_user_id'), '') IS NOT NULL
   AND ${BIGQUERY_RETENTION_TEMPLATE_FILTER} IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides')
   AND event_date >= IF('{{timeRange}}' = 'custom', DATE_SUB(DATE('{{timeRangeStart}}'), INTERVAL 371 DAY), DATE_SUB(CURRENT_DATE(), INTERVAL 371 DAY))
   AND event_date <= CURRENT_DATE()
 GROUP BY 1
)`;
const LEGACY_BIGQUERY_RETENTION_EMAIL_FILTER = `  AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND LOWER(COALESCE(NULLIF(user_id, ''), '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND LOWER(COALESCE(NULLIF(user_id, ''), '')) LIKE '%@builder.io'))`;
const BIGQUERY_RETENTION_IDENTITY_EMAIL_FILTER = `  AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND COALESCE(identity_emails.email, '') NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND COALESCE(identity_emails.email, '') LIKE '%@builder.io'))`;

export const FIRST_PARTY_BIGQUERY_RETENTION_SQL =
  LEGACY_FIRST_PARTY_BIGQUERY_RETENTION_SQL.replace(
    "WITH base AS (",
    `WITH ${BIGQUERY_RETENTION_IDENTITY_EMAILS_CTE},\nbase AS (`,
  )
    .replace(
      LEGACY_BIGQUERY_RETENTION_TEMPLATE_FILTER,
      BIGQUERY_RETENTION_TEMPLATE_FILTER,
    )
    .replace(
      "FROM `builder-3b0a2.analytics.first_party_analytics_events_raw`\nWHERE event_name = 'session status'",
      "FROM `builder-3b0a2.analytics.first_party_analytics_events_raw` AS events\nLEFT JOIN identity_emails ON identity_emails.user_key = NULLIF(JSON_VALUE(events.properties, '$.auth_user_id'), '')\nWHERE event_name = 'session status'",
    )
    .replace(
      LEGACY_BIGQUERY_RETENTION_EMAIL_FILTER,
      BIGQUERY_RETENTION_IDENTITY_EMAIL_FILTER,
    )
    .replace(
      "event_name = 'session status'\n  AND signed_in = 'true'\n  AND NULLIF(user_key, '') IS NOT NULL",
      BIGQUERY_SIGNED_IN_ACTIVITY_FILTER,
    )
    .split("event_name = 'session status'")
    .join(BIGQUERY_SESSION_STATUS_EVENT_FILTER)
    .replace(
      BIGQUERY_SIGNED_IN_ACTIVITY_FILTER,
      BIGQUERY_CONTENT_OR_CHAT_ACTIVITY_FILTER,
    )
    .replace(
      "SELECT NULLIF(user_key, '') AS user_key",
      "SELECT NULLIF(JSON_VALUE(properties, '$.auth_user_id'), '') AS user_key",
    )
    .replace(PRE_CUSTOM_RETENTION_BASE_RANGE, CUSTOM_RETENTION_BASE_RANGE)
    .replace(
      "all_r AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2),\nperiods AS",
      `all_r AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2),\ncoverage_dates AS (\n SELECT DISTINCT event_date\n FROM \`builder-3b0a2.analytics.first_party_analytics_events_raw\`\n WHERE org_id = 'PlRt3bfcpJNnOyF_Wfgsh'\n   AND ${BIGQUERY_CONTENT_OR_CHAT_ACTIVITY_FILTER}\n   AND event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)\n   AND event_date <= CURRENT_DATE()\n),\nperiods AS`,
    )
    .replace(
      PRE_CUSTOM_RETENTION_COVERAGE_RANGE,
      CUSTOM_RETENTION_COVERAGE_RANGE,
    )
    .replace(
      "periods AS (SELECT '1-7d return' AS period, 7 AS maturity_days UNION ALL SELECT '7-14d return', 14)\nSELECT FORMAT_DATE",
      "periods AS (SELECT '1-7d return' AS period, 7 AS maturity_days UNION ALL SELECT '7-14d return', 14),\ncoverage AS (\n SELECT a.date, p.period, COUNTIF(c.event_date IS NOT NULL) AS observed_days, COUNT(*) AS expected_days\n FROM anchor_dates a\n CROSS JOIN periods p\n CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(\n   CASE WHEN p.period = '1-7d return' THEN DATE_SUB(a.date, INTERVAL 5 DAY) ELSE DATE_ADD(a.date, INTERVAL 1 DAY) END,\n   CASE WHEN p.period = '1-7d return' THEN DATE_ADD(a.date, INTERVAL 7 DAY) ELSE DATE_ADD(a.date, INTERVAL 14 DAY) END\n )) AS coverage_day\n LEFT JOIN coverage_dates c ON c.event_date = coverage_day\n GROUP BY a.date, p.period\n)\nSELECT FORMAT_DATE",
    )
    .replace(
      "           AND COALESCE(cs.users, 0) >= 5\n      THEN",
      "           AND COALESCE(cs.users, 0) >= 5\n           AND coverage.observed_days = coverage.expected_days\n      THEN",
    )
    .replace(
      "           AND COALESCE(cs.users, 0) >= 5\n      THEN",
      "           AND COALESCE(cs.users, 0) >= 5\n           AND coverage.observed_days = coverage.expected_days\n      THEN",
    )
    .replace(
      "LEFT JOIN all_r ar ON ar.date = a.date AND ar.period = p.period\nORDER BY",
      "LEFT JOIN all_r ar ON ar.date = a.date AND ar.period = p.period\nLEFT JOIN coverage ON coverage.date = a.date AND coverage.period = p.period\nORDER BY",
    )
    .replace(PRE_CUSTOM_RETENTION_ANCHOR_RANGE, CUSTOM_RETENTION_ANCHOR_RANGE);

export const PREVIOUS_CANONICAL_FIRST_PARTY_BIGQUERY_RETENTION_SQL =
  FIRST_PARTY_BIGQUERY_RETENTION_SQL.split(
    "NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''), ",
  )
    .join("")
    .split("NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''), ")
    .join("")
    .split("NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''), ")
    .join("")
    .replace(
      `   AND ${BIGQUERY_CONTENT_OR_CHAT_ACTIVITY_FILTER}\n${CUSTOM_RETENTION_COVERAGE_RANGE}`,
      CUSTOM_RETENTION_COVERAGE_RANGE,
    );

export const PREVIOUS_PRE_CUSTOM_FIRST_PARTY_BIGQUERY_RETENTION_SQL =
  PREVIOUS_CANONICAL_FIRST_PARTY_BIGQUERY_RETENTION_SQL.replace(
    CUSTOM_RETENTION_BASE_RANGE,
    PRE_CUSTOM_RETENTION_BASE_RANGE,
  )
    .replace(
      CUSTOM_RETENTION_COVERAGE_RANGE,
      PRE_CUSTOM_RETENTION_COVERAGE_RANGE,
    )
    .replace(CUSTOM_RETENTION_ANCHOR_RANGE, PRE_CUSTOM_RETENTION_ANCHOR_RANGE);

const PRE_CUSTOM_FIRST_PARTY_BIGQUERY_RETENTION_SQL =
  FIRST_PARTY_BIGQUERY_RETENTION_SQL.replace(
    CUSTOM_RETENTION_BASE_RANGE,
    PRE_CUSTOM_RETENTION_BASE_RANGE,
  )
    .replace(
      CUSTOM_RETENTION_COVERAGE_RANGE,
      PRE_CUSTOM_RETENTION_COVERAGE_RANGE,
    )
    .replace(CUSTOM_RETENTION_ANCHOR_RANGE, PRE_CUSTOM_RETENTION_ANCHOR_RANGE);

export const PRE_CUSTOM_FIRST_PARTY_BIGQUERY_RETENTION_WITH_LAST_VALID_SQL =
  LEGACY_FIRST_PARTY_BIGQUERY_RETENTION_SQL.replace(
    "all_r AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2),\nperiods AS",
    "all_r AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2),\ncoverage_dates AS (\n SELECT DISTINCT event_date\n FROM `builder-3b0a2.analytics.first_party_analytics_events_raw`\n WHERE org_id = 'PlRt3bfcpJNnOyF_Wfgsh'\n   AND event_name = 'session status'\n   AND event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)\n   AND event_date <= CURRENT_DATE()\n),\nperiods AS",
  )
    .replace(
      "periods AS (SELECT '1-7d return' AS period, 7 AS maturity_days UNION ALL SELECT '7-14d return', 14)\nSELECT FORMAT_DATE",
      "periods AS (SELECT '1-7d return' AS period, 7 AS maturity_days UNION ALL SELECT '7-14d return', 14),\ncoverage AS (\n SELECT a.date, p.period, COUNTIF(c.event_date IS NOT NULL) AS observed_days, COUNT(*) AS expected_days\n FROM anchor_dates a\n CROSS JOIN periods p\n CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(\n   CASE WHEN p.period = '1-7d return' THEN DATE_SUB(a.date, INTERVAL 5 DAY) ELSE DATE_ADD(a.date, INTERVAL 1 DAY) END,\n   CASE WHEN p.period = '1-7d return' THEN DATE_ADD(a.date, INTERVAL 7 DAY) ELSE DATE_ADD(a.date, INTERVAL 14 DAY) END\n )) AS coverage_day\n LEFT JOIN coverage_dates c ON c.event_date = coverage_day\n GROUP BY a.date, p.period\n), last_valid AS (\n SELECT MAX(a.date) AS date\n FROM anchor_dates a\n CROSS JOIN periods p\n LEFT JOIN cohort_sizes cs ON cs.date = a.date\n LEFT JOIN coverage ON coverage.date = a.date AND coverage.period = p.period\n WHERE a.date <= DATE_SUB(CURRENT_DATE(), INTERVAL p.maturity_days DAY)\n   AND COALESCE(cs.users, 0) >= 5\n   AND coverage.observed_days = coverage.expected_days\n)\nSELECT FORMAT_DATE",
    )
    .replace(
      "           AND COALESCE(cs.users, 0) >= 5\n      THEN",
      "           AND COALESCE(cs.users, 0) >= 5\n           AND coverage.observed_days = coverage.expected_days\n      THEN",
    )
    .replace(
      "           AND COALESCE(cs.users, 0) >= 5\n      THEN",
      "           AND COALESCE(cs.users, 0) >= 5\n           AND coverage.observed_days = coverage.expected_days\n      THEN",
    )
    .replace(
      "LEFT JOIN all_r ar ON ar.date = a.date AND ar.period = p.period\nORDER BY",
      "LEFT JOIN all_r ar ON ar.date = a.date AND ar.period = p.period\nLEFT JOIN coverage ON coverage.date = a.date AND coverage.period = p.period\nWHERE a.date <= last_valid.date\nORDER BY",
    )
    .replace(
      "SELECT FORMAT_DATE('%Y-%m-%d', a.date) AS date,",
      "SELECT FORMAT_DATE('%b %d', a.date) AS date,",
    )
    .replace(
      "FROM anchor_dates a CROSS JOIN periods p\nLEFT JOIN cohort_sizes",
      "FROM anchor_dates a CROSS JOIN periods p CROSS JOIN last_valid\nLEFT JOIN cohort_sizes",
    );

const MALFORMED_FIRST_PARTY_BIGQUERY_WAU_SQL =
  FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
    "WHEN '{{timeRange}}' = '7d'",
    "WHEN '{{timeRange}}' = '{{timeRange}}'",
  );

const LEGACY_FIRST_PARTY_BIGQUERY_WAU_SQL =
  FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
    `    AND ${BIGQUERY_SIGNED_IN_ACTIVITY_FILTER}`,
    "    AND event_name = 'session status'\n    AND signed_in = 'true'\n    AND NULLIF(user_key, '') IS NOT NULL",
  );
const PRE_CUSTOM_MALFORMED_FIRST_PARTY_BIGQUERY_WAU_SQL =
  PRE_CUSTOM_FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
    "WHEN '{{timeRange}}' = '7d'",
    "WHEN '{{timeRange}}' = '{{timeRange}}'",
  );
const PRE_CUSTOM_LEGACY_FIRST_PARTY_BIGQUERY_WAU_SQL =
  PRE_CUSTOM_FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
    `    AND ${BIGQUERY_SIGNED_IN_ACTIVITY_FILTER}`,
    "    AND event_name = 'session status'\n    AND signed_in = 'true'\n    AND NULLIF(user_key, '') IS NOT NULL",
  );

function isMalformedFirstPartyBigQueryWauSql(sql: string): boolean {
  return (
    sql.trim() === MALFORMED_FIRST_PARTY_BIGQUERY_WAU_SQL.trim() ||
    sql.trim() === PRE_CUSTOM_MALFORMED_FIRST_PARTY_BIGQUERY_WAU_SQL.trim()
  );
}

function isLegacyFirstPartyBigQueryWauSql(sql: string): boolean {
  return [
    LEGACY_FIRST_PARTY_BIGQUERY_WAU_SQL,
    PRE_CUSTOM_FIRST_PARTY_BIGQUERY_WAU_SQL,
    PRE_CUSTOM_LEGACY_FIRST_PARTY_BIGQUERY_WAU_SQL,
  ].some(
    (legacySql) =>
      sql.replace(/\s+/g, " ").trim() === legacySql.replace(/\s+/g, " ").trim(),
  );
}

function repairFirstPartyBigQueryDauSql(sql: string): string {
  return sql
    .replace(
      /event_name = 'session status'\s+AND signed_in = 'true'\s+AND NULLIF\(user_key, ''\) IS NOT NULL/g,
      BIGQUERY_SIGNED_IN_ACTIVITY_FILTER,
    )
    .split("event_name = 'session status'")
    .join(BIGQUERY_SESSION_STATUS_EVENT_FILTER);
}

function isLegacyFirstPartyBigQueryRetentionSql(sql: string): boolean {
  return [
    LEGACY_FIRST_PARTY_BIGQUERY_RETENTION_SQL,
    PREVIOUS_CANONICAL_FIRST_PARTY_BIGQUERY_RETENTION_SQL,
    PREVIOUS_PRE_CUSTOM_FIRST_PARTY_BIGQUERY_RETENTION_SQL,
    PRE_CUSTOM_FIRST_PARTY_BIGQUERY_RETENTION_SQL,
    PRE_CUSTOM_FIRST_PARTY_BIGQUERY_RETENTION_WITH_LAST_VALID_SQL,
  ].some(
    (legacySql) =>
      sql.replace(/\s+/g, " ").trim() === legacySql.replace(/\s+/g, " ").trim(),
  );
}

export function repairFirstPartyBigQueryDashboardQueries(
  config: Record<string, unknown>,
): { config: Record<string, unknown>; changed: boolean } {
  if (!Array.isArray(config.panels)) return { config, changed: false };

  let changed = false;
  const panels = config.panels.map((rawPanel) => {
    if (!rawPanel || typeof rawPanel !== "object") return rawPanel;
    const panel = rawPanel as Record<string, unknown>;
    if (
      panel.id === "retention-over-time" &&
      panel.source === "bigquery" &&
      typeof panel.sql === "string" &&
      (panel.sql.trim() === "" ||
        isLegacyFirstPartyBigQueryRetentionSql(panel.sql))
    ) {
      changed = true;
      return { ...panel, sql: FIRST_PARTY_BIGQUERY_RETENTION_SQL };
    }
    if (
      panel.id === "dau-over-time" &&
      panel.source === "bigquery" &&
      typeof panel.sql === "string"
    ) {
      const repairedSql = repairFirstPartyBigQueryDauSql(panel.sql);
      if (repairedSql !== panel.sql) {
        changed = true;
        return { ...panel, sql: repairedSql };
      }
    }
    if (
      panel.id !== "wau-over-time" ||
      panel.source !== "bigquery" ||
      typeof panel.sql !== "string" ||
      (panel.sql.trim() !== "" &&
        !isMalformedFirstPartyBigQueryWauSql(panel.sql) &&
        !isLegacyFirstPartyBigQueryWauSql(panel.sql))
    ) {
      return rawPanel;
    }
    changed = true;
    return { ...panel, sql: FIRST_PARTY_BIGQUERY_WAU_SQL };
  });

  return changed
    ? { config: { ...config, panels }, changed }
    : { config, changed };
}

export const LEGACY_NEW_VS_RECURRING_USERS_SQL = `WITH all_users AS (SELECT NULLIF(user_key, '') AS user_key, event_date, user_id FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'docs' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))), first_seen AS (SELECT user_key, MIN(event_date) AS first_date FROM all_users GROUP BY user_key), daily AS (SELECT a.event_date AS date, CASE WHEN a.event_date = f.first_date THEN 'New' ELSE 'Recurring' END AS user_type, COUNT(DISTINCT a.user_key) AS users FROM all_users a JOIN first_seen f ON f.user_key = a.user_key WHERE ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))) GROUP BY 1, 2) SELECT date, user_type, users FROM daily ORDER BY date, CASE WHEN user_type = 'Recurring' THEN 0 ELSE 1 END`;
const LEGACY_NEW_VS_RECURRING_USERS_DESCRIPTION =
  "Daily signed-in visitors split by first-ever session (New) vs return visit (Recurring), stacked with Recurring on the bottom and New on top. Docs excluded. A user is New only on their all-time first active day.";
const BOUNDED_NEW_VS_RECURRING_USERS_SQL = `WITH first_seen AS (SELECT NULLIF(user_key, '') AS user_key, MIN(event_date) AS first_date FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'docs' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io')) AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') GROUP BY 1), activity AS (SELECT NULLIF(user_key, '') AS user_key, event_date FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'docs' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io')) AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')))), daily AS (SELECT a.event_date AS date, CASE WHEN a.event_date = f.first_date THEN 'New' ELSE 'Recurring' END AS user_type, COUNT(DISTINCT a.user_key) AS users FROM activity a JOIN first_seen f ON f.user_key = a.user_key GROUP BY 1, 2) SELECT date, user_type, users FROM daily ORDER BY date, CASE WHEN user_type = 'Recurring' THEN 0 ELSE 1 END`;
const MARKETING_SITE_TEMPLATE_FILTER =
  "lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'www'";
const NEW_VS_TEMPLATE_EXPRESSION =
  "COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')";
const FIRST_PARTY_NEW_VS_TEMPLATE_FILTER = firstPartyTemplateFilter(
  NEW_VS_TEMPLATE_EXPRESSION,
);
export const DEPLOYED_NEW_VS_RECURRING_USERS_SQL =
  BOUNDED_NEW_VS_RECURRING_USERS_SQL.split(" <> 'docs' AND ").join(
    ` <> 'docs' AND ${FIRST_PARTY_NEW_VS_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND `,
  );
const NEW_VS_RECURRING_USERS_SQL = `WITH activity AS (SELECT NULLIF(user_key, '') AS user_key, event_date, MIN(event_date) OVER (PARTITION BY NULLIF(user_key, '')) AS first_date FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'docs' AND ${FIRST_PARTY_NEW_VS_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io')) AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')), daily AS (SELECT event_date AS date, CASE WHEN event_date = first_date THEN 'New' ELSE 'Recurring' END AS user_type, COUNT(DISTINCT user_key) AS users FROM activity WHERE ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))) GROUP BY 1, 2) SELECT date, user_type, users FROM daily ORDER BY date, CASE WHEN user_type = 'Recurring' THEN 0 ELSE 1 END`;
const NEW_VS_RECURRING_USERS_DESCRIPTION =
  "Daily signed-in visitors split by first active day observed in the previous 365 days (New) vs return visit (Recurring), stacked with Recurring on the bottom and New on top. Docs and marketing-site traffic are excluded.";

type FingerprintedPanelReplacement = {
  id: string;
  source: "first-party" | "bigquery";
  sha256: string;
  sql: string;
};

// Exact normalized query fingerprints from origin/main@452757b243ef, retained
// after refreshing the catalog and shipped seed removed these signatures.
const ORIGIN_MAIN_PANEL_REPLACEMENTS: readonly FingerprintedPanelReplacement[] =
  [
    {
      id: "retention-over-time",
      source: "first-party",
      sha256:
        "974b66473d3a9590bdaa9ccb6df9da2fc149008e07ce9838e56dcc8a478d6f6f",
      sql: buildPanel("retention-over-time")!.sql,
    },
    {
      id: "retention-over-time",
      source: "first-party",
      sha256:
        "b395a694889d393d889ced4a79d936e17cb58af88b856670a393cba91e3cf83d",
      sql: buildPanel("retention-over-time")!.sql,
    },
    {
      id: "one-day-retention-by-template",
      source: "first-party",
      sha256:
        "84049de619edfca2a8ce10f2da0f6acf674aa504eca65c242a4e76ffd0b22bf1",
      sql: buildPanel("one-day-retention-by-template")!.sql,
    },
    {
      id: "seven-day-retention-by-template",
      source: "first-party",
      sha256:
        "3e8993b8d56fd33a3883bb57f832bbb539ee9750a563fe1b21eb10e12aec7966",
      sql: buildPanel("seven-day-retention-by-template")!.sql,
    },
    {
      id: "activation-funnel",
      source: "first-party",
      sha256:
        "ba2e861c2044e2fec669bcb15a878a675eaf426f51bcfe4db32ebd228d2050f0",
      sql: buildPanel("activation-funnel")!.sql,
    },
    {
      id: "retention-over-time",
      source: "bigquery",
      sha256:
        "d7b7a0400b5f1228dade65d89a9b576d5d98e387b8818b0177c6744805ea9b23",
      sql: FIRST_PARTY_BIGQUERY_RETENTION_SQL,
    },
  ];

function fingerprintPanelSql(sql: string): string {
  return createHash("sha256")
    .update(sql.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function repairFingerprintedPanelQueries(
  config: Record<string, unknown>,
  replacements: readonly FingerprintedPanelReplacement[],
): { config: Record<string, unknown>; changed: boolean } {
  if (!Array.isArray(config.panels)) return { config, changed: false };

  let changed = false;
  const panels = config.panels.map((rawPanel) => {
    if (!rawPanel || typeof rawPanel !== "object") return rawPanel;
    const panel = rawPanel as Record<string, unknown>;
    if (
      typeof panel.id !== "string" ||
      (panel.source !== "first-party" && panel.source !== "bigquery") ||
      typeof panel.sql !== "string"
    ) {
      return rawPanel;
    }
    const fingerprint = fingerprintPanelSql(panel.sql);
    const replacement = replacements.find(
      (candidate) =>
        candidate.id === panel.id &&
        candidate.source === panel.source &&
        candidate.sha256 === fingerprint,
    );
    if (!replacement) return rawPanel;

    changed = true;
    return { ...panel, sql: replacement.sql };
  });

  return changed
    ? { config: { ...config, panels }, changed }
    : { config, changed };
}

const CANONICAL_CUSTOM_PANEL_REPLACEMENTS: readonly ExactFirstPartyPanelReplacement[] =
  [
    {
      id: "signups-over-time",
      legacySql: [
        LEGACY_SEED_SIGNUPS_OVER_TIME_SQL,
        LEGACY_SIGNUPS_OVER_TIME_SQL,
        PRE_CUSTOM_SPINE_SIGNUPS_OVER_TIME_SQL,
        PRE_CAPPED_SIGNUPS_OVER_TIME_SQL,
      ],
      sql: SIGNUPS_OVER_TIME_SQL,
    },
    {
      id: "retention-over-time",
      legacySql: [
        PRE_COHORT_HISTORY_RETENTION_OVER_TIME_SQL,
        PRE_CAPPED_RETENTION_OVER_TIME_SQL,
        PRE_SOURCE_SCAN_BOUNDS_RETENTION_OVER_TIME_SQL,
      ],
      sql: buildPanel("retention-over-time")!.sql,
    },
    {
      id: "new-vs-recurring-users",
      legacySql: [
        LEGACY_NEW_VS_RECURRING_USERS_SQL,
        BOUNDED_NEW_VS_RECURRING_USERS_SQL,
        DEPLOYED_NEW_VS_RECURRING_USERS_SQL,
      ],
      sql: NEW_VS_RECURRING_USERS_SQL,
      legacyDescription: LEGACY_NEW_VS_RECURRING_USERS_DESCRIPTION,
      description: NEW_VS_RECURRING_USERS_DESCRIPTION,
    },
  ];

function removeCustomDateRangeClauses(sql: string): string {
  return sql.replace(
    /\s+OR \('\{\{timeRange\}\}' = 'custom' AND [\s\S]*? <= '\{\{timeRangeEnd\}\}'\)/g,
    "",
  );
}

const CANONICAL_CATALOG_PANEL_REPLACEMENTS: readonly ExactFirstPartyPanelReplacement[] =
  (() => {
    const seed = loadDashboardSeed(FIRST_PARTY_DASHBOARD_ID);
    if (!seed || !Array.isArray(seed.panels)) return [];
    const scopedMetricKeys = new Set<string>(
      FIRST_PARTY_TEMPLATE_SCOPED_METRIC_KEYS,
    );
    return seed.panels.flatMap((rawPanel) => {
      if (!rawPanel || typeof rawPanel !== "object") return [];
      const panel = rawPanel as Record<string, unknown>;
      const id = typeof panel.id === "string" ? panel.id : "";
      const seededSql = typeof panel.sql === "string" ? panel.sql : "";
      if (!scopedMetricKeys.has(id)) return [];
      const catalogPanel = id ? buildPanel(id) : null;
      if (!catalogPanel) return [];
      const legacySql = new Set<string>();
      if (seededSql && catalogPanel.sql !== seededSql) legacySql.add(seededSql);
      const priorCustomRangeSql = removeCustomDateRangeClauses(
        catalogPanel.sql,
      );
      if (priorCustomRangeSql !== catalogPanel.sql)
        legacySql.add(priorCustomRangeSql);
      if (legacySql.size === 0) return [];
      return [
        {
          id,
          legacySql: [...legacySql],
          sql: catalogPanel.sql,
        },
      ];
    });
  })();

export function repairCanonicalFirstPartyDashboardQueries(
  config: Record<string, unknown>,
) {
  const historical = repairFingerprintedPanelQueries(
    config,
    ORIGIN_MAIN_PANEL_REPLACEMENTS.filter(
      (replacement) => replacement.source === "first-party",
    ),
  );
  const repaired = repairFirstPartyObservedRetentionPanels(historical.config, [
    ...CANONICAL_CUSTOM_PANEL_REPLACEMENTS,
    ...CANONICAL_CATALOG_PANEL_REPLACEMENTS,
  ]);
  return historical.changed && !repaired.changed
    ? { ...repaired, changed: true }
    : repaired;
}

export function repairKnownFirstPartyDashboardQueries(
  dashboardId: string,
  config: Record<string, unknown>,
): { config: Record<string, unknown>; changed: boolean } {
  if (dashboardId === FIRST_PARTY_BIGQUERY_DASHBOARD_ID) {
    const historical = repairFingerprintedPanelQueries(
      config,
      ORIGIN_MAIN_PANEL_REPLACEMENTS.filter(
        (replacement) => replacement.source === "bigquery",
      ),
    );
    const repaired = repairFirstPartyBigQueryDashboardQueries(
      historical.config,
    );
    return historical.changed && !repaired.changed
      ? { ...repaired, changed: true }
      : repaired;
  }
  if (dashboardId === FIRST_PARTY_DASHBOARD_ID) {
    return repairCanonicalFirstPartyDashboardQueries(config);
  }
  return { config, changed: false };
}
