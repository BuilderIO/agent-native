export type DateRange = "7d" | "14d" | "30d" | "90d" | "all";

export const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "14d", label: "14D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

function dateFilter(range: DateRange) {
  return range === "all"
    ? ""
    : `AND created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${parseInt(range)} DAY)`;
}

const TABLE = "`your-gcp-project-id.dbt_staging_firestore.pr_reviews`";
const BASE_WHERE = `WHERE created_at IS NOT NULL AND created_at <= CURRENT_TIMESTAMP()`;

export function prsReviewedSql(range: DateRange) {
  return `SELECT
  DATE(created_at) AS day,
  COUNT(DISTINCT CONCAT(repo_full_name, '#', CAST(pr_number AS STRING))) AS prs_reviewed
FROM ${TABLE}
${BASE_WHERE} ${dateFilter(range)}
GROUP BY day ORDER BY day ASC`;
}

export function kpiSql(range: DateRange) {
  return `SELECT
  COUNT(*) AS total_reviews,
  COUNT(DISTINCT CONCAT(repo_full_name, '#', CAST(pr_number AS STRING))) AS unique_prs_reviewed,
  COUNT(DISTINCT repo_full_name) AS repos_covered,
  COALESCE(SUM(issues_posted), 0) AS total_issues_posted,
  COALESCE(SUM(issues_high), 0) AS critical_issues,
  COALESCE(SUM(issues_medium), 0) AS medium_issues,
  COALESCE(SUM(resolved_count), 0) AS total_resolved
FROM ${TABLE}
${BASE_WHERE} ${dateFilter(range)}`;
}

export function reposPerDaySql(range: DateRange) {
  return `SELECT
  DATE(created_at) AS day,
  COUNT(DISTINCT repo_full_name) AS repos_reviewed
FROM ${TABLE}
${BASE_WHERE} ${dateFilter(range)}
GROUP BY day ORDER BY day ASC`;
}

export function repoBreakdownByDaySql(range: DateRange) {
  return `SELECT
  DATE(created_at) AS day,
  repo_full_name,
  COUNT(DISTINCT CONCAT(repo_full_name, '#', CAST(pr_number AS STRING))) AS prs_reviewed
FROM ${TABLE}
${BASE_WHERE} ${dateFilter(range)}
GROUP BY day, repo_full_name
ORDER BY day ASC, prs_reviewed ASC`;
}

export function issuesBySeverityPerDaySql(range: DateRange) {
  return `SELECT
  DATE(created_at) AS day,
  COALESCE(SUM(issues_high), 0) AS high,
  COALESCE(SUM(issues_medium), 0) AS medium,
  COALESCE(SUM(GREATEST(issues_posted - issues_high - issues_medium, 0)), 0) AS low
FROM ${TABLE}
${BASE_WHERE} ${dateFilter(range)}
GROUP BY day ORDER BY day ASC`;
}

export function issuesByRepoByDaySql(range: DateRange) {
  return `SELECT
  DATE(created_at) AS day,
  repo_full_name,
  COALESCE(SUM(issues_posted), 0) AS issues_posted
FROM ${TABLE}
${BASE_WHERE} ${dateFilter(range)}
GROUP BY day, repo_full_name
ORDER BY day ASC, issues_posted ASC`;
}

export function postedVsResolvedPerDaySql(range: DateRange) {
  return `SELECT
  DATE(created_at) AS day,
  COALESCE(SUM(issues_posted), 0) AS issues_posted,
  COALESCE(SUM(resolved_count), 0) AS issues_resolved,
  COALESCE(SUM(issues_dropped), 0) AS issues_dropped
FROM ${TABLE}
${BASE_WHERE} ${dateFilter(range)}
GROUP BY day ORDER BY day ASC`;
}

const CREDITS_TABLE = "`your-gcp-project-id.logs.ai_credits_usage`";
const VCP_TABLE = "`your-gcp-project-id.dbt_staging_firestore.vcp_code_events`";

function creditsDateFilter(range: DateRange) {
  return range === "all"
    ? ""
    : `AND pr.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${parseInt(range)} DAY)`;
}

export function creditsPerDaySql(range: DateRange) {
  return `WITH pr_sessions AS (
  SELECT pr.pr_review_id, v.code_gen_session, DATE(pr.created_at) AS day
  FROM ${TABLE} pr
  JOIN ${VCP_TABLE} v ON pr.pr_review_id = v.vcp_code_gen_id
  ${BASE_WHERE} ${creditsDateFilter(range)}
),
session_comp_ids AS (
  SELECT ps.day, ps.code_gen_session, ps.pr_review_id, v.vcp_code_gen_id
  FROM pr_sessions ps
  JOIN ${VCP_TABLE} v ON ps.code_gen_session = v.code_gen_session
),
review_credits AS (
  SELECT
    s.day,
    s.code_gen_session,
    COUNT(DISTINCT s.pr_review_id) AS num_reviews,
    SUM(c.credits_used) AS session_credits
  FROM session_comp_ids s
  JOIN ${CREDITS_TABLE} c ON JSON_VALUE(c.meta, '$.completionId') = s.vcp_code_gen_id
  WHERE c.timestamp >= '2026-01-01'
  GROUP BY s.day, s.code_gen_session
)
SELECT
  day,
  ROUND(SUM(session_credits / num_reviews), 1) AS total_credits,
  ROUND(AVG(session_credits / num_reviews), 1) AS avg_credits_per_review,
  SUM(num_reviews) AS reviews
FROM review_credits
GROUP BY day
ORDER BY day ASC`;
}

export function creditsPerPrByDaySql(range: DateRange) {
  return `WITH pr_sessions AS (
  SELECT pr.pr_review_id, pr.repo_full_name, pr.pr_number, v.code_gen_session, DATE(pr.created_at) AS day
  FROM ${TABLE} pr
  JOIN ${VCP_TABLE} v ON pr.pr_review_id = v.vcp_code_gen_id
  ${BASE_WHERE} ${creditsDateFilter(range)}
),
session_comp_ids AS (
  SELECT ps.day, ps.code_gen_session, ps.pr_review_id, ps.repo_full_name, ps.pr_number, v.vcp_code_gen_id
  FROM pr_sessions ps
  JOIN ${VCP_TABLE} v ON ps.code_gen_session = v.code_gen_session
),
per_completion AS (
  SELECT
    s.day,
    s.repo_full_name,
    s.pr_number,
    s.code_gen_session,
    s.pr_review_id,
    c.credits_used
  FROM session_comp_ids s
  JOIN ${CREDITS_TABLE} c ON JSON_VALUE(c.meta, '$.completionId') = s.vcp_code_gen_id
  WHERE c.timestamp >= '2026-01-01'
)
SELECT
  day,
  CONCAT(repo_full_name, ' #', CAST(pr_number AS STRING)) AS pr_label,
  ROUND(SUM(credits_used), 1) AS credits
FROM per_completion
GROUP BY day, repo_full_name, pr_number
ORDER BY day ASC, credits DESC`;
}

export const formatDate = (value: string) => {
  try {
    const d = new Date(value);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
};

export const CHART_AXIS_STYLE = {
  stroke: "#52525b",
  fontSize: 12,
  tickLine: false as const,
  axisLine: false as const,
};

export const TOOLTIP_STYLE = {
  backgroundColor: "#09090b",
  border: "1px solid #27272a",
  borderRadius: "8px",
  color: "#fafafa",
};

export const GRID_STYLE = {
  strokeDasharray: "3 3",
  stroke: "#27272a",
  vertical: false as const,
};
