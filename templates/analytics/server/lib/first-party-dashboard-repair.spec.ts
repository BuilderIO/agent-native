import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  recordChange: vi.fn(),
}));

const revisionUuid = "new-revision";

const schema = vi.hoisted(() => ({
  dashboards: {
    id: { name: "id" },
    kind: { name: "kind" },
    config: { name: "config" },
    title: { name: "title" },
    updatedAt: { name: "updatedAt" },
    updatedBy: { name: "updatedBy" },
    ownerEmail: { name: "ownerEmail" },
    orgId: { name: "orgId" },
    visibility: { name: "visibility" },
  },
  dashboardRevisions: {
    id: { name: "id" },
    dashboardId: { name: "dashboardId" },
    createdAt: { name: "createdAt" },
  },
}));

vi.mock("@agent-native/core/server", () => ({
  recordChange: dbMocks.recordChange,
}));

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomUUID: () => revisionUuid,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  desc: (column: { name: string }) => ({ type: "desc", column: column.name }),
  eq: (column: { name: string }, value: unknown) => ({
    type: "eq",
    column: column.name,
    value,
  }),
  inArray: (column: { name: string }, values: unknown[]) => ({
    type: "inArray",
    column: column.name,
    values,
  }),
}));

vi.mock("../db/index.js", () => ({
  getDb: dbMocks.getDb,
  schema,
}));

import { interpolateDashboardPanelSql } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import {
  DEPLOYED_NEW_VS_RECURRING_USERS_SQL,
  FIRST_PARTY_BIGQUERY_RETENTION_SQL,
  FIRST_PARTY_BIGQUERY_WAU_SQL,
  FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
  LEGACY_FIRST_PARTY_BIGQUERY_RETENTION_SQL,
  LEGACY_NEW_VS_RECURRING_USERS_SQL,
  PRE_CUSTOM_FIRST_PARTY_BIGQUERY_RETENTION_WITH_LAST_VALID_SQL,
  PRE_CUSTOM_FIRST_PARTY_BIGQUERY_WAU_SQL,
  repairCanonicalFirstPartyDashboardQueries,
  repairFirstPartyBigQueryDashboardQueries,
} from "./canonical-first-party-dashboard-repair";
import {
  repairPersistedFirstPartyDashboardQueries,
  repairUnboundedFirstPartyPanelsAcrossDashboards,
} from "./first-party-dashboard-repair";
import {
  DOUBLE_SCAN_RECURRING_USERS_BY_TEMPLATE_SQL,
  DOUBLE_SCAN_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
  DAU_BY_TEMPLATE_SQL,
  FIRST_PARTY_DASHBOARD_ID,
  INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_SQL,
  LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL,
  LEGACY_SEED_SIGNUPS_OVER_TIME_SQL,
  LEGACY_SIGNUPS_OVER_TIME_SQL,
  MATERIALIZED_ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
  PRE_COHORT_HISTORY_RETENTION_OVER_TIME_SQL,
  PRE_CAPPED_RETENTION_OVER_TIME_SQL,
  PRE_SOURCE_SCAN_BOUNDS_RETENTION_OVER_TIME_SQL,
  PRE_CAPPED_SIGNUPS_OVER_TIME_SQL,
  PRE_CUSTOM_RETENTION_OVER_TIME_SQL,
  PRE_CUSTOM_SPINE_SIGNUPS_OVER_TIME_SQL,
  FIRST_PARTY_TEMPLATE_NAMES,
  buildPanel,
} from "./first-party-metric-catalog";
import { UNBOUNDED_FIRST_PARTY_PANEL_FIXES } from "./first-party-unbounded-panel-repair";

function requiredFirstPartyPanel(
  id: string,
): NonNullable<ReturnType<typeof buildPanel>> {
  const panel = buildPanel(id);
  if (!panel) throw new Error(`Expected first-party metric "${id}" to exist`);
  return panel;
}

