import { loadDashboardSeed } from "./dashboard-seeds";
import {
  buildPanel,
  FIRST_PARTY_DASHBOARD_ID,
  FIRST_PARTY_TEMPLATE_SCOPED_METRIC_KEYS,
  firstPartyTemplateFilter,
  LEGACY_SIGNUPS_OVER_TIME_SQL,
  LEGACY_SEED_SIGNUPS_OVER_TIME_SQL,
  SIGNUPS_OVER_TIME_SQL,
  type ExactFirstPartyPanelReplacement,
  repairFirstPartyObservedRetentionPanels,
} from "./first-party-metric-catalog";

export const FIRST_PARTY_BIGQUERY_DASHBOARD_ID =
  "agent-native-templates-first-party-bigquery-v2";

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
    AND event_name = 'session status'
    AND signed_in = 'true'
    AND NULLIF(user_key, '') IS NOT NULL
    AND ('{{emailFilter}}' IN ('', 'all')
      OR ('{{emailFilter}}' = 'exclude_builder' AND LOWER(COALESCE(user_id, '')) NOT LIKE '%@builder.io')
      OR ('{{emailFilter}}' = 'only_builder' AND LOWER(COALESCE(user_id, '')) LIKE '%@builder.io'))
    AND ('{{appFilter}}' IN ('', 'all')
      OR LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''), 'unknown')) = LOWER('{{appFilter}}'))
    AND LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''), 'unknown')) IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides')
    AND ('{{timeRange}}' IN ('', 'all') OR event_date >= CASE
      WHEN '{{timeRange}}' = '7d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 13 DAY)
      WHEN '{{timeRange}}' = '30d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 36 DAY)
      WHEN '{{timeRange}}' = '90d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 96 DAY)
      WHEN '{{timeRange}}' = '180d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 186 DAY)
      WHEN '{{timeRange}}' = '365d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 371 DAY)
      ELSE DATE_SUB(CURRENT_DATE(), INTERVAL 96 DAY)
    END)
    AND event_date <= CURRENT_DATE()
), date_spine AS (
  SELECT date
  FROM UNNEST(GENERATE_DATE_ARRAY(
    CASE
      WHEN '{{timeRange}}' = '7d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY)
      WHEN '{{timeRange}}' = '30d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY)
      WHEN '{{timeRange}}' = '90d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 89 DAY)
      WHEN '{{timeRange}}' = '180d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 179 DAY)
      WHEN '{{timeRange}}' = '365d' THEN DATE_SUB(CURRENT_DATE(), INTERVAL 364 DAY)
      WHEN '{{timeRange}}' IN ('', 'all') THEN COALESCE((SELECT MIN(event_date) FROM base), CURRENT_DATE())
      ELSE DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    END,
    CURRENT_DATE()
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

export const FIRST_PARTY_BIGQUERY_RETENTION_SQL =
  LEGACY_FIRST_PARTY_BIGQUERY_RETENTION_SQL.replace(
    "all_r AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2),\nperiods AS",
    "all_r AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2),\ncoverage_dates AS (\n SELECT DISTINCT event_date\n FROM `builder-3b0a2.analytics.first_party_analytics_events_raw`\n WHERE org_id = 'PlRt3bfcpJNnOyF_Wfgsh'\n   AND event_name = 'session status'\n   AND event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)\n   AND event_date <= CURRENT_DATE()\n),\nperiods AS",
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
    );

const MALFORMED_FIRST_PARTY_BIGQUERY_WAU_SQL =
  FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
    "WHEN '{{timeRange}}' = '7d'",
    "WHEN '{{timeRange}}' = '{{timeRange}}'",
  );

function isMalformedFirstPartyBigQueryWauSql(sql: string): boolean {
  return sql.trim() === MALFORMED_FIRST_PARTY_BIGQUERY_WAU_SQL.trim();
}

function isLegacyFirstPartyBigQueryRetentionSql(sql: string): boolean {
  return (
    sql.replace(/\s+/g, " ").trim() ===
    LEGACY_FIRST_PARTY_BIGQUERY_RETENTION_SQL.replace(/\s+/g, " ").trim()
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
      panel.id !== "wau-over-time" ||
      panel.source !== "bigquery" ||
      typeof panel.sql !== "string" ||
      (panel.sql.trim() !== "" &&
        !isMalformedFirstPartyBigQueryWauSql(panel.sql))
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
// Keep cohort classification in one raw-table scan. Separate first-seen and
// activity scans double the random heap reads on the growing event table.
const NEW_VS_RECURRING_USERS_SQL = `WITH activity AS (SELECT NULLIF(user_key, '') AS user_key, event_date, MIN(event_date) OVER (PARTITION BY NULLIF(user_key, '')) AS first_date FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'docs' AND ${FIRST_PARTY_NEW_VS_TEMPLATE_FILTER} AND ${MARKETING_SITE_TEMPLATE_FILTER} AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io')) AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')), daily AS (SELECT event_date AS date, CASE WHEN event_date = first_date THEN 'New' ELSE 'Recurring' END AS user_type, COUNT(DISTINCT user_key) AS users FROM activity WHERE ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))) GROUP BY 1, 2) SELECT date, user_type, users FROM daily ORDER BY date, CASE WHEN user_type = 'Recurring' THEN 0 ELSE 1 END`;
const NEW_VS_RECURRING_USERS_DESCRIPTION =
  "Daily signed-in visitors split by first active day observed in the previous 365 days (New) vs return visit (Recurring), stacked with Recurring on the bottom and New on top. Docs and marketing-site traffic are excluded.";

const CANONICAL_CUSTOM_PANEL_REPLACEMENTS: readonly ExactFirstPartyPanelReplacement[] =
  [
    {
      id: "signups-over-time",
      legacySql: [
        LEGACY_SEED_SIGNUPS_OVER_TIME_SQL,
        LEGACY_SIGNUPS_OVER_TIME_SQL,
      ],
      sql: SIGNUPS_OVER_TIME_SQL,
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
      const legacySql = typeof panel.sql === "string" ? panel.sql : "";
      if (!scopedMetricKeys.has(id)) return [];
      const catalogPanel = id ? buildPanel(id) : null;
      if (!catalogPanel || !legacySql || catalogPanel.sql === legacySql) {
        return [];
      }
      return [
        {
          id,
          legacySql: [legacySql],
          sql: catalogPanel.sql,
        },
      ];
    });
  })();

export function repairCanonicalFirstPartyDashboardQueries(
  config: Record<string, unknown>,
) {
  return repairFirstPartyObservedRetentionPanels(config, [
    ...CANONICAL_CUSTOM_PANEL_REPLACEMENTS,
    ...CANONICAL_CATALOG_PANEL_REPLACEMENTS,
  ]);
}

export function repairKnownFirstPartyDashboardQueries(
  dashboardId: string,
  config: Record<string, unknown>,
): { config: Record<string, unknown>; changed: boolean } {
  if (dashboardId === FIRST_PARTY_BIGQUERY_DASHBOARD_ID) {
    return repairFirstPartyBigQueryDashboardQueries(config);
  }
  if (dashboardId === FIRST_PARTY_DASHBOARD_ID) {
    return repairCanonicalFirstPartyDashboardQueries(config);
  }
  return { config, changed: false };
}
