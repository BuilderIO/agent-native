const ARR_TABLE = "`your-gcp-project-id.finance.arr_revenue_tracker_latest`";
const STRIPE_CUSTOMERS = "`your-gcp-project-id.polytomic.stripe_customers`";
const DIM_DATE = "`your-gcp-project-id.dbt_mart.dim_date`";
const PRODUCT_PROXY = "`your-gcp-project-id.dbt_mapping.legacy_product_proxy`";

type Cadence = "Daily" | "Weekly" | "Monthly" | "Quarterly";

function trunc(cadence: Cadence): string {
  switch (cadence) {
    case "Daily":
      return "DAY";
    case "Weekly":
      return "WEEK(MONDAY)";
    case "Monthly":
      return "MONTH";
    case "Quarterly":
      return "QUARTER";
  }
}

/**
 * Base CTE that reproduces the Sigma dataset SQL.
 * Returns the full 27-column dataset with fiscal date dimensions.
 */
function baseCte(): string {
  return `arr_data AS (
  SELECT
    arr.id,
    arr.unique_id,
    CASE WHEN sc.id IS NULL THEN 'null' ELSE sc.id END AS stripe_customer_num,
    CASE WHEN sc.id IS NULL THEN arr.id ELSE NULL END AS shopify_domain,
    COALESCE(
      CASE WHEN arr.product = 'Shopify' THEN arr.id ELSE sc.description END,
      arr.name
    ) AS customer_name,
    CASE
      WHEN arr.product = 'Shopify' THEN 'Shopify'
      WHEN arr.product IN ('CMS', 'VCP', 'Develop') THEN 'CMS + AI'
      ELSE 'unknown'
    END AS product_group,
    arr.ingestion_time,
    CASE
      WHEN arr.event_date < TIMESTAMP("2023-11-01") THEN TIMESTAMP(DATETIME(arr.event_date, "UTC"))
      ELSE TIMESTAMP(DATETIME(arr.event_date, "America/Los_Angeles"))
    END AS event_date,
    arr.event_date AS event_date_original,
    arr.event_date_pst,
    arr.status,
    CASE
      WHEN arr.status IN ("New", "Reactivate") THEN "New / Reactivate"
      WHEN arr.status IN ("Churn", "Downgrade") THEN "Churn / Downgrade"
      ELSE arr.status
    END AS status_group,
    arr.plan,
    CASE
      WHEN arr.product = 'CMS' THEN 'Publish'
      WHEN arr.product = 'Develop' THEN 'AI'
      ELSE arr.product
    END AS product,
    pp.product_proxy,
    pp.start_date AS last_sub_d,
    arr.current_arr,
    arr.arr_change,
    arr.meta_flag,
    COALESCE(arr.space_id, arr.root_org_id) AS org_id,
    dd.year_month,
    dd.year_quarter,
    dd.fiscal_date,
    dd.fiscal_quarter,
    dd.fiscal_year,
    dd.fiscal_year_quarter
  FROM ${ARR_TABLE} arr
  LEFT JOIN ${STRIPE_CUSTOMERS} sc ON sc.id = arr.id
  LEFT JOIN ${DIM_DATE} dd ON DATE(
    CASE
      WHEN arr.event_date < '2023-11-01' THEN CAST(arr.event_date AS DATE)
      ELSE CAST(arr.event_date_pst AS DATE)
    END
  ) = dd.date
  LEFT JOIN (
    SELECT a.*
    FROM (
      SELECT
        customer_id,
        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY start_date DESC) AS row_num,
        start_date,
        plan,
        product,
        product_proxy
      FROM ${PRODUCT_PROXY}
    ) a
    WHERE a.row_num = 1
  ) pp ON pp.customer_id = arr.id
)`;
}

/** Summary totals for a fiscal year */
export function summaryTotalsQuery(fiscalYear: number): string {
  return `WITH ${baseCte()}
SELECT
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS total_revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS total_churn_out,
  SUM(arr_change) AS total_net,
  SUM(current_arr) AS total_current_arr,
  COUNT(*) AS total_events,
  COUNT(DISTINCT customer_name) AS unique_customers
FROM arr_data
WHERE fiscal_year = ${fiscalYear}`;
}

