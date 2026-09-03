import type { Dialect } from "@agent-native/core/db";

import type { DashboardPanelLike } from "./dashboard-time-scope.js";

const POSTGRES_DATE_BOUND =
  "to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')";
const SQLITE_DATE_BOUND = "date('now', '-365 days')";

/**
 * Fixes for first-party dashboard panels found, via a full-org audit
 * (2026-07-25), reading `analytics_events` with no date bound at all in some
 * or all of their scan units — a full 6.7M-row table scan on every render.
 * Unlike the id-keyed replacements in first-party-metric-catalog.ts (which
 * repair one specific dashboard's known panel ids), these are matched purely
 * by exact SQL text so the same fix applies wherever the identical broken
 * query was cloned into a different dashboard under a different panel id.
 * Each entry only changes the added bound (`AND event_date >= ...365 days`,
 * or the exact same bound already live on the repaired canonical dashboard
 * for the retention-cohort case) — never the query's selected columns,
 * grouping, or business logic.
 */
export type UnboundedFirstPartyPanelFix = {
  legacySql: string;
  sql: string;
};

function dialectBoundedSql(sql: string, dialect: Dialect): string {
  return dialect === "postgres"
    ? sql
    : sql.split(POSTGRES_DATE_BOUND).join(SQLITE_DATE_BOUND);
}

