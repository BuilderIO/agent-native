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













CREATE OR REPLACE VIEW `builder-3b0a2.analytics.first_party_action_responses` AS
SELECT
  CASE
    WHEN org_id IS NOT NULL AND org_id <> '' THEN CONCAT('org:', org_id)
    ELSE CONCAT('user:', owner_email)
  END AS tenant_key,
  owner_email,
  org_id,
  event_date,
  session_id,




  COALESCE(
    NULLIF(template, ''),
    NULLIF(JSON_VALUE(properties, '$.templateId'), ''),
    NULLIF(JSON_VALUE(properties, '$.agent_native_template'), ''),
    NULLIF(JSON_VALUE(properties, '$.agentNativeTemplate'), ''),
    NULLIF(app, ''),
    NULLIF(JSON_VALUE(properties, '$.agent_native_app'), ''),
    NULLIF(JSON_VALUE(properties, '$.agentNativeApp'), ''),
    'unknown'
  ) AS app,
  COALESCE(NULLIF(JSON_VALUE(properties, '$.action'), ''), 'unknown') AS action,
  CASE
    WHEN UPPER(COALESCE(JSON_VALUE(properties, '$.method'), '')) = 'GET' THEN 'read'
    ELSE 'mutation'
  END AS call_type,
  CASE
    WHEN NULLIF(user_id, '') IS NOT NULL THEN 'signed_in'
    ELSE 'anonymous'
  END AS auth_state,
  CASE
    WHEN hostname LIKE 'beta.%' THEN 'beta'
    WHEN NULLIF(hostname, '') IS NOT NULL THEN 'prod'
    ELSE 'unknown'
  END AS deployment_env,
  CASE
    WHEN COALESCE(JSON_VALUE(properties, '$.outcome'), '') = 'cancelled' THEN 'cancelled'
    WHEN COALESCE(JSON_VALUE(properties, '$.outcome'), '') = 'timeout'
      AND COALESCE(JSON_VALUE(properties, '$.page_hidden'), '') = 'true' THEN 'suspended'
    WHEN COALESCE(JSON_VALUE(properties, '$.success'), '') = 'true' THEN 'success'
    ELSE 'failure'
  END AS outcome_class,
  CASE
    WHEN JSON_VALUE(properties, '$.sample_weight') IS NOT NULL
      THEN SAFE_CAST(JSON_VALUE(properties, '$.sample_weight') AS FLOAT64)
    WHEN JSON_VALUE(properties, '$.success') = 'true'
      AND COALESCE(SAFE_CAST(JSON_VALUE(properties, '$.duration_ms') AS FLOAT64), 1000) < 1000
      AND COALESCE(SAFE_CAST(JSON_VALUE(properties, '$.status_code') AS INT64), 200) < 400
      AND JSON_VALUE(properties, '$.framework_ready_wait_ms') IS NULL
      AND JSON_VALUE(properties, '$.startup_db_operation_wall_ms') IS NULL
      THEN 10
    ELSE 1
  END AS weight,
  SAFE_CAST(JSON_VALUE(properties, '$.duration_ms') AS FLOAT64) AS duration_ms,
  SAFE_CAST(JSON_VALUE(properties, '$.status_code') AS INT64) AS status_code,



  NULLIF(JSON_VALUE(properties, '$.page_hidden'), '') AS page_hidden
FROM `builder-3b0a2.analytics.first_party_analytics_events_raw_query`
WHERE event_name = 'action.response' AND event_date IS NOT NULL;
