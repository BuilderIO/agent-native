// ─── BigQuery table references (same as top-funnel) ─────────────────
const FIRST_PV = "`builder-3b0a2.dbt_staging_bigquery.first_pageviews`";
const SIGNUPS = "`builder-3b0a2.dbt_staging_bigquery.signups`";
const SIGMA_BLOG = "`builder-3b0a2.sigma_materialized.SIGDS_82deb8e2_40f8_4fb4_b3cb_caa011a72d29`";

const BLOG_META_SUBQUERY = `(
  SELECT
    REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') AS handle,
    FIRST_VALUE(H5YIATNDT5) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS author,
    FIRST_VALUE(ZZJ6XRJAII) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS pub_date,
    FIRST_VALUE(FTRKLGZM1R) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS purpose,
    FIRST_VALUE(Z52LFY52AK) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS topic,
    ROW_NUMBER() OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS _rn
  FROM ${SIGMA_BLOG}
  WHERE SUOHFYGIOG IS NOT NULL
    AND REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') IS NOT NULL
)`;

function blogMetaCte(): string {
  return `blog_meta AS (
  SELECT handle, author, pub_date, purpose, topic
  FROM ${BLOG_META_SUBQUERY}
  WHERE _rn = 1
)`;
}

function escapeStr(s: string): string {
  return s.replace(/'/g, "\\'");
}

function pubDateClause(pubDateStart: string): string {
  if (!pubDateStart) return "";
  return `\n  AND bc.pub_date >= '${escapeStr(pubDateStart)}'`;
}

// Author-level summary: total signups, traffic, article count per author
export function authorSummaryQuery(
  dateStart: string,
  dateEnd: string,
  pubDateStart: string,
): string {
  return `WITH ${blogMetaCte()}
SELECT
  bc.author,
  COUNT(DISTINCT v.visitor_id) AS new_visitors,
  COUNT(DISTINCT s.user_id) AS signups,
  SAFE_DIVIDE(COUNT(DISTINCT s.user_id), COUNT(DISTINCT v.visitor_id)) AS signup_rate,
  COUNT(DISTINCT bc.handle) AS article_count
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
INNER JOIN blog_meta bc ON REGEXP_EXTRACT(v.url, r'/blog/([^/?#]+)') = bc.handle
WHERE v.url LIKE '%/blog/%'
  AND v.created_date BETWEEN TIMESTAMP('${escapeStr(dateStart)}') AND TIMESTAMP('${escapeStr(dateEnd)}')
  AND bc.author IS NOT NULL
  AND bc.author != ''${pubDateClause(pubDateStart)}
GROUP BY bc.author
ORDER BY signups DESC`;
}

// Per-article breakdown: each blog post with signups + traffic
export function articleDetailQuery(
  dateStart: string,
  dateEnd: string,
  pubDateStart: string,
): string {
  return `WITH ${blogMetaCte()}
SELECT
  REGEXP_EXTRACT(v.url, r'https?://[^/]+(/?[^?#]*)') AS base_url,
  bc.author,
  bc.handle,
  CAST(bc.pub_date AS STRING) AS pub_date,
  bc.topic AS type,
  bc.purpose,
  COUNT(DISTINCT v.visitor_id) AS new_visitors,
  COUNT(DISTINCT s.user_id) AS signups,
  SAFE_DIVIDE(COUNT(DISTINCT s.user_id), COUNT(DISTINCT v.visitor_id)) AS signup_rate
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
INNER JOIN blog_meta bc ON REGEXP_EXTRACT(v.url, r'/blog/([^/?#]+)') = bc.handle
WHERE v.url LIKE '%/blog/%'
  AND v.created_date BETWEEN TIMESTAMP('${escapeStr(dateStart)}') AND TIMESTAMP('${escapeStr(dateEnd)}')
  AND bc.author IS NOT NULL
  AND bc.author != ''${pubDateClause(pubDateStart)}
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY signups DESC
LIMIT 500`;
}

// Timeseries of signups by author (for the chart)
export function authorTimeseriesQuery(
  dateStart: string,
  dateEnd: string,
  pubDateStart: string,
  metric: "signups" | "new_visitors",
  cadence: "WEEK" | "MONTH" = "WEEK",
): string {
  const valueExpr =
    metric === "signups"
      ? "COUNT(DISTINCT s.user_id)"
      : "COUNT(DISTINCT v.visitor_id)";
  return `WITH ${blogMetaCte()}
SELECT
  DATE_TRUNC(DATE(v.created_date), ${cadence}) AS flex_date,
  bc.author AS flex_view_by,
  ${valueExpr} AS value
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
INNER JOIN blog_meta bc ON REGEXP_EXTRACT(v.url, r'/blog/([^/?#]+)') = bc.handle
WHERE v.url LIKE '%/blog/%'
  AND v.created_date BETWEEN TIMESTAMP('${escapeStr(dateStart)}') AND TIMESTAMP('${escapeStr(dateEnd)}')
  AND bc.author IS NOT NULL
  AND bc.author != ''${pubDateClause(pubDateStart)}
GROUP BY 1, 2
ORDER BY 1`;
}
