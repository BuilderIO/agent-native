// BigQuery table references
const ALL_PAGEVIEWS = "`builder-3b0a2.dbt_intermediate.all_pageviews`";
const PRODUCT_SIGNUPS = "`builder-3b0a2.dbt_analytics.product_signups`";
const SUBS = "`builder-3b0a2.dbt_mart.dim_subscriptions`";
const AMPLITUDE_EVENTS = "`builder-3b0a2.amplitude.EVENTS_182198`";
const EVENTS_PARTITIONED = "`builder-3b0a2.analytics.events_partitioned`";

// Helper to extract email from Amplitude user_properties JSON
function excludeInternalEmails(includeQQcom = false): string {
  const emailCheck = `COALESCE(JSON_VALUE(user_properties, '$.email'), '')`;
  if (includeQQcom) {
    return `${emailCheck} NOT LIKE '%@builder.io' AND ${emailCheck} NOT LIKE '%@qq.com'`;
  }
  return `${emailCheck} NOT LIKE '%@builder.io'`;
}

// Helper to exclude India from Amplitude events
function excludeCountry(): string {
  return `COALESCE(JSON_VALUE(user_properties, '$.Country'), '') != 'India'`;
}

// Helper to get date truncation based on cadence
function getDateTrunc(field: string, cadence: string): string {
  switch (cadence) {
    case "weekly":
      return `DATE_TRUNC(DATE(${field}), WEEK)`;
    case "monthly":
      return `DATE_TRUNC(DATE(${field}), MONTH)`;
    default: // daily
      return `DATE(${field})`;
  }
}

// ─── Chart 1: Site Traffic (Stacked Area) ───────────────────────────────
// Uses exact same pattern as overview dashboard

export function siteTrafficQuery(dateStart: string, dateEnd: string, cadence: string = "daily"): string {
  const dateTrunc = getDateTrunc("created_date", cadence);
  return `SELECT
  ${dateTrunc} AS period,
  COUNT(DISTINCT CASE WHEN IFNULL(page_type, '') != 'blog' THEN visitor_id END) AS not_blog,
  COUNT(DISTINCT CASE WHEN page_type = 'blog' THEN visitor_id END) AS blog
FROM ${ALL_PAGEVIEWS}
WHERE DATE(created_date) BETWEEN '${dateStart}' AND '${dateEnd}'
GROUP BY period
ORDER BY period`;
}

// ─── Chart 1b: Site Traffic from Amplitude (Comparison) ─────────────────
// Uses analytics.events_partitioned to compare with all_pageviews data

export function siteTrafficAmplitudeQuery(dateStart: string, dateEnd: string, cadence: string = "daily"): string {
  const dateTrunc = getDateTrunc("createddate", cadence);
  return `SELECT
  ${dateTrunc} AS period,
  COUNT(DISTINCT CASE WHEN url NOT LIKE '%builder.io/blog%' THEN json_extract_scalar(data, '$.visitorId') END) AS not_blog,
  COUNT(DISTINCT CASE WHEN url LIKE '%builder.io/blog%' THEN json_extract_scalar(data, '$.visitorId') END) AS blog
FROM ${EVENTS_PARTITIONED}
WHERE DATE(createddate) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND event = 'pageView'
  AND COALESCE(json_extract_scalar(data, '$.userEmail'), '') NOT LIKE '%@builder.io'
GROUP BY period
ORDER BY period`;
}

// ─── Chart 2: Daily Signups (Line) ──────────────────────────────────────
// Uses exact same pattern as overview dashboard

export function dailySignupsQuery(dateStart: string, dateEnd: string, cadence: string = "daily"): string {
  const dateTrunc = getDateTrunc("user_create_d", cadence);
  return `SELECT
  ${dateTrunc} AS period,
  COUNTIF(IFNULL(referrer, '') NOT LIKE '%@builder.io%') AS signups
FROM ${PRODUCT_SIGNUPS}
WHERE DATE(user_create_d) BETWEEN '${dateStart}' AND '${dateEnd}'
GROUP BY period
ORDER BY period`;
}

// ─── Chart 3: Hourly Signups (Line) ─────────────────────────────────────
// Uses exact same pattern as overview dashboard

export function hourlySignupsQuery(): string {
  return `SELECT
  TIMESTAMP_TRUNC(user_create_d, HOUR) AS period,
  COUNT(*) AS signups
FROM ${PRODUCT_SIGNUPS}
WHERE user_create_d >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY period
ORDER BY period`;
}

// ─── Chart 4: New Subs vs Cancelled (Line) ──────────────────────────────
// Two series: subscription plan cancelled + new subscription payment success
// Time range: Last 90 days

export function newVsCancelledSubsQuery(dateStart: string, dateEnd: string, cadence: string = "daily"): string {
  const dateTrunc = getDateTrunc("event_time", cadence);
  return `SELECT
  ${dateTrunc} AS period,
  event_type,
  COUNT(*) AS count
FROM ${AMPLITUDE_EVENTS}
WHERE DATE(event_time) BETWEEN '${dateStart}' AND '${dateEnd}'
  AND event_type IN ('subscription plan cancelled', 'new subscription - payment success')
  AND ${excludeInternalEmails(true)}
  AND ${excludeCountry()}
GROUP BY period, event_type
ORDER BY period, event_type`;
}