// These fragments reconstruct the exact origin/main@452757b243ef SQL snapshots.
const ORIGIN_MAIN_PANEL_SQL_PATCHES = {
  retentionOverTimeCatalog: {
    prefixLength: 1330,
    suffixLength: 2683,
    length: 8363,
    sha256: "974b66473d3a9590bdaa9ccb6df9da2fc149008e07ce9838e56dcc8a478d6f6f",
    middle:
      "base AS (\n  SELECT NULLIF(user_key, '') AS user_key, event_date AS event_date, user_id\n  FROM analytics_events\n  CROSS JOIN date_spine_bounds\n  WHERE ((event_name IN ('session status', 'session_status') AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'docs' AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides') AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'www' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io')) AND ('{{appFilter}}' IN ('', 'all') OR lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) = lower('{{appFilter}}'))\n    AND date_spine_bounds.start_date <= date_spine_bounds.end_date\n    AND (\n      ('{{timeRange}}' = 'custom' AND event_date >= to_char((date_spine_bounds.start_date - INTERVAL '6 days')::date, 'YYYY-MM-DD'))\n      OR ('{{timeRange}}' <> 'custom' AND event_date >= to_char(CURRENT_DATE - INTERVAL '371 days', 'YYYY-MM-DD'))\n    )\n    AND event_date <= to_char(LEAST(date_spine_bounds.end_date + INTERVAL '14 days', CURRENT_DATE)::date, 'YYYY-MM-DD')\n), cohort_history AS (\n  SELECT NULLIF(user_key, '') AS user_key, event_date AS event_date, user_id\n  FROM analytics_events\n  CROSS JOIN date_spine_bounds\n  WHERE '{{timeRange}}' = 'custom'\n    AND ((event_name IN ('session status', 'session_status') AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'docs' AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides') AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'www' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')",
  },
  oneDayRetentionByTemplate: {
    prefixLength: 28,
    suffixLength: 3415,
    length: 4448,
    sha256: "84049de619edfca2a8ce10f2da0f6acf674aa504eca65c242a4e76ffd0b22bf1",
    middle:
      "user_key, '') AS user_key, COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown') AS template, event_date AS event_date FROM analytics_events WHERE ('{{appFilter}}' IN ('', 'all') OR lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) = lower('{{appFilter}}')) AND ((event_name IN ('session status', 'session_status') AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND NULLIF(user_key, '') IS NOT NULL",
  },
  sevenDayRetentionByTemplate: {
    prefixLength: 28,
    suffixLength: 3573,
    length: 4598,
    sha256: "3e8993b8d56fd33a3883bb57f832bbb539ee9750a563fe1b21eb10e12aec7966",
    middle:
      "user_key, '') AS user_key, COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown') AS template, event_date AS event_date, user_id FROM analytics_events WHERE ('{{appFilter}}' IN ('', 'all') OR lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) = lower('{{appFilter}}')) AND ((event_name IN ('session status', 'session_status') AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND NULLIF(user_key",
  },
  activationFunnel: {
    prefixLength: 5,
    suffixLength: 22996,
    length: 25336,
    sha256: "ba2e861c2044e2fec669bcb15a878a675eaf426f51bcfe4db32ebd228d2050f0",
    middle:
      "signup_identity AS (\n  SELECT NULLIF(anonymous_id, '') AS anonymous_id,\n    MIN(NULLIF(user_id, '')) AS signup_user_id\n  FROM analytics_events\n  WHERE event_name = 'signup'\n    AND (event_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD') AND ('{{timeRange}}' IN ('', 'all') OR ('{{timeRange}}' = '7d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '30d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '90d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '180d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '180 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = '365d' AND event_date >= to_char(CURRENT_DATE - INTERVAL '365 days', 'YYYY-MM-DD')) OR ('{{timeRange}}' = 'custom' AND event_date >= '{{timeRangeStart}}' AND event_date <= '{{timeRangeEnd}}')))\n    AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))\n    AND ('{{appFilter}}' IN ('', 'all') OR lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) = lower('{{appFilter}}'))\n    AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides')\n    AND NULLIF(anonymous_id, '') IS NOT NULL\n    AND NULLIF(user_id, '') IS NOT NULL\n  GROUP BY NULLIF(anonymous_id, '')\n), raw_funnel_events AS (\n  SELECT e.*,\n    COALESCE(si.signup_user_id, NULLIF(e.user_id, ''), NULLIF(e.anonymous_id, '')) AS funnel_user_key,\n    COALESCE(si.signup_user_id, NULLIF(e.user_id, '')",
  },
  retentionOverTimeSeed: {
    prefixLength: 5,
    suffixLength: 1710,
    length: 7662,
    sha256: "b395a694889d393d889ced4a79d936e17cb58af88b856670a393cba91e3cf83d",
    middle:
      "base AS (\n  SELECT NULLIF(user_key, '') AS user_key, event_date AS event_date, user_id\n  FROM analytics_events\n  WHERE ('{{appFilter}}' IN ('', 'all') OR lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) = lower('{{appFilter}}')) AND ((event_name IN ('session status', 'session_status') AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'docs' AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides') AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'www' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))\n    AND event_date >= CASE WHEN '{{timeRange}}' = 'custom' THEN to_char(NULLIF('{{timeRangeStart}}', '')::date - INTERVAL '6 days', 'YYYY-MM-DD') ELSE to_char(CURRENT_DATE - INTERVAL '371 days', 'YYYY-MM-DD') END\n    AND event_date <= CASE WHEN '{{timeRange}}' = 'custom' THEN to_char(LEAST(NULLIF('{{timeRangeEnd}}', '')::date + INTERVAL '14 days', CURRENT_DATE), 'YYYY-MM-DD') ELSE to_char(CURRENT_DATE, 'YYYY-MM-DD') END\n), cohort_history AS (\n  SELECT NULLIF(user_key, '') AS user_key, event_date AS event_date, user_id\n  FROM analytics_events\n  WHERE ('{{appFilter}}' IN ('', 'all') OR lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) = lower('{{appFilter}}')) AND '{{timeRange}}' = 'custom'\n    AND ((event_name IN ('session status', 'session_status') AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND NULLIF(user_key, '') IS NOT NULL AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'docs' AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides') AND lower(COALESCE(NULLIF(template, ''), NULLIF(properties::jsonb ->> 'templateId', ''), NULLIF(properties::jsonb ->> 'agent_native_template', ''), NULLIF(properties::jsonb ->> 'agentNativeTemplate', ''), NULLIF(app, ''), NULLIF(properties::jsonb ->> 'agent_native_app', ''), NULLIF(properties::jsonb ->> 'agentNativeApp', ''), 'unknown')) <> 'www' AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND lower(coalesce(user_id, '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND lower(coalesce(user_id, '')) LIKE '%@builder.io'))\n    AND event_date >= to_char(NULLIF('{{timeRangeStart}}', '')::date - INTERVAL '371 days', 'YYYY-MM-DD')\n    AND event_date < to_char(NULLIF('{{timeRangeStart}}', '')::date - INTERVAL '6 days', 'YYYY-MM-DD')\n    AND event_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD')\n), first_seen AS (\n  SELECT user_key, MIN(event_date) AS cohort_date\n  FROM (\n    SELECT user_key, event_date FROM base\n    UNION ALL\n    SELECT user_key, event_date FROM cohort_history\n  ) activity\n  GROUP BY user_key\n), date_spine_bounds AS (\n  SELECT\n    (CASE WHEN '{{timeRange}}' = 'custom' THEN NULLIF('{{timeRangeStart}}', '')::date ELSE CURRENT_DATE - (CASE '{{timeRange}}' WHEN '7d' THEN 7 WHEN '30d' THEN 30 WHEN '90d' THEN 90 WHEN '180d' THEN 180 WHEN '365d' THEN 365 ELSE 365 END) END)::timestamp AS start_date,\n    (CASE WHEN '{{timeRange}}' = 'custom' THEN LEAST(NULLIF('{{timeRangeEnd}}', '')::date, CURRENT_DATE) ELSE CURRENT_DATE END)::timestamp AS end_date\n), anchor_dates AS (\n  SELECT to_char(anchor_date::date, 'YYYY-MM-DD') AS date\n  FROM date_spine_bounds\n  CROSS JOIN LATERAL pg_catalog.generate_series(\n    GREATEST(date_spine_bounds.start_date, date_spine_bounds.end_date - INTERVAL '3659 days'),\n    date_spine_bounds.end_date,\n    INTERVAL '1 day'\n  ) AS anchor_date",
  },
  bigQueryRetention: {
    prefixLength: 5,
    suffixLength: 1858,
    length: 4840,
    sha256: "d7b7a0400b5f1228dade65d89a9b576d5d98e387b8818b0177c6744805ea9b23",
    middle:
      "base AS (SELECT NULLIF(user_key, '') AS user_key, event_date, user_id\nFROM `builder-3b0a2.analytics.first_party_analytics_events_raw`\nWHERE (((event_name IN ('session status', 'session_status') AND signed_in = 'true') OR (event_name = 'app_entered' AND NULLIF(user_id, '') IS NOT NULL)) AND NULLIF(user_key, '') IS NOT NULL)\n  AND org_id = 'PlRt3bfcpJNnOyF_Wfgsh'\n  AND event_date >= IF('{{timeRange}}' = 'custom', DATE_SUB(DATE('{{timeRangeStart}}'), INTERVAL 365 DAY), DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY))\n  AND event_date <= IF('{{timeRange}}' = 'custom', LEAST(DATE_ADD(LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()), INTERVAL 14 DAY), CURRENT_DATE()), CURRENT_DATE())\n  AND ('{{emailFilter}}' IN ('', 'all') OR ('{{emailFilter}}' = 'exclude_builder' AND LOWER(COALESCE(NULLIF(user_id, ''), '')) NOT LIKE '%@builder.io') OR ('{{emailFilter}}' = 'only_builder' AND LOWER(COALESCE(NULLIF(user_id, ''), '')) LIKE '%@builder.io'))\n  AND LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), 'unknown'))\n    IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides')),\nfirst_seen AS (SELECT user_key, MIN(event_date) AS cohort_date FROM base GROUP BY user_key),\nrange_days AS (SELECT CASE '{{timeRange}}' WHEN '7d' THEN 7 WHEN '30d' THEN 30 WHEN '90d' THEN 90 WHEN '180d' THEN 180 WHEN '365d' THEN 365 ELSE 365 END AS n),\nanchor_dates AS (\n SELECT date FROM range_days,\n UNNEST(GENERATE_DATE_ARRAY(\n   CASE WHEN '{{timeRange}}' = 'custom' THEN DATE('{{timeRangeStart}}') ELSE DATE_SUB(CURRENT_DATE(), INTERVAL n - 1 DAY) END,\n   CASE WHEN '{{timeRange}}' = 'custom' THEN LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()) ELSE CURRENT_DATE() END\n )) AS date\n),\ncohort_windows AS (\n SELECT a.date, f.user_key, f.cohort_date\n FROM anchor_dates a JOIN first_seen f\n ON f.cohort_date >= DATE_SUB(a.date, INTERVAL 6 DAY)\n AND f.cohort_date <= a.date\n),\ncohort_sizes AS (SELECT date, COUNT(DISTINCT user_key) AS users FROM cohort_windows GROUP BY date),\nr1 AS (\n SELECT cw.date, '1-7d return' AS period, COUNT(DISTINCT cw.user_key) AS retained\n FROM cohort_windows cw JOIN base b\n ON b.user_key = cw.user_key\n AND b.event_date > cw.cohort_date\n AND b.event_date <= DATE_ADD(cw.cohort_date, INTERVAL 7 DAY)\n GROUP BY cw.date\n),\nr2 AS (\n SELECT cw.date, '7-14d return' AS period, COUNT(DISTINCT cw.user_key) AS retained\n FROM cohort_windows cw JOIN base b\n ON b.user_key = cw.user_key\n AND b.event_date >= DATE_ADD(cw.cohort_date, INTERVAL 7 DAY)\n AND b.event_date <= DATE_ADD(cw.cohort_date, INTERVAL 14 DAY)\n GROUP BY cw.date\n),\nall_r AS (SELECT * FROM r1 UNION ALL SELECT * FROM r2),\ncoverage_dates AS (\n SELECT DISTINCT event_date\n FROM `builder-3b0a2.analytics.first_party_analytics_events_raw`\n WHERE org_id = 'PlRt3bfcpJNnOyF_Wfgsh'\n   AND event_name IN ('session status', 'session_status')",
  },
} as const;

