CREATE SCHEMA IF NOT EXISTS `builder-io-qa.a2_parity` OPTIONS(location='US');
CREATE SCHEMA IF NOT EXISTS `builder-io-qa.a2_parity_q_us` OPTIONS(location='US');
CREATE SCHEMA IF NOT EXISTS `builder-io-qa.a2_parity_v2_old` OPTIONS(location='US');

CREATE TABLE IF NOT EXISTS `builder-io-qa.a2_parity.customers` AS
SELECT
  customer_id,
  CONCAT('Customer ', CAST(customer_id AS STRING)) AS name,
  CASE WHEN customer_id <= 166 THEN 'enterprise'
       WHEN customer_id <= 333 THEN 'mid-market' ELSE 'smb' END AS segment,
  IF(MOD(customer_id, 2) = 1, 'North', 'South') AS region,
  DATE_ADD(DATE '2025-01-01', INTERVAL customer_id DAY) AS signup_date
FROM UNNEST(GENERATE_ARRAY(1, 500)) AS customer_id;

CREATE TABLE IF NOT EXISTS `builder-io-qa.a2_parity.orders` AS
SELECT
  order_id,
  1 + MOD(order_id - 1, 500) AS customer_id,
  DATE_ADD(DATE '2025-01-01', INTERVAL MOD(order_id, 60) DAY) AS order_date,
  ['partner', 'sales', 'web'][OFFSET(MOD(order_id - 1, 3))] AS channel,
  CAST(1 + MOD(order_id, 100) AS NUMERIC) AS amount,
  ['paid', 'shipped', 'cancelled'][OFFSET(MOD(order_id - 1, 3))] AS status
FROM UNNEST(GENERATE_ARRAY(1, 20000)) AS order_id;

CREATE TABLE IF NOT EXISTS `builder-io-qa.a2_parity_q_us.customers` AS
SELECT FORMAT('us-%03d', amount) AS customer_id, amount
FROM UNNEST(GENERATE_ARRAY(1, 100)) AS amount;

CREATE TABLE IF NOT EXISTS `builder-io-qa.a2_parity.sql_v2_04` AS
SELECT row_id, 42 AS sentinel FROM UNNEST(GENERATE_ARRAY(1, 20000)) AS row_id;

CREATE TABLE IF NOT EXISTS `builder-io-qa.a2_parity_v2_old.sql_v2_04` AS
SELECT row_id, 7 AS sentinel FROM UNNEST(GENERATE_ARRAY(1, 20000)) AS row_id;
