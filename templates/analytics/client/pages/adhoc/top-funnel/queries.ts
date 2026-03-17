import type { DateCadence, ViewByOption } from "./types";

// ─── BigQuery table references ─────────────────────────────────────────
const FIRST_PV = "`your-gcp-project-id.dbt_staging_bigquery.first_pageviews`";
const ALL_PV = "`your-gcp-project-id.dbt_staging_bigquery.all_pageviews`";
const SIGNUPS = "`your-gcp-project-id.dbt_staging_bigquery.signups`";
const PRODUCT_SIGNUPS = "`your-gcp-project-id.dbt_analytics.product_signups`";
const HS_CONTACTS = "`your-gcp-project-id.dbt_mart.dim_hs_contacts`";
const DEALS = "`your-gcp-project-id.dbt_mart.dim_deals`";
const DEAL_FIRST_CONTACT =
  "`your-gcp-project-id.dbt_intermediate.deal_first_contact`";
const SUBS = "`your-gcp-project-id.dbt_mart.dim_subscriptions`";

// Blog metadata from Sigma-materialized Google Sheet (the actual source of
// truth for author, topic, persona, purpose, sub-type).
// Cryptic column mapping:
//   SUOHFYGIOG = blog URL       H5YIATNDT5 = author
//   ZZJ6XRJAII = publish date   FTRKLGZM1R = purpose (Acquisition/Awareness)
//   IFHWPU1IDO = persona        Z52LFY52AK = topic
//   _DGCBJNKLE = sub-type       JQL-G1QE-B = sub-topic
const SIGMA_BLOG =
  "`your-gcp-project-id.sigma_materialized.SIGDS_82deb8e2_40f8_4fb4_b3cb_caa011a72d29`";

// Deduplicated subquery — the sigma sheet has duplicate rows (http vs https).
// We extract the slug and pick one row per slug.
const BLOG_META_SUBQUERY = `(
  SELECT
    REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') AS handle,
    FIRST_VALUE(H5YIATNDT5) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS author,
    FIRST_VALUE(ZZJ6XRJAII) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS pub_date,
    FIRST_VALUE(FTRKLGZM1R) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS purpose,
    FIRST_VALUE(IFHWPU1IDO) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS persona,
    FIRST_VALUE(Z52LFY52AK) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS topic,
    FIRST_VALUE(\`_DGCBJNKLE\`) OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS sub_type,
    ROW_NUMBER() OVER (PARTITION BY REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') ORDER BY UPDATED_AT DESC) AS _rn
  FROM ${SIGMA_BLOG}
  WHERE SUOHFYGIOG IS NOT NULL
    AND REGEXP_EXTRACT(SUOHFYGIOG, r'/blog/([^/?#]+)') IS NOT NULL
)`;