function originMainPanelSql(
  key: keyof typeof ORIGIN_MAIN_PANEL_SQL_PATCHES,
  currentSql: string,
): string {
  const patch = ORIGIN_MAIN_PANEL_SQL_PATCHES[key];
  const sql =
    currentSql.slice(0, patch.prefixLength) +
    patch.middle +
    currentSql.slice(currentSql.length - patch.suffixLength);
  expect(sql).toHaveLength(patch.length);
  expect(
    createHash("sha256").update(sql.replace(/\s+/g, " ").trim()).digest("hex"),
  ).toBe(patch.sha256);
  return sql;
}

type DashboardRow = {
  id: string;
  kind: string;
  config: string;
  title: string;
  updatedAt: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
};

function createDb(
  row: DashboardRow | null,
  updated: unknown[] = [{ id: FIRST_PARTY_DASHBOARD_ID }],
  revisions: Array<{ id: string }> = [],
  options: { insertError?: Error } = {},
) {
  const dashboardSelectWhere = vi.fn(async () => (row ? [row] : []));
  const dashboardSelectFrom = vi.fn(() => ({ where: dashboardSelectWhere }));
  const revisionOrderBy = vi.fn(async () => revisions);
  const revisionSelectWhere = vi.fn(() => ({ orderBy: revisionOrderBy }));
  const revisionSelectFrom = vi.fn(() => ({ where: revisionSelectWhere }));
  const select = vi
    .fn()
    .mockReturnValueOnce({ from: dashboardSelectFrom })
    .mockReturnValueOnce({ from: revisionSelectFrom });

  const returning = vi.fn(async () => updated);
  const updateWhere = vi.fn(() => ({ returning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const insertValues = vi.fn(async () => {
    if (options.insertError) throw options.insertError;
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  const deleteWhere = vi.fn(async () => undefined);
  const deleteRow = vi.fn(() => ({ where: deleteWhere }));
  const transactionRollback = vi.fn();
  const tx = { select, update, insert, delete: deleteRow };
  const transaction = vi.fn(
    async (callback: (transactionDb: typeof tx) => any) => {
      try {
        return await callback(tx);
      } catch (err) {
        transactionRollback(err);
        throw err;
      }
    },
  );

  return {
    db: { select, transaction },
    dashboardSelectWhere,
    revisionOrderBy,
    revisionSelectWhere,
    update,
    updateSet,
    updateWhere,
    insert,
    insertValues,
    deleteRow,
    deleteWhere,
    transaction,
    transactionRollback,
  };
}

function legacyRow(overrides: Partial<DashboardRow> = {}): DashboardRow {
  const daily = requiredFirstPartyPanel("recurring-users-by-template");
  return {
    id: FIRST_PARTY_DASHBOARD_ID,
    kind: "sql",
    config: JSON.stringify({
      panels: [
        {
          ...daily,
          sql: LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL,
          config: {
            ...(daily.config ?? {}),
            description:
              "Daily signed-in visitors who are NOT on their all-time first active day (Recurring only), stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.",
          },
        },
      ],
    }),
    title: "First-party Template Traffic",
    updatedAt: "2026-07-21T16:00:00.000Z",
    ownerEmail: "steve@builder.io",
    orgId: "builder",
    visibility: "org",
    ...overrides,
  };
}

async function repairPersistedPanel(row: DashboardRow) {
  const mocks = createDb(row);
  dbMocks.getDb.mockReturnValue(mocks.db);
  const changed = await repairPersistedFirstPartyDashboardQueries();
  const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
    [{ config: string }]
  >;
  const config = updateCalls[0]?.[0].config;
  return {
    changed,
    mocks,
    panel: config
      ? (JSON.parse(config).panels[0] as Record<string, unknown>)
      : undefined,
  };
}

describe("repairPersistedFirstPartyDashboardQueries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T17:00:00.000Z"));
    dbMocks.getDb.mockReset();
    dbMocks.recordChange.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("repairs the canonical legacy config with an optimistic config match, revision, and scoped change", async () => {
    const row = legacyRow();
    const revisionId = `dashrev-${Date.parse("2026-07-21T17:00:00.000Z")}-${revisionUuid}`;
    const revisions = [
      ...Array.from({ length: 51 }, (_, index) => ({
        id: `revision-${index}`,
      })),
      { id: revisionId },
    ];
    const mocks = createDb(row, [{ id: row.id }], revisions);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(schema.dashboards);
    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string; updatedAt: string; updatedBy: null }]
    >;
    const update = updateCalls[0]?.[0];
    expect(update).toBeDefined();
    if (!update)
      throw new Error("Expected persisted repair to issue an update");
    expect(JSON.parse(update.config).panels[0].sql).toBe(
      requiredFirstPartyPanel("recurring-users-by-template").sql,
    );
    expect(update).toMatchObject({
      updatedAt: "2026-07-21T17:00:00.000Z",
      updatedBy: null,
    });
    expect(mocks.updateWhere).toHaveBeenCalledWith({
      type: "and",
      conditions: [
        { type: "eq", column: "id", value: FIRST_PARTY_DASHBOARD_ID },
        { type: "eq", column: "config", value: row.config },
        { type: "eq", column: "updatedAt", value: row.updatedAt },
      ],
    });
    expect(mocks.insert).toHaveBeenCalledWith(schema.dashboardRevisions);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: revisionId,
        dashboardId: row.id,
        kind: row.kind,
        title: row.title,
        config: row.config,
        createdAt: "2026-07-21T17:00:00.000Z",
        createdBy: null,
        ownerEmail: row.ownerEmail,
        orgId: row.orgId,
      }),
    );
    expect(mocks.revisionSelectWhere).toHaveBeenCalledWith({
      type: "eq",
      column: "dashboardId",
      value: row.id,
    });
    expect(mocks.revisionOrderBy).toHaveBeenCalledWith(
      { type: "desc", column: "createdAt" },
      { type: "desc", column: "id" },
    );
    expect(mocks.deleteWhere).toHaveBeenNthCalledWith(1, {
      type: "eq",
      column: "id",
      value: "revision-49",
    });
    expect(mocks.deleteWhere).toHaveBeenNthCalledWith(2, {
      type: "eq",
      column: "id",
      value: "revision-50",
    });
    expect(mocks.deleteWhere).not.toHaveBeenCalledWith({
      type: "eq",
      column: "id",
      value: revisionId,
    });
    expect(dbMocks.recordChange).toHaveBeenCalledWith({
      source: "dashboards",
      type: "change",
      key: row.id,
      orgId: row.orgId,
    });
  });

  it("normalizes nested panel fields before applying the canonical repair", async () => {
    const daily = requiredFirstPartyPanel("recurring-users-by-template");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...daily,
            sql: "SELECT stale_top_level_sql()",
            config: {
              ...(daily.config ?? {}),
              sql: LEGACY_RECURRING_USERS_BY_TEMPLATE_SQL,
            },
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panel = JSON.parse(updateCalls[0]![0].config).panels[0];
    expect(panel.sql).toBe(daily.sql);
    expect(panel.config?.sql).toBeUndefined();
  });

  it("repairs the previously deployed bounded monolithic recurring SQL", async () => {
    const daily = requiredFirstPartyPanel("recurring-users-by-template");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...daily,
            sql: INTERMEDIATE_RECURRING_USERS_BY_TEMPLATE_SQL,
            config: {
              ...(daily.config ?? {}),
              description:
                "Daily signed-in visitors who are not on their first active day observed in the previous 365 days, stacked by inferred template/app used that day. Docs traffic and unknown template are excluded.",
            },
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0]).toMatchObject({
      sql: daily.sql,
      config: { description: daily.config?.description },
    });
  });

  it("repairs the deployed double-scan recurring panel during startup", async () => {
    const daily = requiredFirstPartyPanel("recurring-users-by-template");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...daily,
            sql: DOUBLE_SCAN_RECURRING_USERS_BY_TEMPLATE_SQL,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panel = JSON.parse(updateCalls[0]![0].config).panels[0];
    expect(panel.sql.match(/FROM analytics_events/g)).toHaveLength(1);
    expect(panel.sql).toContain("MIN(event_date) OVER");
  });

  it("repairs the deployed weekly double-scan recurring panel during startup", async () => {
    const weekly = requiredFirstPartyPanel("recurring-users-by-template-bar");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...weekly,
            sql: DOUBLE_SCAN_RECURRING_USERS_BY_TEMPLATE_WEEKLY_SQL,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panel = JSON.parse(updateCalls[0]![0].config).panels[0];
    expect(panel.sql.match(/FROM analytics_events/g)).toHaveLength(1);
    expect(panel.sql).toContain("MIN(event_date) OVER");
  });

  it("repairs a wau panel that was persisted with the dau SQL", async () => {
    const weekly = requiredFirstPartyPanel("wau-over-time");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...weekly,
            sql: DAU_BY_TEMPLATE_SQL,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      weekly.sql,
    );
  });

  it("repairs blank canonical panels on the known BigQuery dashboard from the catalog", async () => {
    const weekly = requiredFirstPartyPanel("wau-over-time");
    const retention = requiredFirstPartyPanel("retention-over-time");
    const bigQueryWau = { ...weekly, source: "bigquery" as const, sql: "" };
    const bigQueryRetention = {
      ...retention,
      source: "bigquery" as const,
      sql: "",
    };
    const row = legacyRow({
      id: FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      config: JSON.stringify({
        panels: [
          bigQueryWau,
          bigQueryRetention,
          { ...requiredFirstPartyPanel("dau-over-time"), sql: "" },
          { id: "custom", source: "first-party", sql: "" },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panels = JSON.parse(updateCalls[0]![0].config).panels;
    expect(panels[0].sql).toBe(FIRST_PARTY_BIGQUERY_WAU_SQL);
    expect(panels[1].sql).toBe(FIRST_PARTY_BIGQUERY_RETENTION_SQL);
    expect(panels[1].sql).toContain("coverage_dates AS");
    expect(panels[1].sql).toContain(
      "DATE_SUB(DATE('{{timeRangeStart}}'), INTERVAL 5 DAY)",
    );
    expect(panels[1].sql).toContain(
      "LEAST(DATE_ADD(LEAST(DATE('{{timeRangeEnd}}'), CURRENT_DATE()), INTERVAL 14 DAY), CURRENT_DATE())",
    );
    expect(panels[1].sql).toContain(
      "DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)",
    );
    expect(panels[1].sql).toContain(
      "coverage.observed_days = coverage.expected_days",
    );
    expect(panels[0].source).toBe("bigquery");
    expect(panels[0].sql).toContain(
      "FROM `builder-3b0a2.analytics.first_party_analytics_events_raw_query`",
    );
    expect(panels[0].sql).toContain("org_id = 'PlRt3bfcpJNnOyF_Wfgsh'");
    expect(panels[0].sql).toContain(
      "LOWER(COALESCE(NULLIF(template, ''), NULLIF(JSON_VALUE(properties, '$.templateId'), ''), NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''), NULLIF(app, ''), NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''), NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''), 'unknown')) IN ('analytics', 'assets', 'brain', 'calendar', 'chat', 'clips', 'content', 'design', 'dispatch', 'forms', 'mail', 'plan', 'slides')",
    );
    expect(panels[0].sql).toContain("INTERVAL 13 DAY");
    expect(panels[0].sql).toContain("INTERVAL 6 DAY");
    expect(panels[0].sql).toContain("INTERVAL 96 DAY");
    expect(panels[0].sql).toContain("GENERATE_DATE_ARRAY");
    expect(panels[0].sql).toContain("CURRENT_DATE()");
    expect(panels[0].sql).toContain(
      "b.event_date BETWEEN DATE_SUB(d.date, INTERVAL 6 DAY) AND d.date",
    );
    expect(panels[0].sql).toMatch(
      /\{\{(?:timeRange|emailFilter|appFilter)\}\}/,
    );
    expect(panels[0].sql).not.toMatch(/::|to_char\(|date_trunc\(/i);
    expect(panels[0].sql).not.toMatch(/\bFROM\s+analytics_events\b/i);
    expect(panels[2].sql).toBe("");
    expect(panels[3].sql).toBe("");
  });

  it("repairs a stale BigQuery daily activity filter", () => {
    const repaired = repairFirstPartyBigQueryDashboardQueries({
      panels: [
        {
          ...requiredFirstPartyPanel("dau-over-time"),
          source: "bigquery",
          sql: "SELECT event_date FROM `events` WHERE event_name = 'session status' AND signed_in = 'true' AND NULLIF(user_key, '') IS NOT NULL",
        },
      ],
    });

    expect(repaired.changed).toBe(true);
    const panel = (repaired.config.panels as Array<{ sql: string }>)[0]!;
    expect(panel.sql).toContain(
      "event_name IN ('session status', 'session_status')",
    );
    expect(panel.sql).toContain("event_name = 'app_entered'");
  });

  it("repairs a persisted prior-seed SQL filter and preserves customized SQL", () => {
    const totalSignups = requiredFirstPartyPanel("total-signups");
    const priorSeedSql = totalSignups.sql.replace(
      " OR ('{{timeRange}}' = 'custom' AND event_date >= '{{timeRangeStart}}' AND event_date <= '{{timeRangeEnd}}')",
      "",
    );
    const repaired = repairCanonicalFirstPartyDashboardQueries({
      panels: [{ ...totalSignups, sql: priorSeedSql }],
    });

    expect(repaired.changed).toBe(true);
    expect((repaired.config.panels as Array<{ sql: string }>)[0]?.sql).toBe(
      totalSignups.sql,
    );

    const customized = repairCanonicalFirstPartyDashboardQueries({
      panels: [{ ...totalSignups, sql: `${priorSeedSql} /* custom */` }],
    });
    expect(customized.changed).toBe(false);
  });

  it("repairs the previous canonical Postgres retention query", () => {
    const retention = requiredFirstPartyPanel("retention-over-time");
    const repaired = repairCanonicalFirstPartyDashboardQueries({
      panels: [{ ...retention, sql: PRE_CUSTOM_RETENTION_OVER_TIME_SQL }],
    });

    expect(repaired.changed).toBe(true);
    expect((repaired.config.panels as Array<{ sql: string }>)[0]?.sql).toBe(
      retention.sql,
    );
  });

  it("repairs the origin/main Postgres retention query on an org-scoped dashboard", async () => {
    const retention = requiredFirstPartyPanel("retention-over-time");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...retention,
            sql: originMainPanelSql("retentionOverTimeCatalog", retention.sql),
          },
        ],
      }),
    });

    const repaired = await repairPersistedPanel(row);

    expect(repaired.changed).toBe(true);
    expect(repaired.panel?.sql).toBe(retention.sql);
    expect(repaired.mocks.update).toHaveBeenCalledOnce();
  });

  it("repairs the origin/main unscoped Postgres retention seed on a private dashboard", async () => {
    const retention = requiredFirstPartyPanel("retention-over-time");
    const row = legacyRow({
      orgId: null,
      visibility: "private",
      config: JSON.stringify({
        panels: [
          {
            ...retention,
            sql: originMainPanelSql("retentionOverTimeSeed", retention.sql),
          },
        ],
      }),
    });

    const repaired = await repairPersistedPanel(row);

    expect(repaired.changed).toBe(true);
    expect(repaired.panel?.sql).toBe(retention.sql);
    expect(repaired.mocks.update).toHaveBeenCalledOnce();
  });

  it("repairs the origin/main one-day retention-by-template panel", async () => {
    const panel = requiredFirstPartyPanel("one-day-retention-by-template");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...panel,
            sql: originMainPanelSql("oneDayRetentionByTemplate", panel.sql),
          },
        ],
      }),
    });

    const repaired = await repairPersistedPanel(row);

    expect(repaired.changed).toBe(true);
    expect(repaired.panel?.sql).toBe(panel.sql);
    expect(repaired.mocks.update).toHaveBeenCalledOnce();
  });

  it("repairs the origin/main seven-day retention-by-template panel", async () => {
    const panel = requiredFirstPartyPanel("seven-day-retention-by-template");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...panel,
            sql: originMainPanelSql("sevenDayRetentionByTemplate", panel.sql),
          },
        ],
      }),
    });

    const repaired = await repairPersistedPanel(row);

    expect(repaired.changed).toBe(true);
    expect(repaired.panel?.sql).toBe(panel.sql);
    expect(repaired.mocks.update).toHaveBeenCalledOnce();
  });

  it("repairs the origin/main activation-funnel panel", async () => {
    const panel = requiredFirstPartyPanel("activation-funnel");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...panel,
            sql: originMainPanelSql("activationFunnel", panel.sql),
          },
        ],
      }),
    });

    const repaired = await repairPersistedPanel(row);

    expect(repaired.changed).toBe(true);
    expect(repaired.panel?.sql).toBe(panel.sql);
    expect(repaired.mocks.update).toHaveBeenCalledOnce();
  });

  it("repairs the origin/main BigQuery retention panel", async () => {
    const retention = requiredFirstPartyPanel("retention-over-time");
    const row = legacyRow({
      id: FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      config: JSON.stringify({
        panels: [
          {
            ...retention,
            source: "bigquery",
            sql: originMainPanelSql(
              "bigQueryRetention",
              FIRST_PARTY_BIGQUERY_RETENTION_SQL,
            ),
          },
        ],
      }),
    });

    const repaired = await repairPersistedPanel(row);

    expect(repaired.changed).toBe(true);
    expect(repaired.panel?.sql).toBe(FIRST_PARTY_BIGQUERY_RETENTION_SQL);
    expect(repaired.mocks.update).toHaveBeenCalledOnce();
  });

  it("repairs the persisted BigQuery retention query after a data gap", async () => {
    const retention = requiredFirstPartyPanel("retention-over-time");
    const row = legacyRow({
      id: FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      config: JSON.stringify({
        panels: [
          {
            ...retention,
            source: "bigquery",
            sql: LEGACY_FIRST_PARTY_BIGQUERY_RETENTION_SQL.replace(
              /\n/g,
              "\n\n",
            ),
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      FIRST_PARTY_BIGQUERY_RETENTION_SQL,
    );
  });

  it("uses content and chat activity with canonical auth identities for BigQuery retention", () => {
    const identityEmailsStart = FIRST_PARTY_BIGQUERY_RETENTION_SQL.indexOf(
      "identity_emails AS (",
    );
    const baseStart = FIRST_PARTY_BIGQUERY_RETENTION_SQL.indexOf(
      "base AS (",
      identityEmailsStart,
    );
    const baseEnd = FIRST_PARTY_BIGQUERY_RETENTION_SQL.indexOf("first_seen AS");
    const base = FIRST_PARTY_BIGQUERY_RETENTION_SQL.slice(baseStart, baseEnd);

    expect(base).toContain("'recording_ready', 'run_started')");
    expect(base).toContain("generation_completed");
    expect(base).toContain("plan_created");
    expect(base).toContain(
      "NULLIF(JSON_VALUE(properties, '$.auth_user_id'), '') AS user_key",
    );
    expect(base).toContain(
      "NULLIF(JSON_VALUE(properties, '$.auth_user_id'), '') IS NOT NULL",
    );
    expect(base).not.toContain("session status");
    expect(FIRST_PARTY_BIGQUERY_RETENTION_SQL).not.toContain("session status");
  });

  it("repairs the persisted last-valid BigQuery retention query for custom ranges", () => {
    const retention = requiredFirstPartyPanel("retention-over-time");
    const repaired = repairFirstPartyBigQueryDashboardQueries({
      panels: [
        {
          ...retention,
          source: "bigquery",
          sql: PRE_CUSTOM_FIRST_PARTY_BIGQUERY_RETENTION_WITH_LAST_VALID_SQL,
        },
      ],
    });
    const panel = (
      repaired.config.panels as Array<{
        sql: string;
        source: string;
      }>
    )[0]!;
    const sql = interpolateDashboardPanelSql(
      panel.sql,
      {
        timeRange: "custom",
        timeRangeStart: "2026-08-31",
        timeRangeEnd: "2026-09-30",
      },
      panel,
    );

    expect(repaired.changed).toBe(true);
    expect(panel.sql).toBe(FIRST_PARTY_BIGQUERY_RETENTION_SQL);
    expect(sql).not.toContain("__unsupported_custom_date_range__");
    expect(sql).toContain("DATE_SUB(DATE('2026-08-31'), INTERVAL 365 DAY)");
    expect(sql).toContain(
      "LEAST(DATE_ADD(LEAST(DATE('2026-09-30'), CURRENT_DATE()), INTERVAL 14 DAY), CURRENT_DATE())",
    );
    expect(sql).toContain("DATE('2026-08-31') ELSE DATE_SUB");
    expect(sql).toContain(
      "LEAST(DATE('2026-09-30'), CURRENT_DATE()) ELSE CURRENT_DATE()",
    );

    const historicalSql = interpolateDashboardPanelSql(
      panel.sql,
      {
        timeRange: "custom",
        timeRangeStart: "2018-01-01",
        timeRangeEnd: "2018-01-30",
      },
      panel,
    );
    const coverageDates = historicalSql
      .split("coverage_dates AS (")[1]
      ?.split("),\nperiods AS")[0];
    expect(historicalSql).not.toContain("__invalid_custom_date_range__");
    expect(coverageDates).toContain(
      "event_date >= IF('custom' = 'custom', DATE_SUB(DATE('2018-01-01'), INTERVAL 5 DAY), DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY))",
    );
    expect(coverageDates).toContain(
      "event_date <= IF('custom' = 'custom', LEAST(DATE_ADD(LEAST(DATE('2018-01-30'), CURRENT_DATE()), INTERVAL 14 DAY), CURRENT_DATE()), CURRENT_DATE())",
    );

    const maxEndSql = interpolateDashboardPanelSql(
      panel.sql,
      {
        timeRange: "custom",
        timeRangeStart: "9990-01-01",
        timeRangeEnd: "9999-12-31",
      },
      panel,
    );
    expect(maxEndSql).not.toContain("__invalid_custom_date_range__");
    expect(maxEndSql).toContain(
      "LEAST(DATE_ADD(LEAST(DATE('9999-12-31'), CURRENT_DATE()), INTERVAL 14 DAY), CURRENT_DATE())",
    );
    expect(maxEndSql).not.toContain(
      "DATE_ADD(DATE('9999-12-31'), INTERVAL 14 DAY)",
    );
  });

  it("repairs the malformed non-empty BigQuery wau query", async () => {
    const weekly = requiredFirstPartyPanel("wau-over-time");
    const malformedSql = FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
      "WHEN '{{timeRange}}' = '7d'",
      "WHEN '{{timeRange}}' = '{{timeRange}}'",
    );
    const row = legacyRow({
      id: FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      config: JSON.stringify({
        panels: [
          {
            ...weekly,
            source: "bigquery",
            sql: malformedSql,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      FIRST_PARTY_BIGQUERY_WAU_SQL,
    );
  });

  it("repairs the previous canonical BigQuery wau query with the current activity filter", async () => {
    const weekly = requiredFirstPartyPanel("wau-over-time");
    const row = legacyRow({
      id: FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      config: JSON.stringify({
        panels: [
          {
            ...weekly,
            source: "bigquery",
            sql: PRE_CUSTOM_FIRST_PARTY_BIGQUERY_WAU_SQL,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      FIRST_PARTY_BIGQUERY_WAU_SQL,
    );
  });

  it("preserves a customized malformed-looking BigQuery wau query", async () => {
    const weekly = requiredFirstPartyPanel("wau-over-time");
    const customizedSql = FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
      "WHEN '{{timeRange}}' = '7d'",
      "WHEN '{{timeRange}}' = '{{timeRange}}'",
    ).replace("ORDER BY date, template", "ORDER BY template, date");
    const row = legacyRow({
      id: FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      config: JSON.stringify({
        panels: [
          {
            ...weekly,
            source: "bigquery",
            sql: customizedSql,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      false,
    );

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("preserves a malformed-looking query when a SQL literal changes", async () => {
    const weekly = requiredFirstPartyPanel("wau-over-time");
    const customizedSql = FIRST_PARTY_BIGQUERY_WAU_SQL.replace(
      "WHEN '{{timeRange}}' = '7d'",
      "WHEN '{{timeRange}}' = '{{timeRange}}'",
    ).replace("'session status'", "'session  status'");
    const row = legacyRow({
      id: FIRST_PARTY_BIGQUERY_DASHBOARD_ID,
      config: JSON.stringify({
        panels: [
          {
            ...weekly,
            source: "bigquery",
            sql: customizedSql,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      false,
    );

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("repairs the deployed materialized one-day retention panel during startup", async () => {
    const retention = requiredFirstPartyPanel("one-day-retention-by-template");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...retention,
            sql: MATERIALIZED_ONE_DAY_RETENTION_BY_TEMPLATE_SQL,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panel = JSON.parse(updateCalls[0]![0].config).panels[0];
    expect(panel.sql.match(/FROM analytics_events/g)).toHaveLength(1);
    expect(panel.sql).toContain("FIRST_VALUE(template) OVER");
    expect(panel.sql).not.toContain("JOIN base");
  });

  it("repairs the exact legacy seeded signups date-fill query", async () => {
    const signups = requiredFirstPartyPanel("signups-over-time");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [{ ...signups, sql: LEGACY_SEED_SIGNUPS_OVER_TIME_SQL }],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      signups.sql,
    );
  });

  it("repairs the exact pre-spine custom signups query", async () => {
    const signups = requiredFirstPartyPanel("signups-over-time");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [{ ...signups, sql: PRE_CUSTOM_SPINE_SIGNUPS_OVER_TIME_SQL }],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      signups.sql,
    );
  });

  it("repairs persisted uncapped signup and retention date spines", async () => {
    const signups = requiredFirstPartyPanel("signups-over-time");
    const retention = requiredFirstPartyPanel("retention-over-time");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          { ...signups, sql: PRE_CAPPED_SIGNUPS_OVER_TIME_SQL },
          { ...retention, sql: PRE_CAPPED_RETENTION_OVER_TIME_SQL },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panels = JSON.parse(updateCalls[0]![0].config).panels;
    expect(panels[0].sql).toBe(signups.sql);
    expect(panels[1].sql).toBe(retention.sql);
  });

  it("repairs the exact prior capped-spine retention query", async () => {
    const retention = requiredFirstPartyPanel("retention-over-time");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            ...retention,
            sql: PRE_SOURCE_SCAN_BOUNDS_RETENTION_OVER_TIME_SQL,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      retention.sql,
    );
  });

  it("repairs the exact pre-cohort-history retention query", async () => {
    const retention = requiredFirstPartyPanel("retention-over-time");
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          { ...retention, sql: PRE_COHORT_HISTORY_RETENTION_OVER_TIME_SQL },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    expect(JSON.parse(updateCalls[0]![0].config).panels[0].sql).toBe(
      retention.sql,
    );
  });

  it("repairs only the exact live custom new-vs-recurring panel", async () => {
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            id: "new-vs-recurring-users",
            sql: LEGACY_NEW_VS_RECURRING_USERS_SQL,
            config: {
              description:
                "Daily signed-in visitors split by first-ever session (New) vs return visit (Recurring), stacked with Recurring on the bottom and New on top. Docs excluded. A user is New only on their all-time first active day.",
            },
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panel = JSON.parse(updateCalls[0]![0].config).panels[0];
    expect(panel.sql).toContain("WITH activity AS");
    expect(panel.sql).toContain(
      "MIN(event_date) OVER (PARTITION BY NULLIF(user_key, '')) AS first_date",
    );
    expect(panel.sql).not.toContain("first_seen AS");
    expect(panel.sql.match(/FROM analytics_events/g)).toHaveLength(1);
    expect(panel.sql.match(/365 days/g)).toHaveLength(2);
    expect(panel.config.description).toContain("previous 365 days");
  });

  it("repairs the exact deployed bounded new-vs-recurring query", async () => {
    const allowList = `IN (${FIRST_PARTY_TEMPLATE_NAMES.map((name) => `'${name}'`).join(", ")})`;
    expect(DEPLOYED_NEW_VS_RECURRING_USERS_SQL.split(allowList)).toHaveLength(
      3,
    );
    const row = legacyRow({
      config: JSON.stringify({
        panels: [
          {
            id: "new-vs-recurring-users",
            sql: DEPLOYED_NEW_VS_RECURRING_USERS_SQL,
          },
        ],
      }),
    });
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      true,
    );

    const updateCalls = mocks.updateSet.mock.calls as unknown as Array<
      [{ config: string }]
    >;
    const panel = JSON.parse(updateCalls[0]![0].config).panels[0];
    expect(panel.sql.match(/FROM analytics_events/g)).toHaveLength(1);
    expect(panel.sql).toContain("MIN(event_date) OVER");
  });

  it("does not write a revision or change when its optimistic update loses", async () => {
    const row = legacyRow();
    const mocks = createDb(row, []);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      false,
    );

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.deleteRow).not.toHaveBeenCalled();
    expect(dbMocks.recordChange).not.toHaveBeenCalled();
  });

  it("rejects a failed revision insert from the transaction without publishing a change", async () => {
    const row = legacyRow();
    const revisionFailure = new Error("revision insert failed");
    const mocks = createDb(row, [{ id: row.id }], [], {
      insertError: revisionFailure,
    });
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).rejects.toBe(
      revisionFailure,
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transactionRollback).toHaveBeenCalledWith(revisionFailure);
    expect(dbMocks.recordChange).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a custom config",
      JSON.stringify({
        panels: [
          {
            id: "recurring-users-by-template",
            sql: "SELECT custom_recurring_users()",
          },
        ],
      }),
    ],
    [
      "a changed custom new-vs-recurring query",
      JSON.stringify({
        panels: [
          {
            id: "new-vs-recurring-users",
            sql: `${LEGACY_NEW_VS_RECURRING_USERS_SQL} `,
          },
        ],
      }),
    ],
    [
      "a changed custom signups date-fill query",
      JSON.stringify({
        panels: [
          {
            id: "signups-over-time",
            sql: `${LEGACY_SIGNUPS_OVER_TIME_SQL} `,
          },
        ],
      }),
    ],
    ["invalid JSON", "not-json"],
  ])("does not update %s", async (_label, config) => {
    const mocks = createDb(legacyRow({ config }));
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      false,
    );

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(dbMocks.recordChange).not.toHaveBeenCalled();
  });

  it("targets only the canonical dashboard id", async () => {
    const mocks = createDb(null);
    dbMocks.getDb.mockReturnValue(mocks.db);

    await expect(repairPersistedFirstPartyDashboardQueries()).resolves.toBe(
      false,
    );

    expect(mocks.dashboardSelectWhere).toHaveBeenCalledWith({
      type: "inArray",
      column: "id",
      values: [FIRST_PARTY_DASHBOARD_ID, FIRST_PARTY_BIGQUERY_DASHBOARD_ID],
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("repairUnboundedFirstPartyPanelsAcrossDashboards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T17:00:00.000Z"));
    dbMocks.getDb.mockReset();
    dbMocks.recordChange.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("repairs a non-canonical dashboard whose panel SQL matches a known-unbounded pattern", async () => {
    const [{ legacySql }] = UNBOUNDED_FIRST_PARTY_PANEL_FIXES;
    const row = {
      id: "someone-elses-dashboard",
      kind: "sql",
      config: JSON.stringify({
        panels: [
          {
            id: "sessions",
            title: "Sessions",
            source: "first-party",
            chartType: "line",
            width: 2,
            sql: legacySql,
          },
        ],
      }),
      title: "Someone Else's Dashboard",
      updatedAt: "2026-07-24T00:00:00.000Z",
      ownerEmail: "nicholas@builder.io",
      orgId: "builder",
      visibility: "org" as const,
    };
    const mocks = createDb(row, [{ id: row.id }]);
    dbMocks.getDb.mockReturnValue(mocks.db);

    const repairedCount =
      await repairUnboundedFirstPartyPanelsAcrossDashboards();

    expect(repairedCount).toBe(1);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(dbMocks.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ key: row.id, orgId: "builder" }),
    );
  });

  it("does not update a dashboard with no unbounded first-party panels", async () => {
    const row = {
      id: "already-fine",
      kind: "sql",
      config: JSON.stringify({
        panels: [{ id: "p", source: "first-party", sql: "SELECT 1" }],
      }),
      title: "Already Fine",
      updatedAt: "2026-07-24T00:00:00.000Z",
      ownerEmail: "nicholas@builder.io",
      orgId: null,
      visibility: "private" as const,
    };
    const mocks = createDb(row);
    dbMocks.getDb.mockReturnValue(mocks.db);

    const repairedCount =
      await repairUnboundedFirstPartyPanelsAcrossDashboards();

    expect(repairedCount).toBe(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
