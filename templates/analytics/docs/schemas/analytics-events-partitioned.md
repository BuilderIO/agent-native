# Application Events BigQuery Table

BigQuery table for **app-level events** (signups, page views, interactions, agent chat, etc.).

**Default full path**: `<project_id>.analytics.events_partitioned`
**Override**: set `ANALYTICS_BIGQUERY_EVENTS_TABLE` to `dataset.table` or `project.dataset.table`
**Query-metrics placeholder**: `@app_events`

## Columns

| Column           | Type      | Description                                                             |
| ---------------- | --------- | ----------------------------------------------------------------------- |
| `event`          | STRING    | Event category: `impression`, `interaction`, `signup`, `pageView`       |
| `name`           | STRING    | Event name/label (e.g. `authorize cli`, `agent chat message submitted`) |
| `data`           | STRING    | JSON blob with all tracked properties (see below)                       |
| `timestamp`      | TIMESTAMP | Event timestamp                                                         |
| `url`            | STRING    | Full URL where event occurred                                           |
| `organizationId` | STRING    | Organization, account, or workspace ID supplied by the event producer   |
| `sessionId`      | STRING    | User session identifier                                                 |
| `userId`         | STRING    | Application user ID                                                     |
| `visitorId`      | STRING    | Persistent visitor cookie ID                                            |
| `type`           | STRING    | Sub-type of event (e.g. `content`, `button`)                            |
| `kind`           | STRING    | Optional organization/account kind                                      |
| `modelName`      | STRING    | Content/model name supplied by the event producer, if applicable        |
| `modelId`        | STRING    | Content/model ID supplied by the event producer, if applicable          |
| `createdDate`    | TIMESTAMP | Partition column — always filter on this                                |

## Partitioning

Partitioned by `createdDate`. Always include `createdDate` filters for performance.

## The `data` JSON Blob

The `data` column is a JSON string containing all properties from `track.function.ts`. Key fields:

| JSON Path                       | Type    | Description                    |
| ------------------------------- | ------- | ------------------------------ |
| `data.userEmail`                | STRING  | User's email address           |
| `data.organizationId`           | STRING  | Organization/account ID        |
| `data.rootOrganizationId`       | STRING  | Parent org ID                  |
| `data.rootOrgName`              | STRING  | Parent org name                |
| `data.kind`                     | STRING  | Workspace/account kind         |
| `data.userId`                   | STRING  | Application user ID            |
| `data.userLoggedIn`             | BOOLEAN | Whether user was logged in     |
| `data.accountType`              | STRING  | Account type                   |
| `data.browser`                  | STRING  | Browser name                   |
| `data.browserVersion`           | STRING  | Browser version                |
| `data.os`                       | STRING  | Operating system               |
| `data.osVersion`                | STRING  | OS version                     |
| `data.deviceType`               | STRING  | Device type                    |
| `data.deviceVendor`             | STRING  | Device vendor                  |
| `data.utmSource`                | STRING  | UTM source                     |
| `data.utmMedium`                | STRING  | UTM medium                     |
| `data.utmCampaign`              | STRING  | UTM campaign                   |
| `data.referrer`                 | STRING  | Referrer URL                   |
| `data.initialReferrer`          | STRING  | First-touch referrer           |
| `data.attributionBucket`        | STRING  | Attribution medium bucket      |
| `data.initialAttributionBucket` | STRING  | First-touch attribution bucket |
| `data.sessionId`                | STRING  | Session ID                     |
| `data.isEnterpriseCompany`      | BOOLEAN | Enterprise flag                |
| `data.appEnvironment`           | STRING  | `web`, `vscode`, or `electron` |
| `data.featureFlags`             | STRING  | JSON of active feature flags   |
| `data.app`                      | STRING  | App identifier                 |
| `data.host`                     | STRING  | Hostname                       |
| `data.url`                      | STRING  | Full page URL                  |

## Example Queries

### Daily signups (last 30 days)

```sql
SELECT
  TIMESTAMP_TRUNC(createdDate, DAY) AS day,
  COUNT(*) AS signups
FROM @app_events
WHERE
  event = "signup"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day
ORDER BY day DESC
```

### Agent chat messages over time

```sql
SELECT
  TIMESTAMP_TRUNC(createdDate, DAY) AS day,
  COUNT(*) AS messages
FROM @app_events
WHERE
  name = "agent chat message submitted"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day
ORDER BY day DESC
```

### Top events by count

```sql
SELECT
  event,
  name,
  COUNT(*) AS count
FROM @app_events
WHERE
  createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY event, name
ORDER BY count DESC
LIMIT 50
```

### Active users by day

```sql
SELECT
  TIMESTAMP_TRUNC(createdDate, DAY) AS day,
  COUNT(DISTINCT userId) AS active_users
FROM @app_events
WHERE
  createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND userId IS NOT NULL
GROUP BY day
ORDER BY day DESC
```

### PageViews by URL path

```sql
SELECT
  url,
  COUNT(*) AS views
FROM @app_events
WHERE
  event = "pageView"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY url
ORDER BY views DESC
LIMIT 50
```

### Signups by attribution source

```sql
SELECT
  JSON_VALUE(data, '$.attributionBucket') AS source,
  COUNT(*) AS signups
FROM @app_events
WHERE
  event = "signup"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY source
ORDER BY signups DESC
```

### Events filtered by organization

```sql
SELECT
  event,
  name,
  COUNT(*) AS count
FROM @app_events
WHERE
  organizationId = "YOUR_ORG_ID"
  AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY event, name
ORDER BY count DESC
```

### Users by browser/OS

```sql
SELECT
  JSON_VALUE(data, '$.browser') AS browser,
  JSON_VALUE(data, '$.os') AS os,
  COUNT(DISTINCT userId) AS users
FROM @app_events
WHERE
  createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY browser, os
ORDER BY users DESC
LIMIT 20
```