/** ARR changes over time by fiscal period */
export function arrOverTimeQuery(
  cadence: Cadence,
  fiscalYear: number,
  productGroup?: string,
  statusGroup?: string,
): string {
  const truncFn = trunc(cadence);
  const useFiscal = cadence === "Monthly" || cadence === "Quarterly";
  const periodExpr = useFiscal
    ? cadence === "Quarterly"
      ? "fiscal_year_quarter"
      : "year_month"
    : `CAST(DATE_TRUNC(fiscal_date, ${truncFn}) AS STRING)`;

  const filters = [`fiscal_year = ${fiscalYear}`];
  if (productGroup) filters.push(`product_group = '${productGroup}'`);
  if (statusGroup) filters.push(`status_group = '${statusGroup}'`);

  return `WITH ${baseCte()}
SELECT
  ${periodExpr} AS period,
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS churn_out,
  SUM(arr_change) AS net
FROM arr_data
WHERE ${filters.join(" AND ")}
  AND fiscal_date IS NOT NULL
GROUP BY period
ORDER BY period`;
}

/** Breakdown by status */
export function statusBreakdownQuery(
  fiscalYear: number,
  productGroup?: string,
): string {
  const filters = [`fiscal_year = ${fiscalYear}`];
  if (productGroup) filters.push(`product_group = '${productGroup}'`);

  return `WITH ${baseCte()}
SELECT
  status,
  status_group,
  SUM(arr_change) AS arr_change,
  COUNT(*) AS events,
  COUNT(DISTINCT customer_name) AS customers
FROM arr_data
WHERE ${filters.join(" AND ")}
GROUP BY status, status_group
ORDER BY arr_change DESC`;
}

/** Breakdown by product group */
export function productBreakdownQuery(fiscalYear: number): string {
  return `WITH ${baseCte()}
SELECT
  product_group,
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS churn_out,
  SUM(arr_change) AS net,
  COUNT(*) AS events,
  COUNT(DISTINCT customer_name) AS customers
FROM arr_data
WHERE fiscal_year = ${fiscalYear}
GROUP BY product_group
ORDER BY net DESC`;
}

/** Breakdown by product (CMS→Publish, Develop→AI, etc.) */
export function productDetailBreakdownQuery(fiscalYear: number): string {
  return `WITH ${baseCte()}
SELECT
  product,
  product_group,
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS churn_out,
  SUM(arr_change) AS net,
  COUNT(*) AS events,
  COUNT(DISTINCT customer_name) AS customers
FROM arr_data
WHERE fiscal_year = ${fiscalYear}
GROUP BY product, product_group
ORDER BY net DESC`;
}

/** ARR by fiscal quarter for a given year */
export function quarterSummaryQuery(fiscalYear: number): string {
  return `WITH ${baseCte()}
SELECT
  fiscal_quarter,
  fiscal_year_quarter,
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS churn_out,
  SUM(arr_change) AS net,
  COUNT(*) AS events,
  COUNT(DISTINCT customer_name) AS customers
FROM arr_data
WHERE fiscal_year = ${fiscalYear}
  AND fiscal_quarter IS NOT NULL
GROUP BY fiscal_quarter, fiscal_year_quarter
ORDER BY fiscal_quarter`;
}

/** Top customers by ARR change (positive or negative) */
export function topCustomersQuery(
  fiscalYear: number,
  direction: "positive" | "negative",
  limit: number = 20,
): string {
  const filter = direction === "positive" ? "arr_change > 0" : "arr_change < 0";
  const orderDir = direction === "positive" ? "DESC" : "ASC";

  return `WITH ${baseCte()}
SELECT
  customer_name,
  product_group,
  SUM(arr_change) AS total_arr_change,
  COUNT(*) AS events
FROM arr_data
WHERE fiscal_year = ${fiscalYear}
  AND ${filter}
GROUP BY customer_name, product_group
ORDER BY total_arr_change ${orderDir}
LIMIT ${limit}`;
}

/** Raw event-level data (paginated via LIMIT) */
export function rawEventsQuery(
  fiscalYear: number,
  limit: number = 200,
): string {
  return `WITH ${baseCte()}
SELECT
  fiscal_date,
  customer_name,
  product_group,
  product,
  status,
  status_group,
  plan,
  arr_change,
  current_arr,
  fiscal_quarter,
  fiscal_year_quarter,
  org_id
FROM arr_data
WHERE fiscal_year = ${fiscalYear}
  AND fiscal_date IS NOT NULL
ORDER BY fiscal_date DESC
LIMIT ${limit}`;
}

/** Available fiscal years for the filter dropdown */
export function fiscalYearsQuery(): string {
  return `WITH ${baseCte()}
SELECT DISTINCT fiscal_year
FROM arr_data
WHERE fiscal_year IS NOT NULL
ORDER BY fiscal_year DESC`;
}
