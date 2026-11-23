CREATE SCHEMA IF NOT EXISTS `builder-io-qa.a2_parity_east` OPTIONS(location='us-east1');
CREATE SCHEMA IF NOT EXISTS `builder-io-qa.a2_parity_q_east` OPTIONS(location='us-east1');

CREATE TABLE IF NOT EXISTS `builder-io-qa.a2_parity_east.events` AS
SELECT
  event_id,
  ['click', 'purchase', 'signup', 'view'][OFFSET(MOD(event_id - 1, 4))] AS event_type,
  TIMESTAMP_ADD(TIMESTAMP '2025-01-01 00:00:00+00', INTERVAL event_id SECOND) AS event_at,
  1 + MOD(event_id - 1, 500) AS customer_id
FROM UNNEST(GENERATE_ARRAY(1, 5000)) AS event_id;

CREATE TABLE IF NOT EXISTS `builder-io-qa.a2_parity_q_east.customers` AS
SELECT FORMAT('east-%03d', i) AS customer_id, i + 1000 AS amount
FROM UNNEST(GENERATE_ARRAY(1, 100)) AS i;
