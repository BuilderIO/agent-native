// Query to get signups and traffic for blog articles by handle
// Used to enrich Notion content calendar entries with analytics data

const FIRST_PV = "`builder-3b0a2.dbt_staging_bigquery.first_pageviews`";
const SIGNUPS = "`builder-3b0a2.dbt_staging_bigquery.signups`";

function escapeStr(s: string): string {
  return s.replace(/'/g, "\\'");
}

// Get traffic + signups per blog handle in a date range
export function blogHandleMetricsQuery(
  dateStart: string,
  dateEnd: string,
): string {
  return `SELECT
  REGEXP_EXTRACT(v.url, r'/blog/([^/?#]+)') AS handle,
  COUNT(DISTINCT v.visitor_id) AS new_visitors,
  COUNT(DISTINCT s.user_id) AS signups,
  SAFE_DIVIDE(COUNT(DISTINCT s.user_id), COUNT(DISTINCT v.visitor_id)) AS signup_rate
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
WHERE v.url LIKE '%/blog/%'
  AND v.created_date BETWEEN TIMESTAMP('${escapeStr(dateStart)}') AND TIMESTAMP('${escapeStr(dateEnd)}')
  AND REGEXP_EXTRACT(v.url, r'/blog/([^/?#]+)') IS NOT NULL
GROUP BY handle
ORDER BY signups DESC`;
}