export const UNBOUNDED_FIRST_PARTY_PANEL_FIXES: readonly UnboundedFirstPartyPanelFix[] =
  [
    {
      legacySql:
        "SELECT event_date AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' GROUP BY event_date ORDER BY date",
      sql: "SELECT event_date AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') GROUP BY event_date ORDER BY date",
    },
    {
      legacySql:
        "SELECT COALESCE(NULLIF(signed_in, ''), 'unknown') AS signed_in, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' GROUP BY COALESCE(NULLIF(signed_in, ''), 'unknown') ORDER BY signed_in",
      sql: "SELECT COALESCE(NULLIF(signed_in, ''), 'unknown') AS signed_in, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') GROUP BY COALESCE(NULLIF(signed_in, ''), 'unknown') ORDER BY signed_in",
    },
    {
      legacySql:
        "SELECT COALESCE(NULLIF(app, ''), 'unknown') AS app, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' GROUP BY COALESCE(NULLIF(app, ''), 'unknown') ORDER BY count DESC LIMIT 20",
      sql: "SELECT COALESCE(NULLIF(app, ''), 'unknown') AS app, COUNT(*) AS count FROM analytics_events WHERE event_name = 'session status' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') GROUP BY COALESCE(NULLIF(app, ''), 'unknown') ORDER BY count DESC LIMIT 20",
    },
    {
      legacySql:
        "SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'skills_cli started'",
      sql: "SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'skills_cli started' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')",
    },
    {
      legacySql:
        "SELECT COUNT(DISTINCT anonymous_id) AS count FROM analytics_events WHERE event_name LIKE 'skills_cli %'",
      sql: "SELECT COUNT(DISTINCT anonymous_id) AS count FROM analytics_events WHERE event_name LIKE 'skills_cli %' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')",
    },
    {
      legacySql:
        "SELECT COUNT(DISTINCT session_id) AS count FROM analytics_events WHERE event_name = 'skills_cli install completed'",
      sql: "SELECT COUNT(DISTINCT session_id) AS count FROM analytics_events WHERE event_name = 'skills_cli install completed' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')",
    },
    {
      legacySql:
        "WITH started AS (SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE event_name = 'skills_cli started'), completed AS (SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE event_name = 'skills_cli install completed') SELECT CASE WHEN started.n = 0 THEN 0 ELSE ROUND(completed.n * 100.0 / started.n) END AS rate FROM started, completed",
      sql: "WITH started AS (SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE event_name = 'skills_cli started' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')), completed AS (SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE event_name = 'skills_cli install completed' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')) SELECT CASE WHEN started.n = 0 THEN 0 ELSE ROUND(completed.n * 100.0 / started.n) END AS rate FROM started, completed",
    },
    {
      legacySql:
        "WITH steps AS (SELECT 1 AS step_order, 'Started' AS step, COUNT(DISTINCT session_id) AS count FROM analytics_events WHERE event_name = 'skills_cli started' UNION ALL SELECT 2, 'Skills prompted', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli skills prompted' UNION ALL SELECT 3, 'Skills selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli skills selected' UNION ALL SELECT 4, 'Clients selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli clients selected' UNION ALL SELECT 5, 'Scope selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli scope selected' UNION ALL SELECT 6, 'Install completed', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli install completed' UNION ALL SELECT 7, 'Completed', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli completed') SELECT step, count FROM steps ORDER BY step_order",
      sql: "WITH steps AS (SELECT 1 AS step_order, 'Started' AS step, COUNT(DISTINCT session_id) AS count FROM analytics_events WHERE event_name = 'skills_cli started' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 2, 'Skills prompted', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli skills prompted' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 3, 'Skills selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli skills selected' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 4, 'Clients selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli clients selected' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 5, 'Scope selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli scope selected' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 6, 'Install completed', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli install completed' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 7, 'Completed', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli completed' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')) SELECT step, count FROM steps ORDER BY step_order",
    },
    {
      legacySql:
        "SELECT trim(s) AS skill, COUNT(*) AS count FROM analytics_events, LATERAL unnest(string_to_array(properties::jsonb ->> 'selected', ',')) AS s WHERE event_name = 'skills_cli skills selected' AND (properties::jsonb ->> 'selected') <> '' GROUP BY trim(s) ORDER BY count DESC LIMIT 30",
      sql: "SELECT trim(s) AS skill, COUNT(*) AS count FROM analytics_events, LATERAL unnest(string_to_array(properties::jsonb ->> 'selected', ',')) AS s WHERE event_name = 'skills_cli skills selected' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') AND (properties::jsonb ->> 'selected') <> '' GROUP BY trim(s) ORDER BY count DESC LIMIT 30",
    },
    {
      legacySql:
        "SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS count FROM analytics_events WHERE event_name = 'skills_cli started' GROUP BY substr(timestamp, 1, 10) ORDER BY date",
      sql: "SELECT substr(timestamp, 1, 10) AS date, COUNT(*) AS count FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') AND event_name = 'skills_cli started' GROUP BY substr(timestamp, 1, 10) ORDER BY date",
    },
    {
      legacySql:
        "SELECT COALESCE(NULLIF(properties::jsonb ->> 'cli', ''), 'unknown') AS cli, COUNT(*) AS count FROM analytics_events WHERE event_name = 'skills_cli started' GROUP BY COALESCE(NULLIF(properties::jsonb ->> 'cli', ''), 'unknown') ORDER BY count DESC",
      sql: "SELECT COALESCE(NULLIF(properties::jsonb ->> 'cli', ''), 'unknown') AS cli, COUNT(*) AS count FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') AND event_name = 'skills_cli started' GROUP BY COALESCE(NULLIF(properties::jsonb ->> 'cli', ''), 'unknown') ORDER BY count DESC",
    },
    {
      legacySql:
        "SELECT COALESCE(NULLIF(properties::jsonb ->> 'platform', ''), 'unknown') AS platform, COUNT(*) AS count FROM analytics_events WHERE event_name = 'skills_cli started' GROUP BY COALESCE(NULLIF(properties::jsonb ->> 'platform', ''), 'unknown') ORDER BY count DESC",
      sql: "SELECT COALESCE(NULLIF(properties::jsonb ->> 'platform', ''), 'unknown') AS platform, COUNT(*) AS count FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') AND event_name = 'skills_cli started' GROUP BY COALESCE(NULLIF(properties::jsonb ->> 'platform', ''), 'unknown') ORDER BY count DESC",
    },
    {
      legacySql:
        "SELECT COALESCE(NULLIF(properties::jsonb ->> 'scope', ''), 'unknown') AS scope, COUNT(*) AS count FROM analytics_events WHERE event_name = 'skills_cli scope selected' GROUP BY COALESCE(NULLIF(properties::jsonb ->> 'scope', ''), 'unknown') ORDER BY count DESC",
      sql: "SELECT COALESCE(NULLIF(properties::jsonb ->> 'scope', ''), 'unknown') AS scope, COUNT(*) AS count FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') AND event_name = 'skills_cli scope selected' GROUP BY COALESCE(NULLIF(properties::jsonb ->> 'scope', ''), 'unknown') ORDER BY count DESC",
    },
    {
      legacySql:
        "SELECT trim(c) AS client, COUNT(*) AS count FROM analytics_events, LATERAL unnest(string_to_array(properties::jsonb ->> 'clients', ',')) AS c WHERE event_name = 'skills_cli clients selected' AND (properties::jsonb ->> 'clients') <> '' GROUP BY trim(c) ORDER BY count DESC LIMIT 30",
      sql: "SELECT trim(c) AS client, COUNT(*) AS count FROM analytics_events, LATERAL unnest(string_to_array(properties::jsonb ->> 'clients', ',')) AS c WHERE event_name = 'skills_cli clients selected' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') AND (properties::jsonb ->> 'clients') <> '' GROUP BY trim(c) ORDER BY count DESC LIMIT 30",
    },
    {
      legacySql:
        "WITH steps AS (SELECT 1 AS step_order, 'Started' AS step, COUNT(DISTINCT session_id) AS reached FROM analytics_events WHERE event_name = 'skills_cli started' UNION ALL SELECT 2, 'Skills prompted', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli skills prompted' UNION ALL SELECT 3, 'Skills selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli skills selected' UNION ALL SELECT 4, 'Clients selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli clients selected' UNION ALL SELECT 5, 'Scope selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli scope selected' UNION ALL SELECT 6, 'Install completed', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli install completed' UNION ALL SELECT 7, 'Completed', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli completed'), start_total AS (SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE event_name = 'skills_cli started') SELECT steps.step, steps.reached, CASE WHEN start_total.n = 0 THEN 0 ELSE ROUND(steps.reached * 100.0 / start_total.n) END AS pct_of_start FROM steps, start_total ORDER BY steps.step_order",
      sql: "WITH steps AS (SELECT 1 AS step_order, 'Started' AS step, COUNT(DISTINCT session_id) AS reached FROM analytics_events WHERE event_name = 'skills_cli started' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 2, 'Skills prompted', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli skills prompted' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 3, 'Skills selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli skills selected' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 4, 'Clients selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli clients selected' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 5, 'Scope selected', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli scope selected' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 6, 'Install completed', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli install completed' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') UNION ALL SELECT 7, 'Completed', COUNT(DISTINCT session_id) FROM analytics_events WHERE event_name = 'skills_cli completed' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')), start_total AS (SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE event_name = 'skills_cli started' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')) SELECT steps.step, steps.reached, CASE WHEN start_total.n = 0 THEN 0 ELSE ROUND(steps.reached * 100.0 / start_total.n) END AS pct_of_start FROM steps, start_total ORDER BY steps.step_order",
    },
    {
      legacySql: "SELECT COUNT(*) AS value FROM analytics_events",
      sql: "SELECT COUNT(*) AS value FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')",
    },
    {
      legacySql:
        "SELECT COUNT(DISTINCT session_id) AS value FROM analytics_events",
      sql: "SELECT COUNT(DISTINCT session_id) AS value FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')",
    },
    {
      legacySql:
        "SELECT event_name AS label, COUNT(*) AS value FROM analytics_events GROUP BY event_name ORDER BY value DESC LIMIT 8",
      sql: "SELECT event_name AS label, COUNT(*) AS value FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') GROUP BY event_name ORDER BY value DESC LIMIT 8",
    },
    {
      legacySql:
        "SELECT CASE WHEN signed_in = 'true' THEN 'Signed In' ELSE 'Anonymous' END AS user_type, COUNT(*) AS events FROM analytics_events GROUP BY signed_in",
      sql: "SELECT CASE WHEN signed_in = 'true' THEN 'Signed In' ELSE 'Anonymous' END AS user_type, COUNT(*) AS events FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') GROUP BY signed_in",
    },
    {
      legacySql:
        "SELECT timestamp, event_name, app, signed_in FROM analytics_events ORDER BY timestamp DESC LIMIT 50",
      sql: "SELECT timestamp, event_name, app, signed_in FROM analytics_events WHERE event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD') ORDER BY timestamp DESC LIMIT 50",
    },
    {
      legacySql:
        "WITH base AS (SELECT NULLIF(user_key, '') AS user_key, event_date AS event_date, user_id FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'docs' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))), first_seen AS (SELECT user_key, MIN(event_date) AS cohort_date FROM base GROUP BY user_key), anchor_dates AS (SELECT DISTINCT cohort_date AS date FROM first_seen WHERE cohort_date <= to_char(CURRENT_DATE - INTERVAL '14 days', 'YYYY-MM-DD') AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')))), cohort_windows AS (SELECT a.date, f.user_key, f.cohort_date FROM anchor_dates a JOIN first_seen f ON f.cohort_date >= to_char(a.date::date - INTERVAL '6 days', 'YYYY-MM-DD') AND f.cohort_date <= a.date), cohort_sizes AS (SELECT date, COUNT(DISTINCT user_key) AS users FROM cohort_windows GROUP BY date), periods AS (SELECT '1-7d return' AS period UNION ALL SELECT '7-14d return' AS period), retained AS (SELECT cw.date, '1-7d return' AS period, COUNT(DISTINCT cw.user_key) AS retained FROM cohort_windows cw JOIN base b ON b.user_key = cw.user_key AND b.event_date > cw.cohort_date AND b.event_date <= to_char(cw.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') GROUP BY cw.date UNION ALL SELECT cw.date, '7-14d return' AS period, COUNT(DISTINCT cw.user_key) AS retained FROM cohort_windows cw JOIN base b ON b.user_key = cw.user_key AND b.event_date >= to_char(cw.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') AND b.event_date <= to_char(cw.cohort_date::date + INTERVAL '14 days', 'YYYY-MM-DD') GROUP BY cw.date) SELECT cs.date, p.period, COALESCE(r.retained, 0) AS retained_users, cs.users AS cohort_users, COALESCE(r.retained::float / NULLIF(cs.users, 0), 0) AS rate FROM cohort_sizes cs CROSS JOIN periods p LEFT JOIN retained r ON r.date = cs.date AND r.period = p.period WHERE cs.users >= 5 ORDER BY cs.date, p.period",
      sql: "WITH base AS (SELECT NULLIF(user_key, '') AS user_key, event_date AS event_date, user_id FROM analytics_events WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'docs' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io')) AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')), first_seen AS (SELECT user_key, MIN(event_date) AS cohort_date FROM base GROUP BY user_key), anchor_dates AS (SELECT DISTINCT cohort_date AS date FROM first_seen WHERE cohort_date <= to_char(CURRENT_DATE - INTERVAL '14 days', 'YYYY-MM-DD') AND (cohort_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD') AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND cohort_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))))), cohort_windows AS (SELECT a.date, f.user_key, f.cohort_date FROM anchor_dates a JOIN first_seen f ON f.cohort_date >= to_char(a.date::date - INTERVAL '6 days', 'YYYY-MM-DD') AND f.cohort_date <= a.date), cohort_sizes AS (SELECT date, COUNT(DISTINCT user_key) AS users FROM cohort_windows GROUP BY date), periods AS (SELECT '1-7d return' AS period UNION ALL SELECT '7-14d return' AS period), retained AS (SELECT cw.date, '1-7d return' AS period, COUNT(DISTINCT cw.user_key) AS retained FROM cohort_windows cw JOIN base b ON b.user_key = cw.user_key AND b.event_date > cw.cohort_date AND b.event_date <= to_char(cw.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') GROUP BY cw.date UNION ALL SELECT cw.date, '7-14d return' AS period, COUNT(DISTINCT cw.user_key) AS retained FROM cohort_windows cw JOIN base b ON b.user_key = cw.user_key AND b.event_date >= to_char(cw.cohort_date::date + INTERVAL '7 days', 'YYYY-MM-DD') AND b.event_date <= to_char(cw.cohort_date::date + INTERVAL '14 days', 'YYYY-MM-DD') GROUP BY cw.date) SELECT cs.date, p.period, COALESCE(r.retained, 0) AS retained_users, cs.users AS cohort_users, COALESCE(r.retained::float / NULLIF(cs.users, 0), 0) AS rate FROM cohort_sizes cs CROSS JOIN periods p LEFT JOIN retained r ON r.date = cs.date AND r.period = p.period WHERE cs.users >= 5 ORDER BY cs.date, p.period",
    },
    {
      legacySql:
        "WITH offsets AS (SELECT (ROW_NUMBER() OVER (ORDER BY event_date) - 1)::int AS n FROM analytics_events LIMIT 800), signup_events AS (SELECT event_date AS date, COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown') AS template FROM analytics_events WHERE event_name = 'signup' AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))) AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))), bounds AS (SELECT MIN(date::date) AS start_date, MAX(date::date) AS end_date FROM signup_events), dates AS (SELECT to_char(bounds.start_date + offsets.n, 'YYYY-MM-DD') AS date FROM bounds CROSS JOIN offsets WHERE bounds.start_date IS NOT NULL AND bounds.start_date + offsets.n <= bounds.end_date), templates AS (SELECT DISTINCT template FROM signup_events), daily AS (SELECT date, template, COUNT(*) AS count FROM signup_events GROUP BY date, template) SELECT dates.date, templates.template, COALESCE(daily.count, 0) AS count FROM dates CROSS JOIN templates LEFT JOIN daily ON daily.date = dates.date AND daily.template = templates.template ORDER BY dates.date, templates.template",
      sql: "WITH signup_events AS (SELECT event_date AS date, COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown') AS template FROM analytics_events WHERE event_name = 'signup' AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD'))) AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))), bounds AS (SELECT MIN(date::date) AS start_date, MAX(date::date) AS end_date FROM signup_events), dates AS (SELECT to_char(d, 'YYYY-MM-DD') AS date FROM bounds, generate_series(bounds.start_date, bounds.end_date, INTERVAL '1 day') AS d WHERE bounds.start_date IS NOT NULL), templates AS (SELECT DISTINCT template FROM signup_events), daily AS (SELECT date, template, COUNT(*) AS count FROM signup_events GROUP BY date, template) SELECT dates.date, templates.template, COALESCE(daily.count, 0) AS count FROM dates CROSS JOIN templates LEFT JOIN daily ON daily.date = dates.date AND daily.template = templates.template ORDER BY dates.date, templates.template",
    },
  ];

export function repairUnboundedFirstPartyPanels(
  config: Record<string, unknown>,
  dialect: Dialect = "postgres",
): { config: Record<string, unknown>; changed: boolean } {
  if (!Array.isArray(config.panels)) return { config, changed: false };

  const fixBySql = new Map(
    UNBOUNDED_FIRST_PARTY_PANEL_FIXES.map((fix) => [fix.legacySql, fix.sql]),
  );
  let changed = false;
  const panels = config.panels.map((rawPanel) => {
    if (!rawPanel || typeof rawPanel !== "object") return rawPanel;
    const panel = rawPanel as DashboardPanelLike & Record<string, unknown>;
    if (panel.source !== "first-party" || typeof panel.sql !== "string") {
      return rawPanel;
    }
    const fixedSql = fixBySql.get(panel.sql);
    if (fixedSql === undefined) return rawPanel;
    changed = true;
    return { ...panel, sql: dialectBoundedSql(fixedSql, dialect) };
  });
  if (!changed) return { config, changed: false };
  return { config: { ...config, panels }, changed: true };
}
