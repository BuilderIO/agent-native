-- Builder.io production first-party Analytics warehouse.
-- Run this once with the authenticated Builder Google Cloud account:
--   bq query --use_legacy_sql=false < templates/analytics/scripts/first-party-analytics-bigquery.sql
--
-- The raw table is append-only. The query view removes retry duplicates by the
-- stable Postgres event id, and the two aggregate views preserve the existing
-- dashboard SQL names without writing rollups back to Neon.

CREATE SCHEMA IF NOT EXISTS `builder-3b0a2.analytics`
OPTIONS (location = "US");

CREATE TABLE IF NOT EXISTS `builder-3b0a2.analytics.first_party_analytics_events_raw` (
  id STRING NOT NULL,
  public_key_id STRING,
  event_name STRING NOT NULL,
  user_id STRING,
  anonymous_id STRING,
  user_key STRING,
  session_id STRING,
  timestamp TIMESTAMP NOT NULL,
  event_date DATE,
  received_at TIMESTAMP NOT NULL,
  url STRING,
  path STRING,
  hostname STRING,
  referrer STRING,
  app STRING,
  template STRING,
  signed_in STRING,
  properties STRING NOT NULL,
  context STRING NOT NULL,
  owner_email STRING NOT NULL,
  org_id STRING
)
PARTITION BY event_date
CLUSTER BY owner_email, org_id, event_name, app;

CREATE OR REPLACE VIEW `builder-3b0a2.analytics.first_party_analytics_events_raw_query` AS
SELECT * EXCEPT (_row_number)
FROM (
  SELECT
    raw.*,
    ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) AS _row_number
  FROM `builder-3b0a2.analytics.first_party_analytics_events_raw` AS raw
)
WHERE _row_number = 1;

CREATE OR REPLACE VIEW `builder-3b0a2.analytics.first_party_analytics_events_raw_daily_rollups` AS
WITH tenant_events AS (
  SELECT
    CASE
      WHEN org_id IS NOT NULL AND org_id <> '' THEN CONCAT('org:', org_id)
      ELSE CONCAT('user:', owner_email)
    END AS tenant_key,
    owner_email,
    org_id,
    event_date,
    event_name,
    COALESCE(app, '') AS app,
    COALESCE(template, '') AS template
  FROM `builder-3b0a2.analytics.first_party_analytics_events_raw_query`
  WHERE event_date IS NOT NULL
)
SELECT
  TO_HEX(SHA256(CONCAT(
    tenant_key, '|', CAST(event_date AS STRING), '|', event_name, '|', app,
    '|', template
  ))) AS id,
  tenant_key,
  ANY_VALUE(owner_email) AS owner_email,
  ANY_VALUE(org_id) AS org_id,
  event_date,
  event_name,
  app,
  template,
  COUNT(*) AS event_count
FROM tenant_events
GROUP BY tenant_key, event_date, event_name, app, template;

CREATE OR REPLACE VIEW `builder-3b0a2.analytics.first_party_analytics_events_raw_user_days` AS
WITH tenant_user_days AS (
  SELECT
    CASE
      WHEN org_id IS NOT NULL AND org_id <> '' THEN CONCAT('org:', org_id)
      ELSE CONCAT('user:', owner_email)
    END AS tenant_key,
    owner_email,
    org_id,
    event_date,
    user_key
  FROM `builder-3b0a2.analytics.first_party_analytics_events_raw_query`
  WHERE event_date IS NOT NULL AND user_key IS NOT NULL AND user_key <> ''
)
SELECT
  TO_HEX(SHA256(CONCAT(
    tenant_key, '|', CAST(event_date AS STRING), '|', user_key
  ))) AS id,
  tenant_key,
  ANY_VALUE(owner_email) AS owner_email,
  ANY_VALUE(org_id) AS org_id,
  event_date,
  user_key
FROM tenant_user_days
GROUP BY tenant_key, event_date, user_key;