// Inline the deduplicated blog meta — wraps with WHERE _rn = 1
function blogMetaCte(): string {
  return `blog_meta AS (
  SELECT handle, author, pub_date, purpose, persona, topic, sub_type
  FROM ${BLOG_META_SUBQUERY}
  WHERE _rn = 1
)`;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function cadenceToTrunc(cadence: DateCadence): string {
  switch (cadence) {
    case "Daily":
      return "DAY";
    case "Weekly":
      return "WEEK";
    case "Monthly":
      return "MONTH";
    case "Quarterly":
      return "QUARTER";
  }
}

// Derive page_type from URL since first_pageviews doesn't have it
const PAGE_TYPE_EXPR = `CASE
    WHEN v.url LIKE '%/blog/%' THEN 'blog'
    WHEN v.url LIKE '%/docs/%' THEN 'docs'
    WHEN v.url LIKE '%/m/explainers/%' THEN 'explainer'
    WHEN REGEXP_CONTAINS(v.url, r'builder\\.io/?(?:\\?|$)') THEN 'marketing'
    WHEN v.url LIKE '%/sign-up%' OR v.url LIKE '%/signup%' THEN 'webapp'
    WHEN v.url LIKE '%/login%' THEN 'webapp'
    WHEN v.url LIKE '%/spaces%' THEN 'webapp'
    WHEN v.url LIKE '%/account%' THEN 'webapp'
    WHEN v.url LIKE '%/content%' OR v.url LIKE '%/models%' THEN 'webapp'
    WHEN v.url LIKE '%/m/%' OR v.url LIKE '%/edit/%' THEN 'webapp'
    WHEN v.url LIKE '%/fiddle%' THEN 'webapp'
    ELSE 'other'
  END`;

const SUB_PAGE_TYPE_EXPR = `CASE
    WHEN v.url LIKE '%/blog/%' THEN 'blog'
    WHEN v.url LIKE '%/docs/%' THEN 'docs'
    WHEN v.url LIKE '%/m/explainers/%' THEN 'explainer'
    WHEN REGEXP_CONTAINS(v.url, r'builder\\.io/?(?:\\?|$)') THEN 'homepage'
    WHEN v.url LIKE '%/sign-up%' OR v.url LIKE '%/signup%' THEN 'signup'
    WHEN v.url LIKE '%/login%' THEN 'login'
    WHEN v.url LIKE '%/spaces%' THEN 'spaces'
    WHEN v.url LIKE '%/account%' THEN 'account'
    WHEN v.url LIKE '%/content%' THEN 'content-list'
    WHEN v.url LIKE '%/m/%' OR v.url LIKE '%/edit/%' THEN 'visual-editor'
    WHEN v.url LIKE '%/ai%' THEN 'ai'
    ELSE 'other'
  END`;

const BASE_URL_EXPR = `REGEXP_EXTRACT(v.url, r'https?://[^/]+(/?[^?#]*)')`;

function viewByToExpr(viewBy: ViewByOption, useAllPv = false): string {
  const prefix = useAllPv ? "pv" : "v";
  switch (viewBy) {
    case "Page Type":
      return useAllPv ? `${prefix}.page_type` : PAGE_TYPE_EXPR;
    case "Page Sub Type":
      return useAllPv ? `${prefix}.sub_page_type` : SUB_PAGE_TYPE_EXPR;
    case "Channel":
      return useAllPv ? `${prefix}.first_touch_channel` : `${prefix}.channel`;
    case "Referrer Channel":
      return useAllPv ? `${prefix}.session_channel` : `${prefix}.channel`;
    case "Base URL":
      return useAllPv
        ? `REGEXP_EXTRACT(${prefix}.url, r'https?://[^/]+(/?[^?#]*)')`
        : BASE_URL_EXPR;
    case "UTM Campaign":
      return `${prefix}.utm_campaign`;
    case "UTM Source":
      return `${prefix}.utm_source`;
    case "Referrer Sub Channel":
      return useAllPv ? `${prefix}.c_referrer` : `${prefix}.referrer`;
    case "Blog Author":
      return "bc.author";
    case "Blog Persona":
      return "bc.persona";
    case "Blog Type":
      return "bc.topic";
    case "Blog Subtype":
      return "bc.sub_type";
    case "Blog Purpose":
      return "bc.purpose";
  }
}

function escapeStr(s: string): string {
  return s.replace(/'/g, "\\'");
}

function inList(values: string[]): string {
  return values.map((v) => `'${escapeStr(v)}'`).join(", ");
}

// Blog handle extraction from pageview URL
function blogJoinExpr(urlAlias: string): string {
  return `REGEXP_EXTRACT(${urlAlias}.url, r'/blog/([^/?#]+)')`;
}

// ─── Tab 1: First Touch Traffic ────────────────────────────────────────

interface Tab1Filters {
  dateStart: string;
  dateEnd: string;
  pageType: string[];
  channel: string[];
  referrer: string[];
  baseUrl: string[];
  subPageType: string[];
  urlFilter?: string;
  author?: string[];
}

function buildTab1Where(f: Tab1Filters): string {
  const clauses: string[] = [
    `v.created_date BETWEEN TIMESTAMP('${f.dateStart}') AND TIMESTAMP('${f.dateEnd}')`,
  ];
  if (f.pageType.length)
    clauses.push(`(${PAGE_TYPE_EXPR}) IN (${inList(f.pageType)})`);
  if (f.channel.length) clauses.push(`v.channel IN (${inList(f.channel)})`);
  if (f.referrer.length) clauses.push(`v.referrer IN (${inList(f.referrer)})`);
  if (f.baseUrl.length)
    clauses.push(`(${BASE_URL_EXPR}) IN (${inList(f.baseUrl)})`);
  if (f.subPageType.length)
    clauses.push(`(${SUB_PAGE_TYPE_EXPR}) IN (${inList(f.subPageType)})`);
  if (f.urlFilter)
    clauses.push(`(${BASE_URL_EXPR}) LIKE '%${escapeStr(f.urlFilter)}%'`);
  if (f.author?.length) clauses.push(`bc.author IN (${inList(f.author)})`);
  return clauses.join("\n  AND ");
}

export function chartQuery(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab1Filters | Tab3Filters,
  isTab3 = false,
): string {
  if (isTab3) return chartQueryTab3(cadence, viewBy, filters as Tab3Filters);

  const trunc = cadenceToTrunc(cadence);
  const viewByExpr = viewByToExpr(viewBy);
  const where = buildTab1Where(filters);

  return `WITH ${blogMetaCte()}
SELECT
  DATE_TRUNC(DATE(v.created_date), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  COUNT(DISTINCT v.visitor_id) AS new_visitors,
  COUNT(DISTINCT s.user_id) AS signups,
  SAFE_DIVIDE(COUNT(DISTINCT s.user_id), COUNT(DISTINCT v.visitor_id)) AS signup_rate
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
LEFT JOIN blog_meta bc ON ${blogJoinExpr("v")} = bc.handle
WHERE ${where}
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

export function qlsQuery(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab1Filters | Tab3Filters,
  isTab3 = false,
): string {
  if (isTab3) return qlsQueryTab3(cadence, viewBy, filters as Tab3Filters);

  const trunc = cadenceToTrunc(cadence);
  const viewByExpr = viewByToExpr(viewBy);
  const where = buildTab1Where(filters);

  return `WITH ${blogMetaCte()}
SELECT
  DATE_TRUNC(DATE(v.created_date), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  COUNT(DISTINCT CASE WHEN c.date_moved_from_s0 IS NOT NULL THEN v.visitor_id END) AS ql_count
FROM ${FIRST_PV} v
LEFT JOIN ${HS_CONTACTS} c ON v.visitor_id = c.b_visitor_id
LEFT JOIN blog_meta bc ON ${blogJoinExpr("v")} = bc.handle
WHERE ${where}
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

export function pipelineQuery(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab1Filters | Tab3Filters,
  isTab3 = false,
): string {
  if (isTab3) return pipelineQueryTab3(cadence, viewBy, filters as Tab3Filters);

  const trunc = cadenceToTrunc(cadence);
  const viewByExpr = viewByToExpr(viewBy);
  const where = buildTab1Where(filters);

  return `WITH ${blogMetaCte()}
SELECT
  DATE_TRUNC(DATE(v.created_date), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  SUM(CASE WHEN d.stage_name IN ('S1', 'S2', 'S3') THEN d.amount ELSE 0 END) AS pipeline_amount
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
LEFT JOIN ${HS_CONTACTS} c ON v.visitor_id = c.b_visitor_id
LEFT JOIN ${DEAL_FIRST_CONTACT} dfc ON CAST(c.contact_id AS STRING) = CAST(dfc.contact_id AS STRING)
LEFT JOIN ${DEALS} d ON CAST(dfc.deal_id AS STRING) = d.deal_id
LEFT JOIN blog_meta bc ON ${blogJoinExpr("v")} = bc.handle
WHERE ${where}
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

export function ssArrQuery(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab1Filters | Tab3Filters,
  isTab3 = false,
): string {
  if (isTab3) return ssArrQueryTab3(cadence, viewBy, filters as Tab3Filters);

  const trunc = cadenceToTrunc(cadence);
  const viewByExpr = viewByToExpr(viewBy);
  const where = buildTab1Where(filters);

  return `WITH ${blogMetaCte()}
SELECT
  DATE_TRUNC(DATE(v.created_date), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  SUM(CASE WHEN v.created_date < sub.start_date THEN sub.subscription_arr ELSE 0 END) AS ss_arr
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
LEFT JOIN ${SUBS} sub ON s.root_organization_id = sub.root_id
LEFT JOIN blog_meta bc ON ${blogJoinExpr("v")} = bc.handle
WHERE ${where}
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

// Valid sort columns for the page performance table
const VALID_SORT_COLS = new Set([
  "url",
  "author",
  "type",
  "ai_sub_type",
  "purpose",
  "persona",
  "day_of_pub_date",
  "new_visitors",
  "pct_signups",
  "signups",
  "pct_paid_subs",
  "ss_paid_subs",
  "marketing_contact",
  "pct_icp_signups",
  "icp_signups",
  "mql",
  "sal",
  "qualified_deals",
  "qualified_pipeline",
  "closed_won_amount",
  "ss_arr",
]);

function sanitizeSortCol(col: string): string {
  return VALID_SORT_COLS.has(col) ? col : "signups";
}

export interface PagePerfSort {
  col: string;
  dir: "asc" | "desc";
}

// Page performance table (Tab 1)
export function pagePerformanceQuery(
  filters: Tab1Filters | Tab3Filters,
  isTab3 = false,
  sort: PagePerfSort = { col: "signups", dir: "desc" },
): string {
  if (isTab3) return pagePerformanceQueryTab3(filters as Tab3Filters, sort);

  const where = buildTab1Where(filters);
  const orderCol = sanitizeSortCol(sort.col);
  const orderDir = sort.dir === "asc" ? "ASC" : "DESC";

  return `WITH ${blogMetaCte()}
SELECT
  ${BASE_URL_EXPR} AS url,
  bc.author,
  bc.topic AS type,
  bc.sub_type AS ai_sub_type,
  bc.purpose,
  bc.persona,
  CAST(bc.pub_date AS STRING) AS day_of_pub_date,
  COUNT(DISTINCT v.visitor_id) AS new_visitors,
  SAFE_DIVIDE(COUNT(DISTINCT s.user_id), COUNT(DISTINCT v.visitor_id)) AS pct_signups,
  COUNT(DISTINCT s.user_id) AS signups,
  0.0 AS pct_paid_subs,
  0 AS ss_paid_subs,
  0 AS marketing_contact,
  SAFE_DIVIDE(
    COUNT(DISTINCT CASE WHEN c.company_fit_score >= 4 THEN s.user_id END),
    NULLIF(COUNT(DISTINCT s.user_id), 0)
  ) AS pct_icp_signups,
  COUNT(DISTINCT CASE WHEN c.company_fit_score >= 4 THEN s.user_id END) AS icp_signups,
  COUNT(DISTINCT CASE WHEN c.date_entered_mql IS NOT NULL THEN CAST(c.contact_id AS STRING) END) AS mql,
  COUNT(DISTINCT CASE WHEN c.date_entered_sal IS NOT NULL THEN CAST(c.contact_id AS STRING) END) AS sal,
  COUNT(DISTINCT CASE WHEN c.date_entered_s1 IS NOT NULL THEN CAST(c.contact_id AS STRING) END) AS qualified_deals,
  0 AS qualified_pipeline,
  0 AS closed_won_amount,
  0 AS ss_arr
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
LEFT JOIN ${HS_CONTACTS} c ON v.visitor_id = c.b_visitor_id
LEFT JOIN blog_meta bc ON ${blogJoinExpr("v")} = bc.handle
WHERE ${where}
GROUP BY 1, 2, 3, 4, 5, 6, 7
ORDER BY ${orderCol} ${orderDir}
LIMIT 500`;
}

// ─── Tab 3: Page Performance (uses all_pageviews for page_type) ────────

interface Tab3Filters extends Tab1Filters {
  utmMedium: string[];
  utmSource: string[];
  utmTerm: string[];
  utmCampaign: string[];
  utmContent: string[];
  author: string[];
  type: string[];
  subType: string[];
  purpose: string[];
  persona: string[];
  pubDateStart: string;
}

function buildTab3Where(f: Tab3Filters): string {
  const clauses: string[] = [
    `pv.created_date BETWEEN TIMESTAMP('${f.dateStart}') AND TIMESTAMP('${f.dateEnd}')`,
  ];
  if (f.pageType.length) {
    const hasExplainer = f.pageType.includes("explainer");
    const otherTypes = f.pageType.filter((t) => t !== "explainer");
    const parts: string[] = [];
    if (otherTypes.length)
      parts.push(`pv.page_type IN (${inList(otherTypes)})`);
    if (hasExplainer) parts.push(`pv.url LIKE '%/m/explainers/%'`);
    clauses.push(`(${parts.join(" OR ")})`);
  }
  if (f.channel.length)
    clauses.push(`pv.first_touch_channel IN (${inList(f.channel)})`);
  if (f.subPageType.length) {
    const hasExplainer = f.subPageType.includes("explainer");
    const otherTypes = f.subPageType.filter((t) => t !== "explainer");
    const parts: string[] = [];
    if (otherTypes.length)
      parts.push(`pv.sub_page_type IN (${inList(otherTypes)})`);
    if (hasExplainer) parts.push(`pv.url LIKE '%/m/explainers/%'`);
    clauses.push(`(${parts.join(" OR ")})`);
  }
  if (f.utmMedium.length)
    clauses.push(`pv.utm_medium IN (${inList(f.utmMedium)})`);
  if (f.utmSource.length)
    clauses.push(`pv.utm_source IN (${inList(f.utmSource)})`);
  if (f.utmTerm.length) clauses.push(`pv.utm_term IN (${inList(f.utmTerm)})`);
  if (f.utmCampaign.length)
    clauses.push(`pv.utm_campaign IN (${inList(f.utmCampaign)})`);
  if (f.utmContent.length)
    clauses.push(`pv.utm_content IN (${inList(f.utmContent)})`);
  if (f.author.length) clauses.push(`bc.author IN (${inList(f.author)})`);
  if (f.type.length) clauses.push(`bc.topic IN (${inList(f.type)})`);
  if (f.purpose.length) clauses.push(`bc.purpose IN (${inList(f.purpose)})`);
  if (f.pubDateStart) clauses.push(`bc.pub_date >= '${f.pubDateStart}'`);
  if (f.referrer.length)
    clauses.push(`pv.c_referrer IN (${inList(f.referrer)})`);
  if (f.baseUrl.length)
    clauses.push(
      `REGEXP_EXTRACT(pv.url, r'https?://[^/]+(/?[^?#]*)') IN (${inList(f.baseUrl)})`,
    );
  return clauses.join("\n  AND ");
}

function chartQueryTab3(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab3Filters,
): string {
  const trunc = cadenceToTrunc(cadence);
  const viewByExpr = viewByToExpr(viewBy, true);
  const where = buildTab3Where(filters);

  return `WITH ${blogMetaCte()},
first_pv AS (
  SELECT pv.visitor_id, MIN(pv.created_date) AS first_date
  FROM ${ALL_PV} pv
  LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
  WHERE ${where}
  GROUP BY pv.visitor_id
)
SELECT
  DATE_TRUNC(DATE(fp.first_date), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  COUNT(DISTINCT pv.visitor_id) AS new_visitors,
  COUNT(DISTINCT s.user_id) AS signups,
  SAFE_DIVIDE(COUNT(DISTINCT s.user_id), COUNT(DISTINCT pv.visitor_id)) AS signup_rate
FROM first_pv fp
JOIN ${ALL_PV} pv ON fp.visitor_id = pv.visitor_id AND pv.created_date = fp.first_date
LEFT JOIN ${SIGNUPS} s ON pv.visitor_id = s.visitor_id
LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

function qlsQueryTab3(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab3Filters,
): string {
  const trunc = cadenceToTrunc(cadence);
  const viewByExpr = viewByToExpr(viewBy, true);
  const where = buildTab3Where(filters);

  return `WITH ${blogMetaCte()},
first_pv AS (
  SELECT pv.visitor_id, MIN(pv.created_date) AS first_date
  FROM ${ALL_PV} pv
  LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
  WHERE ${where}
  GROUP BY pv.visitor_id
)
SELECT
  DATE_TRUNC(DATE(fp.first_date), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  COUNT(DISTINCT CASE WHEN c.date_moved_from_s0 IS NOT NULL THEN pv.visitor_id END) AS ql_count
FROM first_pv fp
JOIN ${ALL_PV} pv ON fp.visitor_id = pv.visitor_id AND pv.created_date = fp.first_date
LEFT JOIN ${HS_CONTACTS} c ON pv.visitor_id = c.b_visitor_id
LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

function pipelineQueryTab3(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab3Filters,
): string {
  const trunc = cadenceToTrunc(cadence);
  const viewByExpr = viewByToExpr(viewBy, true);
  const where = buildTab3Where(filters);

  return `WITH ${blogMetaCte()},
first_pv AS (
  SELECT pv.visitor_id, MIN(pv.created_date) AS first_date
  FROM ${ALL_PV} pv
  LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
  WHERE ${where}
  GROUP BY pv.visitor_id
)
SELECT
  DATE_TRUNC(DATE(fp.first_date), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  0 AS pipeline_amount
FROM first_pv fp
JOIN ${ALL_PV} pv ON fp.visitor_id = pv.visitor_id AND pv.created_date = fp.first_date
LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

function ssArrQueryTab3(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab3Filters,
): string {
  const trunc = cadenceToTrunc(cadence);
  const viewByExpr = viewByToExpr(viewBy, true);
  const where = buildTab3Where(filters);

  return `WITH ${blogMetaCte()},
first_pv AS (
  SELECT pv.visitor_id, MIN(pv.created_date) AS first_date
  FROM ${ALL_PV} pv
  LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
  WHERE ${where}
  GROUP BY pv.visitor_id
)
SELECT
  DATE_TRUNC(DATE(fp.first_date), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  0 AS ss_arr
FROM first_pv fp
JOIN ${ALL_PV} pv ON fp.visitor_id = pv.visitor_id AND pv.created_date = fp.first_date
LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

function pagePerformanceQueryTab3(
  filters: Tab3Filters,
  sort: PagePerfSort = { col: "signups", dir: "desc" },
): string {
  const where = buildTab3Where(filters);
  const orderCol = sanitizeSortCol(sort.col);
  const orderDir = sort.dir === "asc" ? "ASC" : "DESC";

  return `WITH ${blogMetaCte()},
first_pv AS (
  SELECT pv.visitor_id, MIN(pv.created_date) AS first_date
  FROM ${ALL_PV} pv
  LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
  WHERE ${where}
  GROUP BY pv.visitor_id
)
SELECT
  REGEXP_EXTRACT(pv.url, r'https?://[^/]+(/?[^?#]*)') AS url,
  bc.author,
  bc.topic AS type,
  bc.sub_type AS ai_sub_type,
  bc.purpose,
  bc.persona,
  CAST(bc.pub_date AS STRING) AS day_of_pub_date,
  COUNT(DISTINCT pv.visitor_id) AS new_visitors,
  SAFE_DIVIDE(COUNT(DISTINCT s.user_id), COUNT(DISTINCT pv.visitor_id)) AS pct_signups,
  COUNT(DISTINCT s.user_id) AS signups,
  0.0 AS pct_paid_subs,
  0 AS ss_paid_subs,
  0 AS marketing_contact,
  SAFE_DIVIDE(
    COUNT(DISTINCT CASE WHEN c.company_fit_score >= 4 THEN s.user_id END),
    NULLIF(COUNT(DISTINCT s.user_id), 0)
  ) AS pct_icp_signups,
  COUNT(DISTINCT CASE WHEN c.company_fit_score >= 4 THEN s.user_id END) AS icp_signups,
  COUNT(DISTINCT CASE WHEN c.date_entered_mql IS NOT NULL THEN CAST(c.contact_id AS STRING) END) AS mql,
  COUNT(DISTINCT CASE WHEN c.date_entered_sal IS NOT NULL THEN CAST(c.contact_id AS STRING) END) AS sal,
  0 AS qualified_deals,
  0 AS qualified_pipeline,
  0 AS closed_won_amount,
  0 AS ss_arr
FROM first_pv fp
JOIN ${ALL_PV} pv ON fp.visitor_id = pv.visitor_id AND pv.created_date = fp.first_date
LEFT JOIN ${SIGNUPS} s ON pv.visitor_id = s.visitor_id
LEFT JOIN ${HS_CONTACTS} c ON pv.visitor_id = c.b_visitor_id
LEFT JOIN blog_meta bc ON REGEXP_EXTRACT(pv.url, r'/blog/([^/?#]+)') = bc.handle
GROUP BY 1, 2, 3, 4, 5, 6, 7
ORDER BY ${orderCol} ${orderDir}
LIMIT 500`;
}

// ─── Tab 2: Signups by Channel (signup-centric) ────────────────────────

interface Tab2Filters {
  dateStart: string;
  dateEnd: string;
  coalesceChannel: string[];
  pageType: string[];
  referrer: string[];
  icpFlag: string[];
  paidSubFlag: string[];
  subscriptionAfterSignup: string[];
  spaceKind: string[];
  urlContainsFigma: string[];
}

function buildTab2Where(f: Tab2Filters): string {
  const clauses: string[] = [
    `ps.user_create_d BETWEEN TIMESTAMP('${f.dateStart}') AND TIMESTAMP('${f.dateEnd}')`,
  ];
  if (f.coalesceChannel.length)
    clauses.push(`ps.channel IN (${inList(f.coalesceChannel)})`);
  if (f.icpFlag.length) clauses.push(`ps.icp_flag IN (${inList(f.icpFlag)})`);
  if (f.referrer.length) clauses.push(`ps.referrer IN (${inList(f.referrer)})`);
  return clauses.join("\n  AND ");
}

export function signupCentricChartQuery(
  cadence: DateCadence,
  viewBy: ViewByOption,
  filters: Tab2Filters,
): string {
  const trunc = cadenceToTrunc(cadence);
  const where = buildTab2Where(filters);

  let viewByExpr: string;
  switch (viewBy) {
    case "Channel":
      viewByExpr = "ps.channel";
      break;
    case "UTM Source":
      viewByExpr = "ps.utm_source";
      break;
    case "UTM Campaign":
      viewByExpr = "ps.utm_campaign";
      break;
    default:
      viewByExpr = "ps.channel";
      break;
  }

  return `SELECT
  DATE_TRUNC(DATE(ps.user_create_d), ${trunc}) AS flex_date,
  ${viewByExpr} AS flex_view_by,
  COUNT(DISTINCT ps.user_id) AS signups,
  SAFE_DIVIDE(
    COUNT(DISTINCT CASE WHEN ps.top_subscription IS NOT NULL AND ps.top_subscription != '' THEN ps.user_id END),
    COUNT(DISTINCT ps.user_id)
  ) AS signup_to_paid_conversion,
  COUNT(DISTINCT CASE WHEN c.date_entered_s0 IS NOT NULL THEN CAST(c.contact_id AS STRING) END) AS all_deals_s0,
  COUNT(DISTINCT CASE WHEN c.date_entered_s1 IS NOT NULL THEN CAST(c.contact_id AS STRING) END) AS qualified_deals_s1
FROM ${PRODUCT_SIGNUPS} ps
LEFT JOIN ${HS_CONTACTS} c ON ps.user_id = c.builder_user_id
WHERE ${where}
GROUP BY flex_date, flex_view_by
ORDER BY flex_date`;
}

// ─── Tab 4: Timeseries for a single URL ────────────────────────────────

export function timeseriesQuery(
  baseUrlContains: string,
  cadence: DateCadence = "Weekly",
): string {
  const trunc = cadenceToTrunc(cadence);
  return `SELECT
  DATE_TRUNC(DATE(v.created_date), ${trunc}) AS flex_date,
  CASE
    WHEN c.company_fit_score >= 4 THEN 'ICP'
    WHEN c.company_fit_score IS NOT NULL THEN 'Not ICP'
    ELSE 'Unknown'
  END AS flex_view_by,
  COUNT(DISTINCT v.visitor_id) AS new_visitors,
  COUNT(DISTINCT s.user_id) AS signups
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
LEFT JOIN ${HS_CONTACTS} c ON v.visitor_id = c.b_visitor_id
WHERE v.url LIKE '%${escapeStr(baseUrlContains)}%'
GROUP BY 1, 2
ORDER BY 1`;
}

// ─── Referrer Sub Channel (modal) ──────────────────────────────────────

export function referrerSubChannelQuery(filters: Tab1Filters): string {
  const where = buildTab1Where(filters);
  return `SELECT
  v.referrer AS referrer_sub_channel,
  COUNT(DISTINCT v.visitor_id) AS new_visitors,
  COUNT(DISTINCT s.user_id) AS signups
FROM ${FIRST_PV} v
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
WHERE ${where}
GROUP BY 1
ORDER BY new_visitors DESC
LIMIT 50`;
}

// ─── Tab 5: Blog Post Tracking ─────────────────────────────────────────

export function blogTrackingQuery(pageType: string, minDate: string): string {
  return `WITH ${blogMetaCte()}
SELECT
  REGEXP_EXTRACT(v.url, r'https?://[^/]+(/?[^?#]*)') AS base_url,
  bc.author,
  COUNT(DISTINCT v.visitor_id) AS visitor_count,
  MIN(DATE(v.created_date)) AS min_first_pageview_d,
  bc.topic AS type,
  bc.purpose
FROM ${FIRST_PV} v
LEFT JOIN blog_meta bc ON ${blogJoinExpr("v")} = bc.handle
WHERE (${PAGE_TYPE_EXPR}) = '${escapeStr(pageType)}'
GROUP BY base_url, author, type, purpose
HAVING MIN(DATE(v.created_date)) >= '${minDate}'
ORDER BY visitor_count DESC`;
}

// ─── Tab 6: Top N Pages ────────────────────────────────────────────────

export function topNQuery(
  topN: number,
  pageType: string,
  dateStart: string,
  dateEnd: string,
  cadence: DateCadence,
): string {
  const trunc = cadenceToTrunc(cadence);
  return `WITH page_signups AS (
  SELECT
    REGEXP_EXTRACT(v.url, r'https?://[^/]+(/?[^?#]*)') AS base_url,
    (${PAGE_TYPE_EXPR}) AS page_type,
    COUNT(DISTINCT s.user_id) AS signups
  FROM ${FIRST_PV} v
  LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
  WHERE v.created_date BETWEEN TIMESTAMP('${dateStart}') AND TIMESTAMP('${dateEnd}')
    AND (${PAGE_TYPE_EXPR}) = '${escapeStr(pageType)}'
  GROUP BY base_url, page_type
  ORDER BY signups DESC
  LIMIT ${topN}
)
SELECT
  ps.base_url,
  ps.page_type,
  DATE_TRUNC(DATE(v.created_date), ${trunc}) AS flex_date,
  COUNT(DISTINCT v.visitor_id) AS traffic,
  COUNT(DISTINCT s.user_id) AS signups
FROM page_signups ps
JOIN ${FIRST_PV} v ON REGEXP_EXTRACT(v.url, r'https?://[^/]+(/?[^?#]*)') = ps.base_url
LEFT JOIN ${SIGNUPS} s ON v.visitor_id = s.visitor_id
WHERE v.created_date BETWEEN TIMESTAMP('${dateStart}') AND TIMESTAMP('${dateEnd}')
GROUP BY 1, 2, 3
ORDER BY flex_date, signups DESC`;
}

// ─── Filter Options Queries ────────────────────────────────────────────

export function filterOptionsQuery(
  column: string,
  table: "pageviews" | "signups" | "bpc" | "bpc_author" | "crm",
  dateStart?: string,
  dateEnd?: string,
): string {
  switch (table) {
    case "pageviews": {
      let dateClause = "";
      if (dateStart && dateEnd) {
        dateClause = `AND pv.created_date BETWEEN TIMESTAMP('${dateStart}') AND TIMESTAMP('${dateEnd}')`;
      }
      return `SELECT DISTINCT pv.${column} AS val
FROM ${ALL_PV} pv
WHERE pv.${column} IS NOT NULL ${dateClause}
ORDER BY val
LIMIT 500`;
    }
    case "signups": {
      let dateClause = "";
      if (dateStart && dateEnd) {
        dateClause = `AND ps.user_create_d BETWEEN TIMESTAMP('${dateStart}') AND TIMESTAMP('${dateEnd}')`;
      }
      return `SELECT DISTINCT ps.${column} AS val
FROM ${PRODUCT_SIGNUPS} ps
WHERE ps.${column} IS NOT NULL ${dateClause}
ORDER BY val
LIMIT 500`;
    }
    case "bpc": {
      // Blog metadata from sigma sheet — map logical column names
      const colMap: Record<string, string> = {
        topic: "Z52LFY52AK",
        purpose: "FTRKLGZM1R",
        persona: "IFHWPU1IDO",
        sub_type: "_DGCBJNKLE",
        funnelStep: "FTRKLGZM1R",
      };
      const realCol = colMap[column] || column;
      return `SELECT DISTINCT \`${realCol}\` AS val
FROM ${SIGMA_BLOG}
WHERE \`${realCol}\` IS NOT NULL
ORDER BY val
LIMIT 500`;
    }
    case "bpc_author": {
      return `SELECT DISTINCT H5YIATNDT5 AS val
FROM ${SIGMA_BLOG}
WHERE H5YIATNDT5 IS NOT NULL AND H5YIATNDT5 != ''
ORDER BY val
LIMIT 500`;
    }
    case "crm": {
      return `SELECT DISTINCT CAST(c.${column} AS STRING) AS val
FROM ${HS_CONTACTS} c
WHERE c.${column} IS NOT NULL
ORDER BY val
LIMIT 500`;
    }
  }
}
