# metrics.events

BigQuery table for **content SDK analytics** (impressions, clicks, conversions).

**Full path**: `<project_id>.metrics.events`
**Query-metrics placeholder**: `@events`

## Columns

| Column               | Type      | Description                                      |
|----------------------|-----------|--------------------------------------------------|
| `TYPE`               | STRING    | Event type: `impression`, `click`, `conversion`  |
| `CONTENT_ID`         | STRING    | Builder content entry ID                         |
| `OWNER_ID`           | STRING    | Organization public API key                      |
| `SESSION_ID`         | STRING    | Visitor session identifier                       |
| `VISITOR_ID`         | STRING    | Persistent visitor identifier                    |
| `DATE`               | TIMESTAMP | Event timestamp                                  |
| `URL_PATH`           | STRING    | Page URL path where event occurred               |
| `BROWSER_NAME`       | STRING    | Browser name (Chrome, Firefox, etc.)             |
| `DEVICE_TYPE`        | STRING    | Device type (desktop, mobile, tablet)            |
| `OPERATING_SYSTEM`   | STRING    | OS name                                          |
| `TEST_VARIATION_ID`  | STRING    | A/B test variation ID (nullable)                 |
| `AMOUNT`             | FLOAT     | Conversion amount (for conversion events)        |
| `METADATA`           | STRING    | JSON metadata blob                               |
| `UNIQUE`             | BOOLEAN   | Whether this is a unique event per session        |
| `ID`                 | STRING    | Unique event ID                                  |
| `_PARTITIONTIME`     | TIMESTAMP | BigQuery partition time (use for date filtering)  |

## Partitioning

Partitioned by `_PARTITIONTIME`. Always include `_PARTITIONTIME` filters to avoid full table scans.

## Example Queries

### Daily impressions (last 30 days)
```sql
SELECT
  TIMESTAMP_SECONDS(UNIX_SECONDS(DATE) - MOD(UNIX_SECONDS(DATE), 86400)) AS day,
  COUNT(*) AS impressions
FROM @events
WHERE
  TYPE = "impression"
  AND _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day
ORDER BY day DESC
```

### Unique visitors by day
```sql
SELECT
  TIMESTAMP_SECONDS(UNIX_SECONDS(DATE) - MOD(UNIX_SECONDS(DATE), 86400)) AS day,
  COUNT(DISTINCT VISITOR_ID) AS unique_visitors
FROM @events
WHERE
  _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day
ORDER BY day DESC
```

### Top content by impressions
```sql
SELECT
  CONTENT_ID,
  COUNT(*) AS impressions,
  COUNT(DISTINCT VISITOR_ID) AS unique_visitors
FROM @events
WHERE
  TYPE = "impression"
  AND _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY CONTENT_ID
ORDER BY impressions DESC
LIMIT 20
```

### Click-through rate by content
```sql
WITH impressions AS (
  SELECT CONTENT_ID, COUNT(*) AS count_impressions
  FROM @events
  WHERE TYPE = "impression"
    AND _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY CONTENT_ID
),
clicks AS (
  SELECT CONTENT_ID, COUNT(*) AS count_clicks
  FROM @events
  WHERE TYPE = "click"
    AND UNIQUE = TRUE
    AND _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY CONTENT_ID
)
SELECT
  clicks.CONTENT_ID,
  count_clicks,
  count_impressions,
  count_clicks / count_impressions AS ctr
FROM clicks
JOIN impressions ON impressions.CONTENT_ID = clicks.CONTENT_ID
WHERE count_impressions > 100
ORDER BY ctr DESC
LIMIT 20
```

### Device breakdown
```sql
SELECT
  DEVICE_TYPE,
  COUNT(*) AS events,
  COUNT(DISTINCT VISITOR_ID) AS unique_visitors
FROM @events
WHERE
  _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY DEVICE_TYPE
ORDER BY events DESC
```

### Browser breakdown
```sql
SELECT
  BROWSER_NAME,
  COUNT(*) AS events
FROM @events
WHERE
  _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY BROWSER_NAME
ORDER BY events DESC
```
