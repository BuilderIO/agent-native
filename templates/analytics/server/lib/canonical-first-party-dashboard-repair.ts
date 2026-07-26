import {
  LEGACY_SIGNUPS_OVER_TIME_SQL,
  LEGACY_SEED_SIGNUPS_OVER_TIME_SQL,
  SIGNUPS_OVER_TIME_SQL,
  type ExactFirstPartyPanelReplacement,
  repairFirstPartyObservedRetentionPanels,
} from "./first-party-metric-catalog";

export const LEGACY_NEW_VS_RECURRING_USERS_SQL = `WITH all_users AS (SELECT NULLIF(user_key, '') AS user_key, event_date, user_id FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'docs' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))), first_seen AS (SELECT user_key, MIN(event_date) AS first_date FROM all_users GROUP BY user_key), daily AS (SELECT a.event_date AS date, CASE WHEN a.event_date = f.first_date THEN 'New' ELSE 'Recurring' END AS user_type, COUNT(DISTINCT a.user_key) AS users FROM all_users a JOIN first_seen f ON f.user_key = a.user_key WHERE ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND a.event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))) GROUP BY 1, 2) SELECT date, user_type, users FROM daily ORDER BY date, CASE WHEN user_type = 'Recurring' THEN 0 ELSE 1 END`;
const LEGACY_NEW_VS_RECURRING_USERS_DESCRIPTION =
  "Daily signed-in visitors split by first-ever session (New) vs return visit (Recurring), stacked with Recurring on the bottom and New on top. Docs excluded. A user is New only on their all-time first active day.";
const NEW_VS_RECURRING_USERS_SQL = `WITH first_seen AS (SELECT NULLIF(user_key, '') AS user_key, MIN(event_date) AS first_date FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'docs' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io')) AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') GROUP BY 1), activity AS (SELECT NULLIF(user_key, '') AS user_key, event_date FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), 'unknown')) <> 'docs' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io')) AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')))), daily AS (SELECT a.event_date AS date, CASE WHEN a.event_date = f.first_date THEN 'New' ELSE 'Recurring' END AS user_type, COUNT(DISTINCT a.user_key) AS users FROM activity a JOIN first_seen f ON f.user_key = a.user_key GROUP BY 1, 2) SELECT date, user_type, users FROM daily ORDER BY date, CASE WHEN user_type = 'Recurring' THEN 0 ELSE 1 END`;
const NEW_VS_RECURRING_USERS_DESCRIPTION =
  "Daily signed-in visitors split by first active day observed in the previous 365 days (New) vs return visit (Recurring), stacked with Recurring on the bottom and New on top. Docs excluded.";

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
      legacySql: [LEGACY_NEW_VS_RECURRING_USERS_SQL],
      sql: NEW_VS_RECURRING_USERS_SQL,
      legacyDescription: LEGACY_NEW_VS_RECURRING_USERS_DESCRIPTION,
      description: NEW_VS_RECURRING_USERS_DESCRIPTION,
    },
  ];

export function repairCanonicalFirstPartyDashboardQueries(
  config: Record<string, unknown>,
) {
  return repairFirstPartyObservedRetentionPanels(
    config,
    CANONICAL_CUSTOM_PANEL_REPLACEMENTS,
  );
}
