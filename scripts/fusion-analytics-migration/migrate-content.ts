#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Dialect = "sqlite" | "postgres";
type ChartType =
  | "line"
  | "area"
  | "bar"
  | "metric"
  | "table"
  | "pie"
  | "section"
  | "heatmap"
  | "callout";

interface Db {
  dialect: Dialect;
  execute(
    sql: string,
    args?: unknown[],
  ): Promise<{ rows: any[]; rowsAffected: number }>;
  close(): Promise<void>;
}

interface AppEnv {
  databaseUrl: string;
  databaseAuthToken?: string;
}

interface Panel {
  id: string;
  title: string;
  sql: string;
  source: "bigquery" | "ga4" | "amplitude" | "first-party";
  chartType: ChartType;
  width: 1 | 2;
  config?: Record<string, unknown>;
  tab?: string;
}

interface DashboardConfig {
  id: string;
  name: string;
  description?: string;
  filters?: Array<Record<string, unknown>>;
  variables?: Record<string, string>;
  panels: Panel[];
}

interface DashboardMigration {
  id: string;
  kind?: "sql" | "explorer";
  title: string;
  sourcePath: string;
  config: DashboardConfig | Record<string, unknown>;
}

interface AnalysisMigration {
  id: string;
  name: string;
  description: string;
  author: string;
  sourcePath: string;
  dataSources: string[];
  question: string;
  instructions: string;
  resultMarkdown: string;
  resultData?: Record<string, unknown>;
}

interface ExtensionMigration {
  id: string;
  name: string;
  description: string;
  content: string;
  icon?: string;
  data?: Array<{
    collection: string;
    itemId: string;
    data: Record<string, unknown>;
  }>;
}

interface ExplorerSettingMigration {
  id: string;
  key: string;
  sourcePath: string;
  value: Record<string, unknown>;
}

const coreRequire = createRequire(path.resolve("packages/core/package.json"));
const TARGET_APP = "analytics";
const OWNER_EMAIL = "steve@builder.io";
const ORG_NAME = "Builder.io";
const ORG_DOMAIN = "builder.io";
const LEGACY_ROOT = path.resolve("..", "fusion-analytics");
const TARGET_ROOT = path.resolve("templates", "analytics");
const argv = process.argv.slice(2);
const write = argv.includes("--write");
const validateSql = argv.includes("--validate-sql");
const REMOVED_LEGACY_IDS = ["fusion-developer-pain", "tech-partners"];

const DATE_START = "{{dateStart}}";
const DATE_END = "{{dateEnd}}";

if (argv.includes("--help")) {
  console.log(`Usage: pnpm exec tsx scripts/fusion-analytics-migration/migrate-content.ts [--write] [--validate-sql]

Migrates legacy ../fusion-analytics dashboards, analyses, and tools into the
Agent-Native Analytics production SQL database for the Builder.io org.

Default is dry-run. Pass --write to upsert SQL resources. Pass --validate-sql
to dry-run migrated BigQuery panels after writing/generating configs.`);
  process.exit(0);
}

async function main() {
  const env = loadAppEnv(TARGET_APP);
  process.env.APP_NAME = process.env.APP_NAME || TARGET_APP;
  process.env.DATABASE_URL = env.databaseUrl;
  if (env.databaseAuthToken) {
    process.env.DATABASE_AUTH_TOKEN = env.databaseAuthToken;
  }
  const db = await connect(env.databaseUrl, env.databaseAuthToken);
  try {
    const orgId = await resolveBuilderOrgId(db);
    const dashboards = await buildDashboards();
    const analyses = buildAnalyses();
    const extensions = buildExtensions();
    const explorerSettings = buildExplorerSettings();

    console.log(
      `${write ? "Writing" : "Dry run"} Fusion migration into ${ORG_NAME} (${orgId})`,
    );
    console.log(
      `Prepared ${dashboards.length} dashboards, ${analyses.length} analyses, ${extensions.length} extensions, ${explorerSettings.length} Explorer settings.`,
    );

    if (validateSql) {
      await validateDashboardSql(dashboards, orgId);
    }

    if (write) {
      await ensureTables(db);
      await pruneRemovedLegacyResources(db);
      for (const dashboard of dashboards) {
        await upsertDashboard(db, dashboard, orgId);
      }
      for (const analysis of analyses) {
        await upsertAnalysis(db, analysis, orgId);
      }
      for (const extension of extensions) {
        await upsertExtension(db, extension, orgId);
      }
      for (const setting of explorerSettings) {
        await upsertExplorerSetting(db, setting, orgId);
      }
    }

    await printVerification(db, orgId, {
      dashboards,
      analyses,
      extensions,
      explorerSettings,
    });
  } finally {
    await db.close();
  }
}

function dateFilters() {
  return [
    {
      id: "date",
      label: "Date range",
      type: "date-range",
      default: "90d",
    },
  ];
}

function cadenceFilter(defaultValue = "Weekly") {
  return {
    id: "cadence",
    label: "Cadence",
    type: "select",
    default: defaultValue,
    options: [
      { value: "Daily", label: "Daily" },
      { value: "Weekly", label: "Weekly" },
      { value: "Monthly", label: "Monthly" },
    ],
  };
}

function panel(
  id: string,
  title: string,
  sql: string,
  opts: {
    chartType?: ChartType;
    width?: 1 | 2;
    xKey?: string;
    yKey?: string;
    yKeys?: string[];
    yFormatter?: "number" | "currency" | "percent";
    tab?: string;
  } = {},
): Panel {
  const config: Record<string, unknown> = {};
  if (opts.xKey) config.xKey = opts.xKey;
  if (opts.yKey) config.yKey = opts.yKey;
  if (opts.yKeys) config.yKeys = opts.yKeys;
  if (opts.yFormatter) config.yFormatter = opts.yFormatter;
  return {
    id,
    title,
    sql: sql.trim(),
    source: "bigquery",
    chartType: opts.chartType ?? "table",
    width: opts.width ?? 2,
    ...(Object.keys(config).length ? { config } : {}),
    ...(opts.tab ? { tab: opts.tab } : {}),
  };
}

function section(id: string, title: string, tab?: string): Panel {
  return {
    id,
    title,
    source: "bigquery",
    sql: "SELECT 1 AS section",
    chartType: "section",
    width: 2,
    ...(tab ? { tab } : {}),
  };
}

async function legacyQueryModule(rel: string): Promise<Record<string, any>> {
  const full = path.resolve(LEGACY_ROOT, "client", "pages", "adhoc", rel);
  return import(pathToFileURL(full).href);
}

function readLegacy(rel: string): string {
  return fs.readFileSync(path.resolve(LEGACY_ROOT, rel), "utf8");
}

function extractConstSql(rel: string, name: string): string {
  const source = readLegacy(rel);
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\`;`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not find ${name} in ${rel}`);
  return match[1].replace(/\\`/g, "`").trim();
}

function extractConstArrayLiteral(rel: string, name: string): string {
  const source = readLegacy(rel);
  const start = source.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`Could not find ${name} in ${rel}`);
  const eq = source.indexOf("=", start);
  const arrayStart = source.indexOf("[", eq);
  if (eq < 0 || arrayStart < 0)
    throw new Error(`Could not find array literal for ${name} in ${rel}`);

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = arrayStart; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === `"` || ch === `'` || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) return source.slice(arrayStart, i + 1);
    }
  }
  throw new Error(`Unterminated array literal for ${name} in ${rel}`);
}

function currentBigQuerySql(sql: string): string {
  return sql
    .replace(
      /builder-3b0a2\.dbt_intermediate\.all_pageviews/g,
      "builder-3b0a2.dbt_staging_bigquery.all_pageviews",
    )
    .replace(/\bactive_user\b/g, "active_user_id");
}

function dashboard(
  id: string,
  name: string,
  description: string,
  sourcePath: string,
  panels: Panel[],
  filters = dateFilters(),
): DashboardMigration {
  return {
    id,
    title: name,
    sourcePath,
    config: {
      id,
      name,
      description,
      filters,
      panels,
    },
  };
}

function topFunnelTab1Filters() {
  return {
    dateStart: DATE_START,
    dateEnd: DATE_END,
    pageType: [],
    channel: [],
    referrer: [],
    baseUrl: [],
    subPageType: [],
    urlFilter: "",
    author: [],
    pubDateStart: "",
  };
}

function topFunnelBlogFilters() {
  return {
    ...topFunnelTab1Filters(),
    pageType: ["blog"],
  };
}

function daysAgoDate(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

async function buildDashboards(): Promise<DashboardMigration[]> {
  const [
    keyMetrics,
    contentCalendar,
    conversion,
    deloitte,
    devrel,
    email,
    firstTouch,
    fusionUsage,
    fusion,
    macys,
    marketing,
    onboarding,
    prReview,
    arr,
    product,
    company,
    nbm,
    renewals,
    topFunnel,
  ] = await Promise.all([
    legacyQueryModule("key-metrics/queries.ts"),
    legacyQueryModule("content-calendar/queries.ts"),
    legacyQueryModule("conversion-analysis/queries.ts"),
    legacyQueryModule("deloitte/queries.ts"),
    legacyQueryModule("devrel-leaderboard/queries.ts"),
    legacyQueryModule("email-engagement/queries.ts"),
    legacyQueryModule("first-touch-traffic/queries.ts"),
    legacyQueryModule("fusion-usage/queries.ts"),
    legacyQueryModule("fusion/queries.ts"),
    legacyQueryModule("macys/queries.ts"),
    legacyQueryModule("marketing-funnel/queries.ts"),
    legacyQueryModule("onboarding-funnel/queries.ts"),
    legacyQueryModule("pr-review-bot/queries.ts"),
    legacyQueryModule("arr-revenue/queries.ts"),
    legacyQueryModule("product-kpis/queries.ts"),
    legacyQueryModule("company-kpis/queries.ts"),
    legacyQueryModule("nbm-pipeline/queries.ts"),
    legacyQueryModule("renewals-expansions/queries.ts"),
    legacyQueryModule("top-funnel/queries.ts"),
  ]);

  const dashboards: DashboardMigration[] = [
    dashboard(
      "key-metrics",
      "Key Metrics",
      "Legacy Fusion top-level traffic, signup, and subscription pulse migrated into the SQL dashboard structure.",
      "client/pages/adhoc/key-metrics/**",
      [
        panel(
          "site-traffic",
          "Site Traffic",
          currentBigQuerySql(
            keyMetrics.siteTrafficQuery(DATE_START, DATE_END, "daily"),
          ),
          {
            chartType: "area",
            xKey: "period",
            yKeys: ["not_blog", "blog"],
          },
        ),
        panel(
          "site-traffic-amplitude",
          "Site Traffic (Amplitude)",
          keyMetrics.siteTrafficAmplitudeQuery(DATE_START, DATE_END, "daily"),
        ),
        panel(
          "daily-signups",
          "Daily Signups",
          keyMetrics.dailySignupsQuery(DATE_START, DATE_END, "daily"),
          {
            chartType: "area",
            xKey: "period",
            yKey: "signups",
          },
        ),
        panel(
          "hourly-signups",
          "Hourly Signups",
          keyMetrics.hourlySignupsQuery(),
        ),
        panel(
          "new-vs-cancelled",
          "New vs Cancelled Subscriptions",
          keyMetrics.newVsCancelledSubsQuery(DATE_START, DATE_END, "daily"),
        ),
      ],
    ),
    dashboard(
      "top-funnel",
      "Top Funnel Acquisition",
      "Legacy Fusion acquisition dashboard rebuilt as SQL panels for top pages, time series, and blog tracking.",
      "client/pages/adhoc/top-funnel/**",
      [
        panel(
          "top-blog-signups",
          "Top Blog Pages by Signups",
          topFunnel.topNQuery(25, "blog", DATE_START, DATE_END, "Weekly"),
        ),
        panel(
          "page-performance",
          "Page Performance",
          topFunnel.pagePerformanceQuery(topFunnelTab1Filters()),
        ),
        panel(
          "top-page-timeseries",
          "Page Traffic Timeseries",
          topFunnel.timeseriesQuery("", "Weekly"),
          {
            chartType: "area",
            xKey: "flex_date",
            yKey: "new_visitors",
          },
        ),
        panel(
          "blog-tracking",
          "Blog Tracking Coverage",
          topFunnel.blogTrackingQuery("blog", DATE_START),
        ),
      ],
    ),
    dashboard(
      "blog-signups",
      "Blog by Signups",
      "Top Funnel subview focused on blog pages sorted by signups.",
      "client/pages/adhoc/top-funnel/**#blog-signups",
      [
        panel(
          "page-performance",
          "Blog Page Performance by Signups",
          topFunnel.pagePerformanceQuery(topFunnelBlogFilters(), false, {
            col: "signups",
            dir: "desc",
          }),
        ),
        panel(
          "top-blog-signups",
          "Top Blog Pages by Signups",
          topFunnel.topNQuery(25, "blog", DATE_START, DATE_END, "Weekly"),
          {
            chartType: "area",
            xKey: "flex_date",
            yKeys: ["traffic", "signups"],
          },
        ),
      ],
    ),
    dashboard(
      "blog-visitors",
      "Blog by Visitors",
      "Top Funnel subview focused on blog pages sorted by new visitors.",
      "client/pages/adhoc/top-funnel/**#blog-visitors",
      [
        panel(
          "page-performance",
          "Blog Page Performance by Visitors",
          topFunnel.pagePerformanceQuery(topFunnelBlogFilters(), false, {
            col: "new_visitors",
            dir: "desc",
          }),
        ),
        panel(
          "top-blog-visitors",
          "Top Blog Pages by Visitors",
          topFunnel.topNQuery(25, "blog", DATE_START, DATE_END, "Weekly"),
          {
            chartType: "area",
            xKey: "flex_date",
            yKeys: ["traffic", "signups"],
          },
        ),
      ],
    ),
    dashboard(
      "signup-growth",
      "Signup Growth vs 2x Goal",
      "Legacy 2026 signup-growth tracker. The 2x goal line was visual-only in React; this SQL version preserves the signup source data.",
      "client/pages/adhoc/signup-growth.tsx",
      [
        panel(
          "signups-2026",
          "2026 Signups",
          `SELECT
  TIMESTAMP_TRUNC(user_create_d, DAY) AS day,
  COUNT(DISTINCT user_id) AS signups
FROM \`builder-3b0a2.dbt_analytics.product_signups\`
WHERE user_create_d >= TIMESTAMP("2026-01-01")
  AND user_create_d <= CURRENT_TIMESTAMP()
GROUP BY day
ORDER BY day ASC`,
          {
            chartType: "area",
            xKey: "day",
            yKey: "signups",
          },
        ),
      ],
      [],
    ),
    dashboard(
      "self-serve-revenue",
      "Self-Serve Revenue",
      "Q1 2026 self-serve ARR in, churn out, net change, and status breakdown.",
      "client/pages/adhoc/self-serve-revenue.tsx",
      [
        panel(
          "quarter-totals",
          "Quarter Totals",
          `SELECT
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS total_revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS total_churn_out,
  SUM(arr_change) AS total_net,
  COUNT(*) AS total_events
FROM \`builder-3b0a2.finance.arr_revenue_tracker_latest\`
WHERE DATE(event_date_pst) >= '2026-02-01'
  AND DATE(event_date_pst) <= CURRENT_DATE()
  AND LOWER(plan) LIKE '%self%'`,
          {
            chartType: "metric",
            yKey: "total_net",
            yFormatter: "currency",
            width: 1,
          },
        ),
        panel(
          "revenue-over-time",
          "Revenue In vs Churn Out",
          `SELECT
  DATE_TRUNC(DATE(event_date_pst), DAY) AS day,
  SUM(CASE WHEN arr_change > 0 THEN arr_change ELSE 0 END) AS revenue_in,
  SUM(CASE WHEN arr_change < 0 THEN ABS(arr_change) ELSE 0 END) AS churn_out,
  SUM(arr_change) AS net
FROM \`builder-3b0a2.finance.arr_revenue_tracker_latest\`
WHERE DATE(event_date_pst) >= '2026-02-01'
  AND DATE(event_date_pst) <= CURRENT_DATE()
  AND LOWER(plan) LIKE '%self%'
GROUP BY day
ORDER BY day ASC`,
          {
            chartType: "bar",
            xKey: "day",
            yKeys: ["revenue_in", "churn_out", "net"],
            yFormatter: "currency",
          },
        ),
        panel(
          "status-breakdown",
          "Status Breakdown",
          `SELECT
  status,
  SUM(arr_change) AS arr_change,
  COUNT(*) AS events
FROM \`builder-3b0a2.finance.arr_revenue_tracker_latest\`
WHERE DATE(event_date_pst) >= '2026-02-01'
  AND DATE(event_date_pst) <= CURRENT_DATE()
  AND LOWER(plan) LIKE '%self%'
GROUP BY status
ORDER BY arr_change DESC`,
        ),
      ],
      [],
    ),
    dashboard(
      "devrel-leaderboard",
      "DevRel Leaderboard",
      "Legacy DevRel/content leaderboard covering author-level traffic, signup, QL/SAL, and ARR signals.",
      "client/pages/adhoc/devrel-leaderboard/**",
      [
        panel(
          "author-summary",
          "Author Summary",
          devrel.authorSummaryQuery(DATE_START, DATE_END, "2026-01-01"),
        ),
        panel(
          "article-detail",
          "Article Detail",
          devrel.articleDetailQuery(DATE_START, DATE_END, "2026-01-01"),
        ),
        panel(
          "author-timeseries",
          "Author Timeseries",
          devrel.authorTimeseriesQuery(
            DATE_START,
            DATE_END,
            "2026-01-01",
            "signups",
            "WEEK",
          ),
        ),
        panel(
          "translation-articles",
          "Translation Articles",
          devrel.translationsArticleQuery(DATE_START, DATE_END),
        ),
      ],
    ),
    dashboard(
      "recent",
      "Recent Articles Only",
      "DevRel Leaderboard subview scoped to articles published in the last 30 days at migration time.",
      "client/pages/adhoc/devrel-leaderboard/**#recent",
      [
        panel(
          "author-summary",
          "Recent Author Summary",
          devrel.authorSummaryQuery(DATE_START, DATE_END, daysAgoDate(30)),
        ),
        panel(
          "article-detail",
          "Recent Article Detail",
          devrel.articleDetailQuery(DATE_START, DATE_END, daysAgoDate(30)),
        ),
        panel(
          "author-timeseries",
          "Recent Author Timeseries",
          devrel.authorTimeseriesQuery(
            DATE_START,
            DATE_END,
            daysAgoDate(30),
            "signups",
            "WEEK",
          ),
          {
            chartType: "area",
            xKey: "flex_date",
            yKey: "value",
          },
        ),
      ],
    ),
    dashboard(
      "content-calendar",
      "Content SEO",
      "Legacy Fusion content SEO table for blog handles, visitors, and signups.",
      "client/pages/adhoc/content-calendar/**",
      [
        panel(
          "blog-handle-metrics",
          "Blog Handle Metrics",
          contentCalendar.blogHandleMetricsQuery(DATE_START, DATE_END),
        ),
      ],
    ),
    dashboard(
      "email-engagement",
      "Marketing",
      "Legacy Marketing dashboard migrated into SQL tabs for funnel, personas, emails, and Fusion activity.",
      "client/pages/adhoc/email-engagement/**",
      [
        section("funnel-section", "Funnel", "Funnel"),
        panel(
          "contacts-funnel",
          "Contacts Funnel",
          email.contactsFunnelQuery("Weekly", DATE_START, DATE_END, "All"),
          { tab: "Funnel" },
        ),
        panel(
          "deals-funnel",
          "Deals Funnel",
          email.dealsFunnelQuery("Weekly", DATE_START, DATE_END, "All", "All"),
          { tab: "Funnel" },
        ),
        section("persona-section", "Personas", "Personas"),
        panel("persona-counts", "Persona Counts", email.personaCountsQuery(), {
          tab: "Personas",
        }),
        panel(
          "persona-stage",
          "Persona Deal Stage",
          email.personaDealStageQuery(DATE_START, DATE_END, "Weekly", "All"),
          { tab: "Personas" },
        ),
        panel(
          "persona-activity",
          "Persona Activity",
          email.personaActivityQuery(DATE_START, DATE_END, "Weekly", "All"),
          { tab: "Personas" },
        ),
        section("emails-section", "Email Progression", "Emails"),
        panel(
          "email-progression",
          "Funnel Email Progression",
          email.funnelEmailProgressionQuery(DATE_START, DATE_END, "All"),
          { tab: "Emails" },
        ),
        panel(
          "persona-marketing-emails",
          "Persona Marketing Emails",
          email.personaMarketingEmailsQuery(
            DATE_START,
            DATE_END,
            "Weekly",
            "Design Technologist",
          ),
          { tab: "Emails" },
        ),
        section("fusion-section", "Fusion Activity", "Fusion"),
        panel(
          "fusion-actions",
          "Fusion Actions",
          email.fusionActionsQuery(DATE_START, DATE_END, "Design Technologist"),
          { tab: "Fusion" },
        ),
        panel(
          "fusion-action-breakdown",
          "Fusion Action Breakdown",
          email.fusionActionBreakdownQuery(
            DATE_START,
            DATE_END,
            "Design Technologist",
          ),
          { tab: "Fusion" },
        ),
      ],
    ),
    dashboard(
      "email-engagement-email",
      "Email",
      "Email-specific slices from the legacy Marketing section.",
      "client/pages/adhoc/email-engagement-email/**",
      [
        panel(
          "email-progression",
          "Email Progression",
          email.funnelEmailProgressionQuery(DATE_START, DATE_END, "All"),
        ),
        panel(
          "persona-email-cohort",
          "Persona Email Cohort",
          email.personaEmailCohortQuery(
            DATE_START,
            DATE_END,
            "Weekly",
            "Design Technologist",
          ),
        ),
        panel(
          "meetings-csv",
          "Meetings CSV",
          email.meetingsCsvQuery(DATE_START, DATE_END, "All"),
        ),
      ],
    ),
    dashboard(
      "email-engagement-persona",
      "Persona Performance",
      "Persona-specific marketing and Fusion engagement performance.",
      "client/pages/adhoc/email-engagement-persona.tsx",
      [
        panel("persona-counts", "Persona Counts", email.personaCountsQuery()),
        panel(
          "persona-contact-journey",
          "Persona Contact Journey",
          email.personaContactJourneyQuery("Design Technologist"),
        ),
        panel(
          "persona-marketing-emails",
          "Persona Marketing Emails",
          email.personaMarketingEmailsQuery(
            DATE_START,
            DATE_END,
            "Weekly",
            "Design Technologist",
          ),
        ),
      ],
    ),
    dashboard(
      "fusion",
      "Fusion Dashboard",
      "Legacy Fusion growth and product usage dashboard migrated as SQL panels.",
      "client/pages/adhoc/fusion/**",
      [
        panel(
          "site-traffic",
          "Site Traffic",
          fusion.siteTrafficQuery(DATE_START, DATE_END),
          {
            chartType: "area",
            xKey: "period",
            yKeys: ["non_blog_views", "blog_views"],
          },
        ),
        panel(
          "daily-signups",
          "Daily Signups",
          fusion.dailySignupsQuery(DATE_START, DATE_END),
          {
            chartType: "area",
            xKey: "period",
            yKeys: ["external_signups", "internal_signups"],
          },
        ),
        panel(
          "new-vs-cancelled",
          "New vs Cancelled Subs",
          fusion.newVsCancelledSubsQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "fusion-messages",
          "Fusion Messages",
          fusion.fusionMessagesQuery(DATE_START, DATE_END),
        ),
        panel(
          "repo-sub-rate",
          "Subscription Rate by Repo",
          fusion.subRateByRepoQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "pr-metrics",
          "PR Metrics",
          fusion.prMetricsQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "tier-timeseries",
          "Fusion Messages by Tier",
          fusion.fusionMessagesByTierTimeseriesQuery(DATE_START, DATE_END),
        ),
      ],
    ),
    dashboard(
      "fusion-sentiment",
      "Fusion Sentiment",
      "AI-inferred first prompt sentiment plus explicit thumbs up/down feedback.",
      "client/pages/adhoc/fusion-sentiment/**",
      [
        panel(
          "first-prompt-sentiment",
          "First Prompt Sentiment",
          `WITH sentiment_data AS (
  SELECT
    DATE_TRUNC(DATE(createdDate), WEEK) AS period,
    JSON_VALUE(data, '$.sentiment') AS sentiment,
    JSON_VALUE(data, '$.frustration_level') AS frustration_level,
    CAST(JSON_VALUE(data, '$.messageCount') AS INT64) AS message_count
  FROM \`builder-3b0a2.analytics.events_partitioned\`
  WHERE event = 'fusion chat message inferred sentiment'
    AND createdDate >= TIMESTAMP('${DATE_START}')
    AND createdDate <= TIMESTAMP('${DATE_END}')
    AND createdDate <= CURRENT_TIMESTAMP()
)
SELECT
  period,
  COUNTIF(message_count = 1 AND sentiment = 'positive') AS first_positive,
  COUNTIF(message_count = 1 AND sentiment = 'neutral') AS first_neutral,
  COUNTIF(message_count = 1 AND sentiment = 'negative') AS first_negative,
  COUNTIF(frustration_level = 'high') AS high_frustration
FROM sentiment_data
GROUP BY period
ORDER BY period`,
          {
            chartType: "bar",
            xKey: "period",
            yKeys: [
              "first_positive",
              "first_neutral",
              "first_negative",
              "high_frustration",
            ],
          },
        ),
        panel(
          "feedback-sentiment",
          "Feedback Sentiment",
          `SELECT
  DATE_TRUNC(DATE(createdDate), WEEK) AS period,
  JSON_VALUE(data, '$.sentiment') AS sentiment,
  JSON_VALUE(data, '$.modelUsed') AS model_used,
  COUNT(*) AS count
FROM \`builder-3b0a2.analytics.events_partitioned\`
WHERE event = 'fusion chat feedback submitted'
  AND createdDate >= TIMESTAMP('${DATE_START}')
  AND createdDate <= TIMESTAMP('${DATE_END}')
  AND createdDate <= CURRENT_TIMESTAMP()
  AND JSON_VALUE(data, '$.sentiment') IS NOT NULL
GROUP BY period, sentiment, model_used
ORDER BY period, sentiment, model_used`,
        ),
      ],
    ),
    dashboard(
      "macys",
      "Macy's Account",
      "Macy's Fusion account usage and subscriptions.",
      "client/pages/adhoc/macys/**",
      [
        panel(
          "messages-by-day",
          "Fusion Messages by Day",
          macys.fusionMessagesByDayQuery(DATE_START, DATE_END),
          { chartType: "area", xKey: "period", yKey: "messages" },
        ),
        panel(
          "messages-by-user",
          "Fusion Messages by User",
          macys.fusionMessagesByUserQuery(DATE_START, DATE_END),
        ),
        panel(
          "events-by-type",
          "Fusion Events by Type",
          macys.fusionEventsByTypeQuery(DATE_START, DATE_END),
        ),
        panel(
          "subscriptions",
          "Subscriptions",
          macys.macysSubscriptionsQuery(),
        ),
        panel("users", "Users", macys.macysUsersQuery()),
      ],
    ),
    dashboard(
      "deloitte",
      "Deloitte Account",
      "Deloitte Fusion account usage and subscriptions.",
      "client/pages/adhoc/deloitte/**",
      [
        panel(
          "messages-by-day",
          "Fusion Messages by Day",
          deloitte.fusionMessagesByDay(DATE_START, DATE_END),
          { chartType: "area", xKey: "period", yKey: "messages" },
        ),
        panel(
          "users-by-message-count",
          "Users by Message Count",
          deloitte.fusionUsersByMessageCount(DATE_START, DATE_END),
        ),
        panel(
          "builder-users",
          "Builder Users",
          deloitte.deloitteBuilderUsersQuery(),
        ),
        panel(
          "subscriptions",
          "Subscriptions",
          deloitte.deloitteSubscriptionsQuery(),
        ),
      ],
    ),
    dashboard(
      "onboarding-funnel",
      "Onboarding Funnel Analysis",
      "Onboarding funnel, completion time, cohorts, dropoff, and daily trends.",
      "client/pages/adhoc/onboarding-funnel/**",
      [
        panel(
          "funnel-overview",
          "Funnel Overview",
          onboarding.getFunnelOverviewQuery(DATE_START, DATE_END),
        ),
        panel(
          "time-to-complete",
          "Time to Complete",
          onboarding.getTimeToCompleteQuery(DATE_START, DATE_END),
        ),
        panel(
          "cohort-week",
          "Cohort by Week",
          onboarding.getCohortAnalysisQuery(DATE_START, DATE_END, "week"),
        ),
        panel(
          "dropoff",
          "Dropoff Analysis",
          onboarding.getDropoffAnalysisQuery(DATE_START, DATE_END),
        ),
        panel(
          "daily-funnel",
          "Daily Funnel",
          onboarding.getDailyFunnelQuery(DATE_START, DATE_END),
        ),
      ],
    ),
    dashboard(
      "pr-review-bot",
      "PR Review Bot",
      "PR review bot activity, issues, feedback, and credit usage.",
      "client/pages/adhoc/pr-review-bot/**",
      [
        panel("kpi", "KPI", prReview.kpiSql("30d"), {
          chartType: "metric",
          yKey: "prs_reviewed",
          width: 1,
        }),
        panel("prs-reviewed", "PRs Reviewed", prReview.prsReviewedSql("30d")),
        panel(
          "repos-per-day",
          "Repos per Day",
          prReview.reposPerDaySql("30d"),
          { chartType: "area", xKey: "day", yKey: "repos_reviewed" },
        ),
        panel(
          "issues-by-severity",
          "Issues by Severity",
          prReview.issuesBySeverityPerDaySql("30d"),
        ),
        panel(
          "posted-vs-resolved",
          "Posted vs Resolved",
          prReview.postedVsResolvedPerDaySql("30d"),
        ),
        panel(
          "credits-per-day",
          "Credits per Day",
          prReview.creditsPerDaySql("30d"),
        ),
      ],
      [],
    ),
    dashboard(
      "arr-revenue",
      "ARR Revenue w/ Fiscal Date",
      "ARR movement grouped by fiscal year, status, product, quarter, and customer.",
      "client/pages/adhoc/arr-revenue/**",
      [
        panel(
          "summary-totals",
          "Summary Totals",
          arr.summaryTotalsQuery(2026),
          {
            chartType: "metric",
            yKey: "total_net_arr",
            yFormatter: "currency",
            width: 1,
          },
        ),
        panel(
          "arr-over-time",
          "ARR Over Time",
          arr.arrOverTimeQuery("Monthly", 2026),
          {
            chartType: "area",
            xKey: "period",
            yKey: "arr_change",
            yFormatter: "currency",
          },
        ),
        panel(
          "status-breakdown",
          "Status Breakdown",
          arr.statusBreakdownQuery(2026),
        ),
        panel(
          "product-breakdown",
          "Product Breakdown",
          arr.productBreakdownQuery(2026),
        ),
        panel(
          "quarter-summary",
          "Quarter Summary",
          arr.quarterSummaryQuery(2026),
        ),
        panel(
          "top-growth-customers",
          "Top Growth Customers",
          arr.topCustomersQuery(2026, "positive", 25),
        ),
        panel(
          "top-churn-customers",
          "Top Churn Customers",
          arr.topCustomersQuery(2026, "negative", 25),
        ),
      ],
      [],
    ),
    dashboard(
      "fusion-usage",
      "Fusion Usage",
      "Enterprise Fusion usage summary and per-org table.",
      "client/pages/adhoc/fusion-usage/**",
      [
        panel(
          "summary-totals",
          "Summary Totals",
          fusionUsage.summaryTotalsQuery(DATE_START, DATE_END),
          { chartType: "metric", yKey: "total_agent_credits", width: 1 },
        ),
        panel(
          "enterprise-usage",
          "Enterprise Usage",
          fusionUsage.enterpriseUsageQuery(DATE_START, DATE_END),
        ),
      ],
    ),
    dashboard(
      "company-pageviews",
      "Publish Visual Views On Demand Billing",
      "Contracted pageview usage, over-consumption, and growth signals for on-demand billing.",
      "client/pages/adhoc/company-pageviews.tsx",
      [
        panel(
          "full",
          "Company Usage by Month",
          extractConstSql(
            "client/pages/adhoc/company-pageviews.tsx",
            "FULL_QUERY",
          ),
        ),
        panel(
          "over-consumption",
          "Over Consumption",
          extractConstSql(
            "client/pages/adhoc/company-pageviews.tsx",
            "OVER_CONSUMPTION_QUERY",
          ),
        ),
        panel(
          "companies",
          "Companies",
          extractConstSql(
            "client/pages/adhoc/company-pageviews.tsx",
            "COMPANIES_QUERY",
          ),
        ),
        panel(
          "growth",
          "High Growth Companies",
          extractConstSql(
            "client/pages/adhoc/company-pageviews.tsx",
            "GROWTH_QUERY",
          ),
        ),
      ],
      [],
    ),
    dashboard(
      "first-touch-traffic",
      "First Touch Traffic",
      "First-touch channel, sub-channel, UTM source, and page-type traffic.",
      "client/pages/adhoc/first-touch-traffic/**",
      [
        panel(
          "channel-breakdown",
          "Channel Breakdown",
          firstTouch.channelBreakdownQuery(DATE_START, DATE_END),
        ),
        panel(
          "channel-timeseries",
          "Channel Timeseries",
          firstTouch.channelTimeseriesQuery(DATE_START, DATE_END),
          { chartType: "area", xKey: "week", yKey: "visitors" },
        ),
        panel(
          "sub-channels",
          "Top Sub-Channels",
          firstTouch.topSubChannelsQuery(DATE_START, DATE_END, 30),
        ),
        panel(
          "utm-sources",
          "Top UTM Sources",
          firstTouch.topUtmSourceQuery(DATE_START, DATE_END, 30),
        ),
        panel(
          "page-type-timeseries",
          "Page Type Timeseries",
          firstTouch.pageTypeTimeseriesQuery(DATE_START, DATE_END),
        ),
        panel(
          "page-type-breakdown",
          "Page Type Breakdown",
          firstTouch.pageTypeBreakdownQuery(DATE_START, DATE_END),
        ),
      ],
    ),
    dashboard(
      "deal-renewals",
      "Deal Renewals",
      "Open renewal and expansion pipeline plus upcoming renewals.",
      "client/pages/adhoc/deal-renewals/**",
      [
        panel("top-metrics", "Top Metrics", renewals.topMetricsQuery, {
          chartType: "metric",
          yKey: "open_arr",
          yFormatter: "currency",
          width: 1,
        }),
        panel("by-csm", "By CSM", renewals.byCsmQuery),
        panel(
          "upcoming-renewals",
          "Upcoming Renewals",
          renewals.upcomingRenewalsQuery,
        ),
        panel("closed-won-ytd", "Closed Won YTD", renewals.closedWonYtdQuery),
        panel(
          "stage-breakdown",
          "Stage Breakdown",
          renewals.stageBreakdownQuery,
        ),
      ],
      [],
    ),
    dashboard(
      "nbm-pipeline",
      "NBM Pipeline Analysis",
      "NBM scheduled conversion funnel from S0 to NBM Booked to S1.",
      "client/pages/adhoc/nbm-pipeline/**",
      [
        panel("top-metrics", "Top Metrics", nbm.topMetricsQuery, {
          chartType: "metric",
          yKey: "s0_deals",
          width: 1,
        }),
        panel("weekly-nbm", "Weekly NBM", nbm.weeklyNbmQuery),
        panel("nbm-to-s1", "NBM to S1 Conversion", nbm.nbmToS1ConversionQuery),
        panel(
          "monthly-conversion",
          "Monthly Conversion",
          nbm.monthlyConversionQuery,
        ),
        panel("weekly-acv", "Weekly ACV", nbm.weeklyAcvQuery),
        panel("funnel-snapshot", "Funnel Snapshot", nbm.funnelSnapshotQuery),
      ],
      [],
    ),
    dashboard(
      "renewals-expansions",
      "Renewals & Expansions",
      "Renewal and expansion pipeline by CSM with timeline and stage slices.",
      "client/pages/adhoc/renewals-expansions/**",
      [
        panel("top-metrics", "Top Metrics", renewals.topMetricsQuery, {
          chartType: "metric",
          yKey: "open_arr",
          yFormatter: "currency",
          width: 1,
        }),
        panel("by-csm", "By CSM", renewals.byCsmQuery),
        panel(
          "upcoming-renewals",
          "Upcoming Renewals",
          renewals.upcomingRenewalsQuery,
        ),
        panel("closed-won-ytd", "Closed Won YTD", renewals.closedWonYtdQuery),
        panel(
          "stage-breakdown",
          "Stage Breakdown",
          renewals.stageBreakdownQuery,
        ),
      ],
      [],
    ),
    dashboard(
      "product-kpis",
      "Product KPIs",
      "Unregistered legacy Fusion Product KPI dashboard migrated from the query module.",
      "client/pages/adhoc/product-kpis/**",
      [
        panel(
          "signup-to-paid",
          "Signup to Paid",
          product.signupToPaidQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "signup-to-paid-by-plan",
          "Signup to Paid by Plan",
          product.signupToPaidByPlanQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "wau",
          "Weekly Active Users",
          currentBigQuerySql(product.wauQuery("Weekly", DATE_START, DATE_END)),
        ),
        panel(
          "wau-by-event-type",
          "WAU by Event Type",
          currentBigQuerySql(
            product.wauByEventTypeQuery("Weekly", DATE_START, DATE_END),
          ),
        ),
        panel(
          "arpa",
          "ARPA",
          product.arpaQuery("Weekly", DATE_START, DATE_END, "all"),
        ),
        panel(
          "retention-summary",
          "Retention Summary",
          product.retentionSummaryQuery(DATE_START, DATE_END),
        ),
        panel(
          "signup-retention",
          "Signup Retention",
          currentBigQuerySql(
            product.signupRetentionQuery("Weekly", DATE_START, DATE_END),
          ),
        ),
      ],
    ),
    dashboard(
      "company-kpis",
      "Company KPIs",
      "Unregistered legacy Fusion company KPI dashboard migrated from the query module.",
      "client/pages/adhoc/company-kpis/**",
      [
        panel("qls", "QLs", company.qlsQuery("Weekly", DATE_START, DATE_END)),
        panel("s1s", "S1s", company.s1sQuery("Weekly", DATE_START, DATE_END)),
        panel(
          "s1s-named",
          "S1s Named Accounts",
          company.s1sNamedAccountsQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "landing-acv",
          "Landing ACV",
          company.landingAcvQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "pov-win-rate",
          "POV Win Rate",
          company.povWinRateQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "ae-capacity",
          "AE Capacity",
          company.aeCapacityQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "expansion-pipeline",
          "Expansion Pipeline",
          company.expansionPipelineQuery("Weekly", DATE_START, DATE_END),
        ),
        panel("ndr", "NDR", company.ndrQuery("Weekly", DATE_START, DATE_END)),
        panel(
          "seat-utilization",
          "Seat Utilization",
          company.seatUtilizationQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "self-serve-conversion",
          "Self-Serve Conversion",
          company.selfServeConversionQuery("Weekly", DATE_START, DATE_END),
        ),
        panel(
          "self-serve-retention",
          "Self-Serve Retention",
          currentBigQuerySql(
            company.selfServeRetentionQuery("Weekly", DATE_START, DATE_END),
          ),
        ),
      ],
    ),
    dashboard(
      "conversion-analysis",
      "Traffic to Signup Conversion Analysis",
      "Legacy ad-hoc conversion analysis also available as a live SQL dashboard.",
      "client/pages/adhoc/conversion-analysis/**",
      [
        panel(
          "overall-trend",
          "Overall Trend",
          conversion.getOverallTrendQuery(6),
        ),
        panel(
          "source-breakdown",
          "Source Breakdown",
          conversion.getSourceBreakdownQuery(4, 4),
        ),
        panel(
          "landing-pages",
          "Landing Pages",
          conversion.getLandingPageQuery(4, 4),
        ),
        panel(
          "simple-funnel",
          "Simple Funnel",
          conversion.getSimpleFunnelQuery(4, 4),
        ),
        panel(
          "data-quality",
          "Data Quality",
          conversion.getDataQualityQuery(6),
        ),
      ],
      [],
    ),
  ];

  const marketingAlias = makeMarketingFunnelAlias(marketing);
  dashboards.push(marketingAlias);
  dashboards.push(eastEmeaDashboard());

  const gaSeed = readSeedDashboard("google-analytics");
  if (gaSeed) {
    dashboards.push({
      id: "google-analytics",
      title: "Google Analytics",
      sourcePath: "seeds/dashboards/google-analytics.json",
      config: { id: "google-analytics", ...gaSeed } as DashboardConfig,
    });
  }

  for (const explorer of readExplorerDashboards()) {
    dashboards.push(explorer);
  }

  return dashboards;
}

function makeMarketingFunnelAlias(marketing: Record<string, any>) {
  return dashboard(
    "marketing-funnel",
    "Marketing Funnel Health",
    "Legacy Fusion Marketing Funnel Health migrated into the SQL dashboard system. The newer marketing-funnel-health dashboard remains in place; this preserves the legacy route id.",
    "client/pages/adhoc/marketing-funnel/**",
    [
      panel(
        "page-performance",
        "Page Performance",
        marketing.pagePerformanceQuery(DATE_START, DATE_END),
      ),
      panel(
        "blog-signups",
        "Blog Signups",
        marketing.blogSignupsQuery(DATE_START, DATE_END),
      ),
      panel(
        "top-pages-by-sessions",
        "Top Pages by Sessions",
        marketing.topPagesBySessionsQuery(DATE_START, DATE_END),
      ),
      panel(
        "contacts-created",
        "Contacts Created",
        marketing.contactsCreatedQuery(DATE_START, DATE_END),
      ),
      panel(
        "enrichment-funnel",
        "Enrichment Funnel",
        marketing.enrichmentFunnelQuery(DATE_START, DATE_END),
      ),
      panel(
        "qls-by-source",
        "QLs by Source",
        marketing.qlsBySourceQuery(DATE_START, DATE_END),
      ),
      panel(
        "qls-by-persona",
        "QLs by Persona",
        marketing.qlsByPersonaQuery(DATE_START, DATE_END),
      ),
      panel(
        "sals-by-week-dimension",
        "SALs by Week/Dimension",
        marketing.salsByWeekDimensionQuery(DATE_START, DATE_END),
      ),
      panel(
        "ql-to-sal-heatmap",
        "QL to SAL Heatmap",
        marketing.qlToSalHeatmapQuery(DATE_START, DATE_END, "Persona"),
        { chartType: "heatmap" },
      ),
    ],
  );
}

function eastEmeaTeamCte(): string {
  return `team AS (
  SELECT * FROM UNNEST([
    STRUCT('Erin Buckelew' AS owner_name, 0.0 AS closed_won_quota, 0.0 AS pipeline_target, 2.5 AS coverage_goal, 'erin buckelew' AS owner_key),
    STRUCT('Andrew Bishop' AS owner_name, 325000.0 AS closed_won_quota, 975000.0 AS pipeline_target, 2.5 AS coverage_goal, 'andrew bishop' AS owner_key),
    STRUCT('Julia Shkrabova' AS owner_name, 225000.0 AS closed_won_quota, 675000.0 AS pipeline_target, 2.5 AS coverage_goal, 'julia shkrabova' AS owner_key),
    STRUCT('Nina Abbasi-Beard' AS owner_name, 0.0 AS closed_won_quota, 0.0 AS pipeline_target, 2.5 AS coverage_goal, 'nina@builder.io' AS owner_key),
    STRUCT('Nina Abbasi-Beard' AS owner_name, 0.0 AS closed_won_quota, 0.0 AS pipeline_target, 2.5 AS coverage_goal, 'nina abbasi-beard' AS owner_key)
  ])
)`;
}

function eastEmeaDashboard(): DashboardMigration {
  const teamCte = eastEmeaTeamCte();
  const teamJoin = "LOWER(COALESCE(d.sales_rep_owner_name, '')) = t.owner_key";
  return dashboard(
    "east-emea",
    "East-EMEA Weekly",
    "East-EMEA Q2 FY2027 weekly scorecard migrated from the latest Fusion dashboard into SQL panels.",
    "client/pages/adhoc/east-emea/**",
    [
      panel(
        "team-scorecard",
        "Team Scorecard",
        `WITH ${teamCte}
SELECT
  t.owner_name,
  t.closed_won_quota,
  t.pipeline_target,
  COUNTIF(d.is_closed_won AND DATE(d.close_date) BETWEEN DATE('2026-05-01') AND LEAST(CURRENT_DATE(), DATE('2026-07-31'))) AS closed_won_qtd_count,
  COALESCE(SUM(IF(d.is_closed_won AND DATE(d.close_date) BETWEEN DATE('2026-05-01') AND LEAST(CURRENT_DATE(), DATE('2026-07-31')), SAFE_CAST(d.amount AS FLOAT64), 0)), 0) AS closed_won_qtd_amount,
  SAFE_DIVIDE(
    COALESCE(SUM(IF(d.is_closed_won AND DATE(d.close_date) BETWEEN DATE('2026-05-01') AND LEAST(CURRENT_DATE(), DATE('2026-07-31')), SAFE_CAST(d.amount AS FLOAT64), 0)), 0),
    NULLIF(t.closed_won_quota, 0)
  ) AS qtd_attainment,
  COUNTIF(d.is_closed_won AND DATE(d.close_date) BETWEEN DATE('2026-02-01') AND CURRENT_DATE()) AS closed_won_ytd_count,
  COALESCE(SUM(IF(d.is_closed_won AND DATE(d.close_date) BETWEEN DATE('2026-02-01') AND CURRENT_DATE(), SAFE_CAST(d.amount AS FLOAT64), 0)), 0) AS closed_won_ytd_amount,
  COUNTIF(d.deal_id IS NOT NULL AND NOT COALESCE(d.is_deal_closed, FALSE)) AS open_pipeline_count,
  COALESCE(SUM(IF(d.deal_id IS NOT NULL AND NOT COALESCE(d.is_deal_closed, FALSE), SAFE_CAST(d.amount AS FLOAT64), 0)), 0) AS open_pipeline_amount,
  SAFE_DIVIDE(COALESCE(SUM(IF(d.deal_id IS NOT NULL AND NOT COALESCE(d.is_deal_closed, FALSE), SAFE_CAST(d.amount AS FLOAT64), 0)), 0), NULLIF(t.closed_won_quota, 0)) AS pipeline_coverage,
  COUNTIF(d.nbm_meeting_booked_date BETWEEN DATE('2026-05-01') AND DATE('2026-07-31')) AS nbm_scheduled,
  COUNTIF(d.nbm_meeting_complete_date BETWEEN DATE('2026-05-01') AND DATE('2026-07-31')) AS nbm_completed
FROM team t
LEFT JOIN \`builder-3b0a2.dbt_mart.dim_hs_deals\` d
  ON ${teamJoin}
GROUP BY t.owner_name, t.closed_won_quota, t.pipeline_target, t.coverage_goal
ORDER BY
  CASE t.owner_name
    WHEN 'Erin Buckelew' THEN 1
    WHEN 'Andrew Bishop' THEN 2
    WHEN 'Julia Shkrabova' THEN 3
    WHEN 'Nina Abbasi-Beard' THEN 4
    ELSE 99
  END`,
      ),
      panel(
        "current-month-deals",
        "Current Month Deals",
        `WITH ${teamCte}
SELECT
  CAST(d.deal_id AS STRING) AS deal_id,
  d.deal_name,
  t.owner_name,
  DATE(d.close_date) AS close_date,
  d.stage_name,
  COALESCE(d.hs_manual_forecast_category, 'Uncategorized') AS forecast_category,
  SAFE_CAST(d.amount AS FLOAT64) AS amount,
  d.pipeline_name
FROM team t
JOIN \`builder-3b0a2.dbt_mart.dim_hs_deals\` d
  ON ${teamJoin}
WHERE NOT COALESCE(d.is_deal_closed, FALSE)
  AND DATE(d.close_date) BETWEEN DATE_TRUNC(CURRENT_DATE(), MONTH) AND LAST_DAY(CURRENT_DATE())
  AND NOT STARTS_WITH(LOWER(COALESCE(d.stage_name, '')), 's0')
ORDER BY close_date ASC, amount DESC
LIMIT 200`,
      ),
      panel(
        "next-month-deals",
        "Next Month Deals",
        `WITH ${teamCte}
SELECT
  CAST(d.deal_id AS STRING) AS deal_id,
  d.deal_name,
  t.owner_name,
  DATE(d.close_date) AS close_date,
  d.stage_name,
  COALESCE(d.hs_manual_forecast_category, 'Uncategorized') AS forecast_category,
  SAFE_CAST(d.amount AS FLOAT64) AS amount,
  d.pipeline_name
FROM team t
JOIN \`builder-3b0a2.dbt_mart.dim_hs_deals\` d
  ON ${teamJoin}
WHERE NOT COALESCE(d.is_deal_closed, FALSE)
  AND DATE(d.close_date) BETWEEN DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH) AND LAST_DAY(DATE_ADD(CURRENT_DATE(), INTERVAL 1 MONTH))
  AND NOT STARTS_WITH(LOWER(COALESCE(d.stage_name, '')), 's0')
ORDER BY close_date ASC, amount DESC
LIMIT 200`,
      ),
      panel(
        "stage-zero-deals",
        "Stage 0 Deals This Quarter",
        `WITH ${teamCte}
SELECT
  CAST(d.deal_id AS STRING) AS deal_id,
  d.deal_name,
  t.owner_name,
  DATE(d.close_date) AS close_date,
  d.stage_name,
  COALESCE(d.hs_manual_forecast_category, 'Uncategorized') AS forecast_category,
  SAFE_CAST(d.amount AS FLOAT64) AS amount,
  d.pipeline_name
FROM team t
JOIN \`builder-3b0a2.dbt_mart.dim_hs_deals\` d
  ON ${teamJoin}
WHERE NOT COALESCE(d.is_deal_closed, FALSE)
  AND DATE(d.close_date) BETWEEN DATE('2026-05-01') AND DATE('2026-07-31')
  AND STARTS_WITH(LOWER(COALESCE(d.stage_name, '')), 's0')
ORDER BY close_date ASC, amount DESC
LIMIT 200`,
      ),
    ],
    [],
  );
}

function readSeedDashboard(id: string): Record<string, unknown> | null {
  const file = path.resolve(TARGET_ROOT, "seeds", "dashboards", `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readExplorerDashboards(): DashboardMigration[] {
  const dir = path.resolve(LEGACY_ROOT, "data", "explorer-dashboards");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => {
      const id = file.replace(/\.json$/, "");
      const rel = `data/explorer-dashboards/${file}`;
      const config = JSON.parse(readLegacy(rel));
      const title =
        typeof config.name === "string" && config.name
          ? config.name
          : `Explorer Dashboard ${id}`;
      return {
        id,
        kind: "explorer" as const,
        title,
        sourcePath: rel,
        config,
      };
    });
}

function buildAnalyses(): AnalysisMigration[] {
  const metas: Array<{
    id: string;
    name: string;
    description: string;
    author: string;
    sourcePath: string;
    dataSources: string[];
  }> = [
    {
      id: "conversion-analysis",
      name: "Traffic to Signup Conversion Analysis",
      description:
        "Deep dive into declining conversion rates with funnel analysis, traffic source breakdown, landing pages, and data quality checks.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/conversion-analysis/**",
      dataSources: ["bigquery"],
    },
    {
      id: "trial-cohort-analysis",
      name: "Self-Serve Subscription Retention Analysis",
      description:
        "Weekly cohort retention analysis tracking churn signals for 7, 14, and 30 day periods.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/trial-cohort-analysis/**",
      dataSources: ["bigquery", "stripe"],
    },
    {
      id: "retention-drivers",
      name: "Retention Driver Analysis",
      description:
        "Comparative analysis of retained vs churned subscribers across usage, success signals, and acquisition channels.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/retention-drivers/**",
      dataSources: ["bigquery"],
    },
    {
      id: "retention-drivers-debug",
      name: "Retention Drivers Debug",
      description:
        "Diagnostic queries for the retention-drivers analysis joins and zero-result cases.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/retention-drivers-debug/**",
      dataSources: ["bigquery"],
    },
    {
      id: "cohort-comparison",
      name: "Cohort AI Usage Comparison",
      description:
        "Compares AI usage before subscription for recent and older self-serve cohorts.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/cohort-comparison/**",
      dataSources: ["bigquery"],
    },
    {
      id: "data-structure-check",
      name: "Data Structure Check",
      description:
        "Diagnostic analysis for subscription/event data shape and join keys.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/data-structure-check/**",
      dataSources: ["bigquery"],
    },
    {
      id: "pre-subscription-patterns",
      name: "Pre-Subscription Usage Patterns",
      description:
        "AI usage patterns in the 30 days before subscription and how they relate to retention.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/pre-subscription-patterns/**",
      dataSources: ["bigquery"],
    },
    {
      id: "pre-sub-diagnostic",
      name: "Pre-Sub Join Diagnostic",
      description:
        "Step-by-step diagnostic for joins between subscriptions, organizations, and AI usage.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/pre-sub-diagnostic/**",
      dataSources: ["bigquery"],
    },
    {
      id: "ai-completion-definition",
      name: "AI Completion Definition",
      description:
        "Schema reference explaining completion records in AI credits usage data.",
      author: "katya@builder.io",
      sourcePath: "client/pages/adhoc/ai-completion-definition/**",
      dataSources: ["bigquery"],
    },
    {
      id: "cbre-analysis",
      name: "CBRE Group",
      description:
        "User engagement analysis and outreach strategy for CBRE Group.",
      author: "steve@builder.io",
      sourcePath: "client/pages/adhoc/cbre-analysis.tsx",
      dataSources: ["bigquery", "hubspot"],
    },
    {
      id: "nasdaq-analysis",
      name: "Nasdaq",
      description: "User engagement analysis and outreach strategy for Nasdaq.",
      author: "steve@builder.io",
      sourcePath: "client/pages/adhoc/nasdaq-analysis.tsx",
      dataSources: ["bigquery", "hubspot"],
    },
    {
      id: "revcom-analysis",
      name: "Rev.com",
      description:
        "User engagement analysis and outreach strategy for Rev.com.",
      author: "steve@builder.io",
      sourcePath: "client/pages/adhoc/revcom-analysis.tsx",
      dataSources: ["bigquery", "hubspot"],
    },
    {
      id: "cathay-bank-analysis",
      name: "Cathay Bank",
      description:
        "User engagement analysis and outreach strategy for Cathay Bank.",
      author: "steve@builder.io",
      sourcePath: "client/pages/adhoc/cathay-bank-analysis.tsx",
      dataSources: ["bigquery", "hubspot"],
    },
    {
      id: "walmart-analysis",
      name: "Walmart",
      description:
        "User engagement analysis and outreach strategy for Walmart.",
      author: "steve@builder.io",
      sourcePath: "client/pages/adhoc/walmart-analysis.tsx",
      dataSources: ["bigquery", "hubspot", "gong", "slack"],
    },
    {
      id: "fusion-closed-lost-analysis",
      name: "Fusion Closed Lost Analysis",
      description:
        "Comprehensive closed-lost Fusion analysis with loss themes, stage progression, and re-engagement opportunities.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/fusion-closed-lost-analysis.tsx",
      dataSources: ["hubspot", "gong", "slack"],
    },
    {
      id: "fusion-closed-won-analysis",
      name: "Fusion Closed Won Analysis",
      description:
        "Analysis of Fusion new-business deals closed won since January 1, 2026, including win themes, Gong transcript evidence, buyer personas, and deal intelligence.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/fusion-closed-won-analysis.tsx",
      dataSources: ["hubspot", "gong", "slack"],
    },
    {
      id: "sequence-analysis",
      name: "Sequence Analysis",
      description: "Outbound sequence performance analysis.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/sequence-analysis/**",
      dataSources: ["hubspot"],
    },
    {
      id: "sequence-persona",
      name: "Sequence Persona Analysis",
      description:
        "Persona breakdown and messaging performance for active xDR/CAE sequences.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/sequence-persona/**",
      dataSources: ["hubspot"],
    },
    {
      id: "sequence-dt-analysis",
      name: "Design Technologist Campaign",
      description:
        "Design Technologist campaign sequence analysis, issues, and recommendations.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/sequence-dt-analysis/**",
      dataSources: ["hubspot"],
    },
    {
      id: "sequence-dp-analysis",
      name: "Developer Productivity Campaign",
      description:
        "Developer Productivity campaign sequence analysis and improvement recommendations.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/sequence-dp-analysis/**",
      dataSources: ["hubspot"],
    },
    {
      id: "sequence-cae-analysis",
      name: "CAE Sequences Analysis",
      description:
        "CAE sequence analysis against top-performing xDR sequence patterns.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/sequence-cae-analysis/**",
      dataSources: ["hubspot"],
    },
    {
      id: "risk-meeting",
      name: "Risk Meeting",
      description:
        "Risk meeting account review surface migrated as a saved analysis workflow.",
      author: "adam@builder.io",
      sourcePath: "client/pages/adhoc/risk-meeting/**",
      dataSources: ["hubspot", "pylon"],
    },
    {
      id: "impl-blockers",
      name: "Implementation Blockers",
      description:
        "Implementation blocker taxonomy and account-level blocker notes from Fusion.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/impl-blockers/**",
      dataSources: ["gong", "slack", "hubspot"],
    },
    {
      id: "strategic-accounts-contacts",
      name: "Strategic Account Coverage",
      description:
        "Champion, enabler, and executive sponsor coverage for strategic accounts.",
      author: "brent@builder.io",
      sourcePath: "client/pages/adhoc/strategic-accounts-contacts.tsx",
      dataSources: ["gong", "hubspot", "slack"],
    },
  ];

  const generated = metas.map((meta) => {
    const sourceInfo = sourceSnapshot(meta.sourcePath);
    return {
      ...meta,
      question: meta.description,
      instructions: [
        `Re-run the legacy Fusion analysis "${meta.name}" using these sources: ${meta.dataSources.join(", ")}.`,
        `Use the migrated source reference ${meta.sourcePath} as the behavioral baseline, but store fresh results in this SQL analysis row.`,
        "When provider credentials or tables are unavailable, record the concrete provider error instead of fabricating values.",
      ].join("\n"),
      resultMarkdown: [
        `# ${meta.name}`,
        "",
        meta.description,
        "",
        "## Migration Notes",
        "",
        `This saved analysis preserves the legacy Fusion artifact from \`${meta.sourcePath}\` inside the SQL-backed Agent-Native Analytics analyses table.`,
        "Use **Re-run** from the analysis page or ask the agent to refresh it to produce current provider-backed findings.",
        "",
        "## Data Sources",
        "",
        ...meta.dataSources.map((source) => `- ${source}`),
      ].join("\n"),
      resultData: {
        migration: "fusion-analytics",
        source: sourceInfo,
      },
    };
  });
  return [...generated, ...memoAnalyses()];
}

function memoAnalyses(): AnalysisMigration[] {
  return [
    memoAnalysis(
      "fusion-developer-pain-assessment",
      "Fusion Developer Pain Assessment",
      "Bottom-up Fusion developer pain memo migrated from Gong, HubSpot, and Slack evidence.",
      "data/memos/fusion-developer-pain-assessment.md",
    ),
    memoAnalysis(
      "success-stories",
      "Success Stories",
      "Narrative success-story memo migrated from Fusion data files.",
      "data/memos/success-stories.md",
    ),
    memoAnalysis(
      "success-stories-table",
      "Success Stories Table",
      "Tabular success-story source memo migrated from Fusion data files.",
      "data/memos/success-stories-table.md",
    ),
    memoAnalysis(
      "tech-partners",
      "Tech Partners State of the Union",
      "Technology partner account memo migrated as a SQL analysis artifact.",
      "data/memos/tech-partners.md",
    ),
    memoAnalysis(
      "fusion-s1-comprehensive-analysis",
      "Fusion S1 Comprehensive Analysis",
      "Executive analysis of S1+ closed-lost Fusion deals migrated from Fusion data files.",
      "data/fusion-s1-comprehensive-analysis.md",
    ),
    memoAnalysis(
      "fusion-s1-deep-dive-report",
      "Fusion S1 Deep Dive Report",
      "Deal-by-deal S1 Fusion deep dive migrated from Fusion data files.",
      "data/fusion-s1-deep-dive-report.md",
    ),
    memoAnalysis(
      "fusion-s1-final-analysis",
      "Fusion S1 Final Analysis",
      "Narrative final S1 Fusion closed-lost analysis migrated from Fusion data files.",
      "data/fusion-s1-final-analysis.md",
    ),
  ];
}

function memoAnalysis(
  id: string,
  name: string,
  description: string,
  sourcePath: string,
): AnalysisMigration {
  const raw = readLegacy(sourcePath);
  return {
    id,
    name,
    description,
    author: OWNER_EMAIL,
    sourcePath,
    dataSources: ["markdown"],
    question: description,
    instructions:
      "Refresh this memo from the underlying customer evidence sources and keep the saved SQL analysis result as the canonical org-wide copy.",
    resultMarkdown: raw,
    resultData: {
      migration: "fusion-analytics",
      source: sourceSnapshot(sourcePath),
    },
  };
}

function buildExplorerSettings(): ExplorerSettingMigration[] {
  const dir = path.resolve(LEGACY_ROOT, "data", "explorer-configs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => {
      const id = file.replace(/\.json$/, "");
      const rel = `data/explorer-configs/${file}`;
      return {
        id,
        key: `config-${id}`,
        sourcePath: rel,
        value: JSON.parse(readLegacy(rel)),
      };
    });
}

function sourceSnapshot(sourcePath: string) {
  const abs = path.resolve(LEGACY_ROOT, sourcePath.replace(/\*\*$/, ""));
  if (sourcePath.endsWith("/**") && fs.existsSync(abs)) {
    const files = collectFiles(abs);
    return {
      path: sourcePath,
      fileCount: files.length,
      bytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0),
      sha256: hashStrings(files.map((file) => fs.readFileSync(file, "utf8"))),
    };
  }
  const file = path.resolve(LEGACY_ROOT, sourcePath);
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    return {
      path: sourcePath,
      fileCount: 1,
      bytes: Buffer.byteLength(raw),
      sha256: hashStrings([raw]),
    };
  }
  return { path: sourcePath, missing: true };
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out.sort();
}

function hashStrings(values: string[]): string {
  const h = crypto.createHash("sha256");
  for (const value of values) h.update(value);
  return h.digest("hex");
}

function buildExtensions(): ExtensionMigration[] {
  return [
    extension(
      "qbr-deck-builder",
      "QBR Deck Builder",
      "Build AE QBR talking points and save deck inputs org-wide.",
      qbrExtension(),
    ),
    extension(
      "cs-qbr-deck-builder",
      "CS QBR Deck Builder",
      "Customer Success QBR deck builder with live CSM book data and org-shared notes.",
      csQbrExtension(),
      [jsonData("cs-qbr-notes", "Alex Beebe", "data/cs-qbr/Alex_Beebe.json")],
    ),
    extension(
      "gcn-prep",
      "GCN Conference Prep",
      "Search migrated GCN speaker and meeting prep data.",
      gcnExtension(),
      [
        jsonData("legacy", "meetings", "data/gcn-meetings.json"),
        jsonData("legacy", "speakers", "data/gcn-speakers.json"),
      ],
    ),
    extension(
      "engagement-planner",
      "User Engagement Planner",
      "Validate a company/org and generate an engagement-analysis prompt.",
      engagementExtension(),
    ),
    extension(
      "discovery-coach",
      "Discovery Coach",
      "Fusion discovery coaching workflow for translating operational pain into business pain.",
      discoveryCoachExtension(),
    ),
    extension(
      "customer-health",
      "Customer Health",
      "Customer health lookup using BigQuery plus Gong and Pylon actions.",
      actionSearchExtension("Customer Health", [
        "bigquery",
        "gong-calls",
        "pylon-issues",
      ]),
    ),
    extension(
      "risk-meeting",
      "Risk Meeting",
      "Risk review helper for HubSpot/Pylon account signals.",
      actionSearchExtension("Risk Meeting", ["hubspot-deals", "pylon-issues"]),
    ),
    extension(
      "stripe",
      "Stripe Billing",
      "Stripe customer billing, subscriptions, refunds, and payment status.",
      stripeExtension(),
    ),
    extension(
      "slack-feedback",
      "Slack Feedback",
      "Search and review Slack feedback messages.",
      slackExtension(),
    ),
    extension(
      "dbt-workspace",
      "dbt Model Workspace",
      "Store dbt snippets and test SQL against BigQuery.",
      dbtExtension(),
    ),
    extension(
      "query-explorer",
      "Query Explorer",
      "Ad-hoc SQL runner with org-scoped history.",
      queryExplorerExtension(),
    ),
    extension(
      "hubspot",
      "HubSpot Sales",
      "HubSpot sales pipeline and deal lookup.",
      actionSearchExtension("HubSpot Sales", [
        "hubspot-deals",
        "hubspot-metrics",
        "hubspot-pipelines",
      ]),
    ),
    extension(
      "sentry",
      "Sentry Error Health",
      "Sentry issue and project lookup.",
      actionSearchExtension("Sentry Error Health", ["sentry"]),
    ),
    extension(
      "gcloud",
      "Google Cloud Health",
      "Google Cloud logs and metrics helper.",
      actionSearchExtension("Google Cloud Health", ["gcloud"]),
    ),
    extension(
      "jira",
      "Jira Tickets",
      "Jira search, sprint, and analytics helper.",
      actionSearchExtension("Jira Tickets", ["jira", "jira-analytics"]),
    ),
    extension(
      "fusion-eng",
      "Fusion Engineering",
      "Grafana/GCloud engineering telemetry launcher.",
      actionSearchExtension("Fusion Engineering", ["grafana", "gcloud"]),
    ),
    extension(
      "cx-double-click",
      "CX Double Click",
      "CX pipeline and renewal workflow shell.",
      actionSearchExtension("CX Double Click", [
        "bigquery",
        "hubspot-deals",
        "pylon-issues",
      ]),
    ),
    extension(
      "onboarding-progress",
      "Onboarding Progress",
      "Org-scoped onboarding snapshot browser.",
      dataBrowserExtension("Onboarding Progress", "onboarding"),
      [
        jsonData(
          "onboarding",
          "latest-snapshot",
          "data/onboarding/latest-snapshot.json",
        ),
        jsonData(
          "onboarding",
          "latest-diff",
          "data/onboarding/latest-diff.json",
        ),
        jsonData("onboarding", "crossref", "data/onboarding/crossref.json"),
        jsonData("onboarding", "owners", "data/onboarding/owners.json"),
        jsonData(
          "onboarding",
          "product-metrics",
          "data/onboarding/product-metrics.json",
        ),
        jsonData(
          "onboarding",
          "previous-product-metrics",
          "data/onboarding/previous-product-metrics.json",
        ),
        jsonData(
          "onboarding",
          "previous-snapshot",
          "data/onboarding/previous-snapshot.json",
        ),
        jsonData(
          "onboarding",
          "summary-cache",
          "data/onboarding/summary-cache.json",
        ),
        jsonData(
          "onboarding",
          "usage-cache",
          "data/onboarding/usage-cache.json",
        ),
        jsonData(
          "onboarding",
          "contract-usage",
          "data/onboarding/contract-usage.json",
        ),
        rawData(
          "onboarding",
          "latest-weekly-digest",
          "data/onboarding/latest-weekly-digest.md",
        ),
        ...jsonDirectoryData(
          "onboarding",
          "account-bundle",
          "data/onboarding/account-bundles",
        ),
        ...jsonDirectoryData(
          "onboarding",
          "account-analysis",
          "data/onboarding/account-analysis",
        ),
        ...rawDirectoryData(
          "onboarding",
          "bundle-md",
          "data/onboarding/bundles",
        ),
      ],
    ),
    extension(
      "competitive-landscape",
      "Competitive Landscape",
      "Competitive mention data and refresh notes.",
      dataBrowserExtension("Competitive Landscape", "competitive"),
      [
        jsonData(
          "competitive",
          "mentions",
          "data/gong-competitor-mentions.json",
        ),
        jsonData("competitive", "status", "data/gong-competitor-status.json"),
      ],
    ),
    extension(
      "expansion-attainment",
      "Expansion Attainment Plan",
      "Expansion planning helper with persisted scenarios.",
      actionSearchExtension("Expansion Attainment Plan", [
        "hubspot-deals",
        "hubspot-metrics",
      ]),
    ),
    extension(
      "strategic-accounts",
      "Strategic Accounts",
      "Strategic account coverage and blocker source data.",
      dataBrowserExtension("Strategic Accounts", "strategic"),
      [
        rawData(
          "strategic",
          "accounts-data",
          "client/pages/adhoc/strategic-accounts/data.ts",
        ),
        rawData(
          "strategic",
          "impl-blockers-data",
          "client/pages/adhoc/impl-blockers/data.ts",
        ),
      ],
    ),
    extension(
      "agent-native-metrics",
      "Product Double Click Metrics",
      "NPM, GitHub stars, and contributor snapshots from legacy Fusion data files.",
      dataBrowserExtension(
        "Product Double Click Metrics",
        "agent-native-metrics",
      ),
      [
        jsonData(
          "agent-native-metrics",
          "npm-downloads",
          "data/npm-downloads/npm_downloads_latest.json",
        ),
        jsonData(
          "agent-native-metrics",
          "npm-meta",
          "data/npm-downloads/npm_downloads_meta.json",
        ),
        jsonData(
          "agent-native-metrics",
          "github-stars",
          "data/github-stars/stars_latest.json",
        ),
        jsonData(
          "agent-native-metrics",
          "github-contributors",
          "data/github-contributors/contributors_latest.json",
        ),
      ],
    ),
    extension(
      "ae-pipeline",
      "AE PG Scoreboard",
      "Interactive AE pipeline scoreboard migrated from the top-level Fusion dashboard.",
      aePipelineExtension(),
    ),
  ];
}

function extension(
  id: string,
  name: string,
  description: string,
  content: string,
  data?: ExtensionMigration["data"],
): ExtensionMigration {
  return { id, name, description, content, icon: "LayoutDashboard", data };
}

function jsonData(collection: string, itemId: string, rel: string) {
  const raw = readLegacy(rel);
  return {
    collection,
    itemId,
    data: {
      kind: "json",
      sourcePath: rel,
      value: JSON.parse(raw),
      sha256: hashStrings([raw]),
    },
  };
}

function rawData(collection: string, itemId: string, rel: string) {
  const raw = readLegacy(rel);
  return {
    collection,
    itemId,
    data: {
      kind: "raw",
      sourcePath: rel,
      value: raw,
      sha256: hashStrings([raw]),
    },
  };
}

function jsonDirectoryData(collection: string, prefix: string, relDir: string) {
  const abs = path.resolve(LEGACY_ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) =>
      jsonData(
        collection,
        `${prefix}:${file.replace(/\.json$/, "")}`,
        `${relDir}/${file}`,
      ),
    );
}

function rawDirectoryData(collection: string, prefix: string, relDir: string) {
  const abs = path.resolve(LEGACY_ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) =>
      rawData(
        collection,
        `${prefix}:${file.replace(/\.md$/, "")}`,
        `${relDir}/${file}`,
      ),
    );
}

function baseExtension(title: string, body: string): string {
  return `<div class="p-4 space-y-4 text-sm" x-data="{}">
  <div>
    <h1 class="text-lg font-semibold">${escapeHtml(title)}</h1>
  </div>
  ${body}
</div>`;
}

function actionSearchExtension(title: string, actions: string[]): string {
  return baseExtension(
    title,
    `<div x-data="{ query: '', loading: false, error: '', results: {}, paramsFor(action) { const q = this.query.trim(); switch (action) { case 'bigquery': return { sql: q || 'SELECT 1 AS ok' }; case 'gong-calls': return q ? { company: q } : {}; case 'gcloud': return q ? { mode: 'logs', service: q, limit: 25 } : { mode: 'services' }; case 'grafana': return q ? { mode: 'dashboards', search: q } : { mode: 'dashboards' }; case 'jira': return q ? { mode: 'search', jql: q, maxResults: 25 } : { mode: 'projects' }; case 'jira-analytics': return q ? { projects: q } : {}; case 'sentry': return q ? { mode: 'issues', query: q } : { mode: 'issues' }; case 'hubspot-deals': case 'hubspot-metrics': case 'hubspot-pipelines': return {}; default: return q ? { query: q } : {}; } }, async run(action) { this.loading = true; this.error = ''; try { this.results[action] = await appAction(action, this.paramsFor(action)); } catch (e) { this.error = e.message || String(e); } finally { this.loading = false; } } }" class="space-y-3">
      <input x-model="query" class="w-full rounded border px-3 py-2" placeholder="Search term, company, project, or query" />
      <div class="flex flex-wrap gap-2">
        ${actions.map((action) => `<button class="rounded border px-3 py-1.5 text-xs" x-on:click="run('${action}')">${action}</button>`).join("")}
      </div>
      <p x-show="loading" class="text-muted-foreground">Loading...</p>
      <p x-show="error" x-text="error" class="text-red-600"></p>
      <template x-for="(value, key) in results" :key="key">
        <section class="rounded border p-3">
          <h2 class="font-medium" x-text="key"></h2>
          <pre class="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs" x-text="JSON.stringify(value, null, 2)"></pre>
        </section>
      </template>
    </div>`,
  );
}

function dataBrowserExtension(title: string, collection: string): string {
  return baseExtension(
    title,
    `<div x-data="{ rows: [], selected: null, loading: true, async init() { this.rows = await extensionData.list('${collection}', { scope: 'org' }); this.loading = false; } }" x-init="init()" class="space-y-3">
      <p x-show="loading" class="text-muted-foreground">Loading migrated SQL data...</p>
      <div class="grid gap-2">
        <template x-for="row in rows" :key="row.itemId || row.id">
          <button class="rounded border px-3 py-2 text-left hover:bg-accent" x-on:click="selected = row">
            <span class="font-medium" x-text="row.itemId || row.id"></span>
            <span class="ml-2 text-xs text-muted-foreground" x-text="row.data?.sourcePath || ''"></span>
          </button>
        </template>
      </div>
      <pre x-show="selected" class="max-h-[520px] overflow-auto rounded border bg-muted p-3 text-xs" x-text="JSON.stringify(selected?.data?.value ?? selected?.data, null, 2)"></pre>
    </div>`,
  );
}

function aePipelineExtension(): string {
  return baseExtension(
    "AE PG Scoreboard",
    `<script>
      function aePipelineScoreboard() {
        return {
          quarter: 'q2-fy2027',
          pipeline: 'both',
          aeType: 'all',
          manager: 'all',
          loading: false,
          error: '',
          rows: [],
          managers: [],
          stageNote: '',
          quarters: {
            'q1-fy2027': { label: 'Q1 FY2027', range: 'Feb 1 - Apr 30', start: '2026-02-01', end: '2026-04-30' },
            'q2-fy2027': { label: 'Q2 FY2027', range: 'May 1 - Jul 31', start: '2026-05-01', end: '2026-07-31' }
          },
          targets: [
            { owner: 'Sharon Rosenblum', manager: 'Matt Duignan', type: 'CAE', pipeline: 585000, s1: 8 },
            { owner: 'Dakota Johnson', manager: 'Matt Duignan', type: 'CAE', pipeline: 712500, s1: 9 },
            { owner: 'Andrew Goodhand', manager: 'Matt Duignan', type: 'CAE', pipeline: 712500, s1: 9 },
            { owner: 'Ziv Abergel', manager: 'Matt Duignan', type: 'CAE', pipeline: 712500, s1: 9 },
            { owner: 'Taylor Nielsen', manager: 'Matt Duignan', type: 'CAE', pipeline: 787500, s1: 10 },
            { owner: 'Wyatt Caldwell', manager: 'Matt Duignan', type: 'CAE', pipeline: 712500, s1: 9 },
            { owner: 'Victoria Villaroel', manager: 'Matt Duignan', type: 'CAE', pipeline: 712500, s1: 9 },
            { owner: 'Michael Castillo', manager: 'Brian Reisman', type: 'EAE', pipeline: 1072500, s1: 11 },
            { owner: 'Erica Schaubroeck', manager: 'Brian Reisman', type: 'EAE', pipeline: 926250, s1: 10 },
            { owner: 'Jessica Farnham', manager: 'Brian Reisman', type: 'EAE', pipeline: 975000, s1: 10 },
            { owner: 'George Schultz', manager: 'Brian Reisman', type: 'EAE', pipeline: 1072500, s1: 11 },
            { owner: 'Thomas Godfrey', manager: 'Brian Reisman', type: 'EAE', pipeline: 893750, s1: 10 },
            { owner: 'Andrew Bishop', manager: 'Erin Buckelew', type: 'EAE', pipeline: 975000, s1: 10 },
            { owner: 'Julia Shkrabova', manager: 'Erin Buckelew', type: 'EAE', pipeline: 1012500, s1: 11 },
            { owner: 'Nina Abassi-Beard', manager: 'Erin Buckelew', type: 'EAE', pipeline: 536250, s1: 6 },
            { owner: 'Oliver Fison', manager: 'Erin Buckelew', type: 'CAE', pipeline: 712500, s1: 9 },
            { owner: 'Logan Tucker', manager: 'Luke Miller', type: 'EAE', pipeline: 1072500, s1: 11 },
            { owner: 'Adam Elias', manager: 'Luke Miller', type: 'EAE', pipeline: 975000, s1: 10 },
            { owner: 'James Russo', manager: 'Luke Miller', type: 'EAE', pipeline: 975000, s1: 10 }
          ],
          async init() {
            await this.load();
          },
          money(value) {
            const n = Number(value || 0);
            if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'm';
            if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000).toLocaleString() + 'k';
            return '$' + Math.round(n).toLocaleString();
          },
          pct(value) {
            return Math.round(Number(value || 0) * 100) + '%';
          },
          targetSql() {
            return this.targets.map((t) => "STRUCT('" + t.owner.replace(/'/g, "''") + "' AS owner_name, '" + t.manager.replace(/'/g, "''") + "' AS manager_name, '" + t.type + "' AS ae_type, " + t.pipeline + ".0 AS pipeline_target, " + t.s1 + " AS s1_target)").join(",\\n    ");
          },
          pipelinePredicate() {
            if (this.pipeline === 'new-business') return "AND LOWER(COALESCE(d.pipeline_name, '')) LIKE '%new business%'";
            if (this.pipeline === 'expansion') return "AND LOWER(COALESCE(d.pipeline_name, '')) LIKE '%expansion%' AND LOWER(COALESCE(d.pipeline_name, '')) NOT LIKE '%self%'";
            return "AND (LOWER(COALESCE(d.pipeline_name, '')) LIKE '%new business%' OR (LOWER(COALESCE(d.pipeline_name, '')) LIKE '%expansion%' AND LOWER(COALESCE(d.pipeline_name, '')) NOT LIKE '%self%'))";
          },
          sql() {
            const q = this.quarters[this.quarter];
            return [
              "WITH targets AS (",
              "  SELECT * FROM UNNEST([",
              "    " + this.targetSql(),
              "  ])",
              "), deals AS (",
              "  SELECT",
              "    COALESCE(sales_rep_owner_name, 'Unassigned') AS owner_name,",
              "    COALESCE(stage_name, '') AS stage_name,",
              "    COALESCE(pipeline_name, '') AS pipeline_name,",
              "    SAFE_CAST(amount AS FLOAT64) AS amount,",
              "    DATE(close_date) AS close_date,",
              "    COALESCE(is_deal_closed, FALSE) AS is_deal_closed,",
              "    DATE(nbm_meeting_booked_date) AS nbm_booked_date,",
              "    DATE(nbm_meeting_complete_date) AS nbm_completed_date",
              "  FROM \`builder-3b0a2.dbt_mart.dim_hs_deals\` d",
              "  WHERE DATE(close_date) BETWEEN DATE('" + q.start + "') AND DATE('" + q.end + "')",
              "  " + this.pipelinePredicate(),
              ")",
              "SELECT",
              "  t.owner_name, t.manager_name, t.ae_type, t.pipeline_target, t.s1_target,",
              "  COUNTIF(d.owner_name IS NOT NULL AND STARTS_WITH(LOWER(d.stage_name), 's0')) AS s0,",
              "  COUNTIF(d.owner_name IS NOT NULL AND d.nbm_booked_date BETWEEN DATE('" + q.start + "') AND DATE('" + q.end + "')) AS nbm_scheduled,",
              "  COUNTIF(d.owner_name IS NOT NULL AND d.nbm_completed_date BETWEEN DATE('" + q.start + "') AND DATE('" + q.end + "')) AS nbm_completed,",
              "  COUNTIF(d.owner_name IS NOT NULL AND NOT STARTS_WITH(LOWER(d.stage_name), 's0') AND NOT d.is_deal_closed) AS s1,",
              "  COALESCE(SUM(IF(d.owner_name IS NOT NULL AND NOT STARTS_WITH(LOWER(d.stage_name), 's0') AND NOT d.is_deal_closed, d.amount, 0)), 0) AS s1_amount",
              "FROM targets t",
              "LEFT JOIN deals d ON LOWER(d.owner_name) = LOWER(t.owner_name)",
              "GROUP BY t.owner_name, t.manager_name, t.ae_type, t.pipeline_target, t.s1_target",
              "ORDER BY t.manager_name, t.owner_name"
            ].join("\\n");
          },
          async load() {
            this.loading = true;
            this.error = '';
            try {
              const result = await appAction('bigquery', { sql: this.sql() });
              this.rows = (result.rows || []).map((row) => {
                const s1Target = Number(row.s1_target || 0);
                const pipelineTarget = Number(row.pipeline_target || 0);
                const s1 = Number(row.s1 || 0);
                const amount = Number(row.s1_amount || 0);
                return {
                  owner: row.owner_name,
                  manager: row.manager_name,
                  type: row.ae_type,
                  s0: Number(row.s0 || 0),
                  nbmScheduled: Number(row.nbm_scheduled || 0),
                  nbmCompleted: Number(row.nbm_completed || 0),
                  s1,
                  s1Amount: amount,
                  s1Target,
                  pipelineTarget,
                  s1Gap: s1Target ? s1Target - s1 : null,
                  pipelineGap: pipelineTarget ? pipelineTarget - amount : null,
                  attainment: s1Target ? s1 / s1Target : null,
                  pipelineAttainment: pipelineTarget ? amount / pipelineTarget : null
                };
              });
              this.rollupManagers();
              this.stageNote = 'S0 = Stage 0 opportunities; S1 = active non-S0 pipeline; NBM = HubSpot NBM meeting fields.';
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loading = false;
            }
          },
          rollupManagers() {
            const map = {};
            for (const row of this.rows) {
              if (!map[row.manager]) map[row.manager] = { manager: row.manager, s0: 0, nbmScheduled: 0, nbmCompleted: 0, s1: 0, s1Amount: 0, s1Target: 0, pipelineTarget: 0 };
              const m = map[row.manager];
              m.s0 += row.s0;
              m.nbmScheduled += row.nbmScheduled;
              m.nbmCompleted += row.nbmCompleted;
              m.s1 += row.s1;
              m.s1Amount += row.s1Amount;
              m.s1Target += row.s1Target;
              m.pipelineTarget += row.pipelineTarget;
            }
            this.managers = Object.values(map).map((m) => ({ ...m, s1Gap: m.s1Target - m.s1, pipelineGap: m.pipelineTarget - m.s1Amount, attainment: m.s1Target ? m.s1 / m.s1Target : 0 })).sort((a, b) => a.manager.localeCompare(b.manager));
          },
          filteredRows() {
            return this.rows.filter((row) => (this.aeType === 'all' || row.type === this.aeType) && (this.manager === 'all' || row.manager === this.manager)).sort((a, b) => (b.pipelineTarget || 0) - (a.pipelineTarget || 0));
          },
          totals() {
            const rows = this.filteredRows();
            const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
            return { s0: sum('s0'), nbmScheduled: sum('nbmScheduled'), nbmCompleted: sum('nbmCompleted'), s1: sum('s1'), s1Amount: sum('s1Amount'), s1Target: sum('s1Target'), pipelineTarget: sum('pipelineTarget') };
          },
          color(value) {
            if (value == null) return 'text-muted-foreground';
            if (value >= 1) return 'text-emerald-400';
            if (value >= 0.75) return 'text-amber-400';
            return 'text-red-400';
          }
        };
      }
    </script>
    <div x-data="aePipelineScoreboard()" x-init="init()" class="space-y-4">
      <div class="rounded border bg-muted/30 p-4">
        <div class="flex flex-wrap items-end gap-3">
          <label class="space-y-1 text-xs text-muted-foreground">Quarter
            <select x-model="quarter" x-on:change="load()" class="block rounded border bg-background px-3 py-2 text-sm text-foreground">
              <template x-for="(q, id) in quarters" :key="id"><option x-bind:value="id" x-text="q.label + ' · ' + q.range"></option></template>
            </select>
          </label>
          <label class="space-y-1 text-xs text-muted-foreground">Pipeline
            <select x-model="pipeline" x-on:change="load()" class="block rounded border bg-background px-3 py-2 text-sm text-foreground">
              <option value="both">New Business + Expansion</option>
              <option value="new-business">New Business</option>
              <option value="expansion">Expansion</option>
            </select>
          </label>
          <label class="space-y-1 text-xs text-muted-foreground">AE Type
            <select x-model="aeType" class="block rounded border bg-background px-3 py-2 text-sm text-foreground">
              <option value="all">All</option><option value="CAE">CAE</option><option value="EAE">EAE</option>
            </select>
          </label>
          <label class="space-y-1 text-xs text-muted-foreground">Manager
            <select x-model="manager" class="block rounded border bg-background px-3 py-2 text-sm text-foreground">
              <option value="all">All Managers</option>
              <template x-for="m in managers" :key="m.manager"><option x-bind:value="m.manager" x-text="m.manager"></option></template>
            </select>
          </label>
          <button class="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" x-on:click="load()">Refresh</button>
        </div>
        <p class="mt-3 text-xs text-muted-foreground" x-text="stageNote"></p>
      </div>
      <p x-show="loading" class="rounded border p-3 text-muted-foreground">Loading HubSpot-backed AE pipeline...</p>
      <p x-show="error" x-text="error" class="rounded border border-red-500/30 bg-red-950/20 p-3 text-red-500"></p>
      <template x-if="!loading && !error">
        <div class="space-y-4">
          <div class="grid gap-3 md:grid-cols-4">
            <div class="rounded border p-3"><p class="text-xs text-muted-foreground">S0 Created</p><p class="text-2xl font-semibold" x-text="totals().s0"></p></div>
            <div class="rounded border p-3"><p class="text-xs text-muted-foreground">NBMs Scheduled / Complete</p><p class="text-2xl font-semibold"><span x-text="totals().nbmScheduled"></span> / <span x-text="totals().nbmCompleted"></span></p></div>
            <div class="rounded border p-3"><p class="text-xs text-muted-foreground">S1 Pipeline</p><p class="text-2xl font-semibold" x-text="money(totals().s1Amount)"></p></div>
            <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Projected S1 Attainment</p><p class="text-2xl font-semibold" x-bind:class="color(totals().s1Target ? totals().s1 / totals().s1Target : null)" x-text="totals().s1Target ? pct(totals().s1 / totals().s1Target) : '—'"></p></div>
          </div>
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">By Manager</p>
            <div class="grid gap-2 md:grid-cols-4">
              <template x-for="m in managers" :key="m.manager">
                <button class="rounded border p-3 text-left hover:bg-accent" x-on:click="manager = manager === m.manager ? 'all' : m.manager">
                  <p class="font-medium" x-text="m.manager"></p>
                  <p class="mt-2 text-sm"><span x-text="m.s1"></span> S1 · <span x-text="money(m.s1Amount)"></span></p>
                  <p class="text-xs text-muted-foreground">Gap <span x-text="m.s1Gap"></span> S1 · <span x-text="money(m.pipelineGap)"></span></p>
                </button>
              </template>
            </div>
          </div>
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">By AE</p>
            <div class="overflow-auto rounded border">
            <table class="w-full min-w-[920px] text-sm">
              <thead class="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th class="px-3 py-2 text-left">AE</th><th class="px-3 py-2 text-left">Type</th><th class="px-3 py-2 text-left">Manager</th><th class="px-3 py-2 text-right">S0</th><th class="px-3 py-2 text-right">NBM Sched</th><th class="px-3 py-2 text-right">NBM Comp</th><th class="px-3 py-2 text-right">S1</th><th class="px-3 py-2 text-right">S1 Gap</th><th class="px-3 py-2 text-right">S1 Amount</th><th class="px-3 py-2 text-right">Pipeline Gap</th><th class="px-3 py-2 text-right">Attainment</th></tr>
              </thead>
              <tbody>
                <template x-for="row in filteredRows()" :key="row.owner">
                  <tr class="border-t">
                    <td class="px-3 py-2 font-medium" x-text="row.owner"></td>
                    <td class="px-3 py-2 text-muted-foreground" x-text="row.type"></td>
                    <td class="px-3 py-2 text-muted-foreground" x-text="row.manager"></td>
                    <td class="px-3 py-2 text-right tabular-nums" x-text="row.s0"></td>
                    <td class="px-3 py-2 text-right tabular-nums" x-text="row.nbmScheduled"></td>
                    <td class="px-3 py-2 text-right tabular-nums" x-text="row.nbmCompleted"></td>
                    <td class="px-3 py-2 text-right tabular-nums" x-text="row.s1 + ' / ' + row.s1Target"></td>
                    <td class="px-3 py-2 text-right tabular-nums" x-bind:class="color(row.attainment)" x-text="row.s1Gap ?? '—'"></td>
                    <td class="px-3 py-2 text-right tabular-nums" x-text="money(row.s1Amount)"></td>
                    <td class="px-3 py-2 text-right tabular-nums" x-bind:class="color(row.pipelineAttainment)" x-text="row.pipelineGap == null ? '—' : money(row.pipelineGap)"></td>
                    <td class="px-3 py-2 text-right tabular-nums" x-bind:class="color(row.attainment)" x-text="row.attainment == null ? '—' : pct(row.attainment)"></td>
                  </tr>
                </template>
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </template>
    </div>`,
  );
}

function stripeExtension(): string {
  return baseExtension(
    "Stripe Billing",
    `<div x-data="{ query: '', mode: 'billing', months: 6, loading: false, result: null, error: '', async run() { this.loading = true; this.error = ''; this.result = null; try { this.result = await appAction('stripe', { mode: this.mode, query: this.query, months: this.months }); } catch (e) { this.error = e.message || String(e); } finally { this.loading = false; } } }" class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <input x-model="query" class="min-w-64 rounded border px-3 py-2" placeholder="Customer name, email, Stripe ID, or root org ID" />
        <select x-model="mode" class="rounded border px-3 py-2">
          <option value="billing">Billing</option>
          <option value="payment-status">Payment status</option>
          <option value="refunds">Refunds</option>
          <option value="subscriptions">Subscriptions</option>
          <option value="billing-by-product">Billing by product</option>
        </select>
        <input x-model.number="months" type="number" min="1" max="60" class="w-24 rounded border px-3 py-2" />
        <button class="rounded bg-primary px-3 py-2 text-primary-foreground" x-on:click="run()">Run</button>
      </div>
      <p x-show="loading" class="text-muted-foreground">Loading Stripe data...</p>
      <p x-show="error" x-text="error" class="text-red-600"></p>
      <pre x-show="result" class="max-h-[560px] overflow-auto rounded border bg-muted p-3 text-xs" x-text="JSON.stringify(result, null, 2)"></pre>
    </div>`,
  );
}

function slackExtension(): string {
  return baseExtension(
    "Slack Feedback",
    `<div x-data="{ query: '', loading: false, result: null, error: '', async search() { this.loading = true; this.error = ''; try { this.result = await appAction('slack-messages', { mode: 'search', query: this.query, limit: 50 }); } catch (e) { this.error = e.message || String(e); } finally { this.loading = false; } } }" class="space-y-3">
      <div class="flex gap-2">
        <input x-model="query" class="min-w-80 flex-1 rounded border px-3 py-2" placeholder="Slack search query" />
        <button class="rounded bg-primary px-3 py-2 text-primary-foreground" x-on:click="search()">Search</button>
      </div>
      <p x-show="loading" class="text-muted-foreground">Searching Slack...</p>
      <p x-show="error" x-text="error" class="text-red-600"></p>
      <pre x-show="result" class="max-h-[560px] overflow-auto rounded border bg-muted p-3 text-xs" x-text="JSON.stringify(result, null, 2)"></pre>
    </div>`,
  );
}

function queryExplorerExtension(): string {
  return baseExtension(
    "Query Explorer",
    `<div x-data="{ sql: 'SELECT 1 AS ok', loading: false, result: null, error: '', async run() { this.loading = true; this.error = ''; try { this.result = await appAction('bigquery', { sql: this.sql }); await extensionData.set('history', String(Date.now()), { sql: this.sql, ranAt: new Date().toISOString() }, { scope: 'org' }); } catch (e) { this.error = e.message || String(e); } finally { this.loading = false; } } }" class="space-y-3">
      <textarea x-model="sql" class="h-56 w-full rounded border p-3 font-mono text-xs"></textarea>
      <button class="rounded bg-primary px-3 py-2 text-primary-foreground" x-on:click="run()">Run BigQuery</button>
      <p x-show="loading" class="text-muted-foreground">Running...</p>
      <p x-show="error" x-text="error" class="text-red-600"></p>
      <pre x-show="result" class="max-h-[560px] overflow-auto rounded border bg-muted p-3 text-xs" x-text="JSON.stringify(result, null, 2)"></pre>
    </div>`,
  );
}

function dbtExtension(): string {
  return baseExtension(
    "dbt Model Workspace",
    `<div x-data="{ name: '', sql: '', saved: [], result: null, async init() { this.saved = await extensionData.list('models', { scope: 'org' }); }, async save() { await extensionData.set('models', this.name || String(Date.now()), { name: this.name, sql: this.sql, updatedAt: new Date().toISOString() }, { scope: 'org' }); await this.init(); }, async test() { this.result = await appAction('bigquery', { sql: this.sql }); } }" x-init="init()" class="space-y-3">
      <input x-model="name" class="w-full rounded border px-3 py-2" placeholder="Model or snippet name" />
      <textarea x-model="sql" class="h-48 w-full rounded border p-3 font-mono text-xs" placeholder="Paste model SQL"></textarea>
      <div class="flex gap-2"><button class="rounded border px-3 py-2" x-on:click="save()">Save</button><button class="rounded bg-primary px-3 py-2 text-primary-foreground" x-on:click="test()">Test SQL</button></div>
      <pre x-show="result" class="max-h-96 overflow-auto rounded border bg-muted p-3 text-xs" x-text="JSON.stringify(result, null, 2)"></pre>
    </div>`,
  );
}

function qbrExtension(): string {
  return baseExtension(
    "QBR Deck Builder",
    `<script>
      function salesQbr() {
        return {
          owner: '',
          owners: ['Sharon Rosenblum','Dakota Johnson','Andrew Goodhand','Ziv Abergel','Taylor Nielsen','Wyatt Caldwell','Victoria Villaroel','Michael Castillo','Erica Schaubroeck','Jessica Farnham','George Schultz','Thomas Godfrey','Nina Abassi-Beard','Andrew Bishop','Oliver Fison','Julia Shkrabova','Logan Tucker','Adam Elias','James Russo'],
          loading: false,
          error: '',
          deckOpen: false,
          slide: 0,
          showExportMenu: false,
          exportLabel: '',
          logoUrl: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1672146e7e56476c8dd86df8d630d5b7?format=webp&width=800&height=1200',
          slides: ['Cover','Agenda','Goals','Q1 Performance','Q1 NBMs','Q2 Forecast','Territory Plan','Growth & Support','Thank You'],
          saved: [],
          hs: null,
          form: {
            q1GoalsLookback: '',
            fy26GoalsLookback: '',
            fy27SmartGoals: '',
            q2SmartGoals: '',
            q1CommitAtWeek5: '',
            q1BestCaseAtWeek5: '',
            q1Analysis: '',
            nbmRows: [],
            q2Target: '',
            territoryPlanLink: '',
            ask1: '',
            ask2: '',
            ask3: ''
          },
          parse(row) {
            if (!row || row.data == null) return null;
            try {
              const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
              return parsed && parsed.value ? parsed.value : parsed;
            } catch (_) {
              return null;
            }
          },
          async init() {
            this.saved = await extensionData.list('qbr-notes', { scope: 'org' });
          },
          emptyForm() {
            return {
              q1GoalsLookback: '',
              fy26GoalsLookback: '',
              fy27SmartGoals: '',
              q2SmartGoals: '',
              q1CommitAtWeek5: '',
              q1BestCaseAtWeek5: '',
              q1Analysis: '',
              nbmRows: [],
              q2Target: '',
              territoryPlanLink: '',
              ask1: '',
              ask2: '',
              ask3: ''
            };
          },
          async selectOwner(name) {
            this.owner = name;
            this.deckOpen = false;
            this.slide = 0;
            this.form = this.emptyForm();
            await Promise.all([this.loadSaved(name), this.loadDeals()]);
          },
          async loadSaved(name) {
            const row = await extensionData.get('qbr-notes', name || this.owner, { scope: 'org' });
            const data = this.parse(row);
            if (data) this.form = { ...this.form, ...data };
          },
          dealSql() {
            const owner = this.owner.replace(/'/g, "''");
            return [
              "WITH deals AS (",
              "  SELECT deal_name, company_name, stage_name, pipeline_name, DATE(close_date) AS close_date, SAFE_CAST(amount AS FLOAT64) AS amount, COALESCE(hs_manual_forecast_category, 'Uncategorized') AS forecast_category, COALESCE(is_closed_won, FALSE) AS is_closed_won, COALESCE(is_deal_closed, FALSE) AS is_deal_closed, DATE(nbm_meeting_booked_date) AS nbm_booked_date, DATE(nbm_meeting_complete_date) AS nbm_completed_date",
              "  FROM \`builder-3b0a2.dbt_mart.dim_hs_deals\`",
              "  WHERE LOWER(COALESCE(sales_rep_owner_name, '')) = LOWER('" + owner + "')",
              ")",
              "SELECT",
              "  COUNTIF(is_closed_won AND DATE(close_date) BETWEEN DATE('2026-02-01') AND DATE('2026-04-30')) AS q1_closed_won_count,",
              "  COALESCE(SUM(IF(is_closed_won AND DATE(close_date) BETWEEN DATE('2026-02-01') AND DATE('2026-04-30'), amount, 0)), 0) AS q1_closed_won_arr,",
              "  COUNTIF(is_deal_closed AND NOT is_closed_won AND DATE(close_date) BETWEEN DATE('2026-02-01') AND DATE('2026-04-30')) AS q1_closed_lost_count,",
              "  COUNTIF(STARTS_WITH(LOWER(stage_name), 's0') AND DATE(close_date) BETWEEN DATE('2026-02-01') AND DATE('2026-04-30')) AS q1_s0_count,",
              "  COUNTIF(nbm_booked_date BETWEEN DATE('2026-02-01') AND DATE('2026-04-30')) AS q1_nbm_scheduled,",
              "  COUNTIF(nbm_completed_date BETWEEN DATE('2026-02-01') AND DATE('2026-04-30')) AS q1_nbm_completed,",
              "  COUNTIF(NOT STARTS_WITH(LOWER(stage_name), 's0') AND NOT is_deal_closed AND DATE(close_date) BETWEEN DATE('2026-05-01') AND DATE('2026-07-31')) AS q2_pipeline_count,",
              "  COALESCE(SUM(IF(NOT STARTS_WITH(LOWER(stage_name), 's0') AND NOT is_deal_closed AND DATE(close_date) BETWEEN DATE('2026-05-01') AND DATE('2026-07-31'), amount, 0)), 0) AS q2_pipeline_arr,",
              "  ARRAY_AGG(STRUCT(deal_name, company_name, stage_name, pipeline_name, close_date, amount, forecast_category) ORDER BY amount DESC LIMIT 12) AS top_deals",
              "FROM deals"
            ].join("\\n");
          },
          async loadDeals() {
            if (!this.owner.trim()) { return; }
            this.loading = true; this.error = '';
            try {
              const result = await appAction('bigquery', { sql: this.dealSql() });
              this.hs = (result.rows || [])[0] || null;
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loading = false;
            }
          },
          async save() {
            if (!this.owner.trim()) { this.error = 'Enter an AE owner name first.'; return; }
            await extensionData.set('qbr-notes', this.owner, { owner: this.owner, ...this.form, updatedAt: new Date().toISOString() }, { scope: 'org' });
            await this.init();
          },
          money(value) {
            const n = Number(value || 0);
            if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'm';
            if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000).toLocaleString() + 'k';
            return '$' + Math.round(n).toLocaleString();
          },
          fullMoney(value) {
            return '$' + Math.round(Number(value || 0)).toLocaleString();
          },
          q1Attainment() {
            const target = Number(this.form.q1CommitAtWeek5 || 0);
            const closed = Number(this.hs?.q1_closed_won_arr || 0);
            return target ? Math.round((closed / target) * 100) + '%' : '—';
          },
          q2TargetDisplay() {
            return this.form.q2Target ? this.form.q2Target : this.money(this.hs?.q2_pipeline_arr || 0);
          },
          q2Deals() {
            return Array.isArray(this.hs?.top_deals) ? this.hs.top_deals.slice(0, 12) : [];
          },
          askList() {
            return [this.form.ask1, this.form.ask2, this.form.ask3];
          },
          printDeck() {
            this.showExportMenu = false;
            window.print();
          },
          downloadHtml() {
            this.showExportMenu = false;
            const deck = document.querySelector('[data-qbr-deck-print]');
            if (!deck) return;
            const title = 'QBR_' + (this.owner || 'AE').replace(/[^a-z0-9]+/gi, '_') + '.html';
            const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><script src="https://cdn.tailwindcss.com"><\\/script><style>body{margin:0;background:#050505;color:white;font-family:Arial,sans-serif}.slide{width:1280px;height:720px;page-break-after:always;overflow:hidden}.slide:last-child{page-break-after:auto}@media print{@page{size:1280px 720px;margin:0}body{background:#050505}}</style></head><body>' + deck.innerHTML + '</body></html>';
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = title;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
          addNbmRow() {
            this.form.nbmRows.push({ id: String(Date.now()), accountName: '', contactNameTitle: '', products: '', technicalPocIncluded: '', weekNumber: '', builderLeader: '', valuePyramid: '', preNbmDiscoCalls: '', meetingsSinceNBM: '', currentStage: '', opportunityValue: '' });
          }
        };
      }
    </script>
    <div x-data="salesQbr()" x-init="init()" class="space-y-5">
      <div class="rounded border bg-muted/30 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-wide text-muted-foreground">Q1 FY27 Review · Q2 FY27 Planning</p>
            <h2 class="text-xl font-semibold">Sales QBR Deck Builder</h2>
          </div>
          <div class="flex flex-wrap gap-2">
            <select class="min-w-64 rounded border bg-background px-3 py-2" x-on:change="selectOwner($event.target.value)">
              <option value="">Select Account Executive</option>
              <template x-for="name in owners" :key="name"><option x-bind:value="name" x-text="name"></option></template>
            </select>
            <button class="rounded border px-3 py-2" x-bind:disabled="!owner || loading" x-on:click="loadDeals()">Refresh HubSpot</button>
            <button class="rounded border px-3 py-2" x-bind:disabled="!owner" x-on:click="save()">Save</button>
            <button class="rounded bg-primary px-4 py-2 text-primary-foreground" x-bind:disabled="!owner" x-on:click="slide = 0; deckOpen = true">View Deck</button>
          </div>
        </div>
      </div>
      <p x-show="loading" class="text-muted-foreground">Loading HubSpot-backed QBR data...</p>
      <p x-show="error" x-text="error" class="text-red-600"></p>
      <template x-if="owner && hs && !deckOpen">
        <div class="grid gap-3 md:grid-cols-4">
          <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Q1 Closed Won</p><p class="text-xl font-semibold" x-text="money(hs.q1_closed_won_arr)"></p><p class="text-xs text-muted-foreground" x-text="hs.q1_closed_won_count + ' deals'"></p></div>
          <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Q1 Closed Lost</p><p class="text-xl font-semibold" x-text="hs.q1_closed_lost_count"></p></div>
          <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Q1 NBMs</p><p class="text-xl font-semibold"><span x-text="hs.q1_nbm_scheduled"></span> / <span x-text="hs.q1_nbm_completed"></span></p></div>
          <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Q2 Pipeline</p><p class="text-xl font-semibold" x-text="money(hs.q2_pipeline_arr)"></p><p class="text-xs text-muted-foreground" x-text="hs.q2_pipeline_count + ' deals'"></p></div>
        </div>
      </template>
      <div x-show="owner && !deckOpen" class="space-y-4">
        <section class="rounded border p-4">
          <h3 class="mb-3 font-semibold">Goals</h3>
          <div class="grid gap-3 md:grid-cols-2">
            <textarea x-model="form.q1GoalsLookback" class="h-24 rounded border p-3" placeholder="Q1 goals lookback"></textarea>
            <textarea x-model="form.fy26GoalsLookback" class="h-24 rounded border p-3" placeholder="FY26 goals lookback"></textarea>
            <textarea x-model="form.fy27SmartGoals" class="h-24 rounded border p-3" placeholder="FY27 SMART goals"></textarea>
            <textarea x-model="form.q2SmartGoals" class="h-24 rounded border p-3" placeholder="Q2 SMART goals"></textarea>
          </div>
        </section>
        <section class="rounded border p-4">
          <h3 class="mb-3 font-semibold">Performance Summary</h3>
          <div class="grid gap-3 md:grid-cols-3">
            <input x-model="form.q1CommitAtWeek5" class="rounded border px-3 py-2" placeholder="Q1 commit at week 5" />
            <input x-model="form.q1BestCaseAtWeek5" class="rounded border px-3 py-2" placeholder="Q1 best case at week 5" />
            <input x-model="form.q2Target" class="rounded border px-3 py-2" placeholder="Q2 target" />
          </div>
          <textarea x-model="form.q1Analysis" class="mt-3 h-24 w-full rounded border p-3" placeholder="Q1 analysis"></textarea>
        </section>
        <section class="rounded border p-4">
          <div class="mb-3 flex items-center justify-between"><h3 class="font-semibold">NBM Plan</h3><button class="rounded border px-3 py-1.5 text-xs" x-on:click="addNbmRow()">Add row</button></div>
          <div class="space-y-2">
            <template x-for="row in form.nbmRows" :key="row.id">
              <div class="grid gap-2 md:grid-cols-5">
                <input x-model="row.accountName" class="rounded border px-3 py-2" placeholder="Account" />
                <input x-model="row.contactNameTitle" class="rounded border px-3 py-2" placeholder="Contact / title" />
                <input x-model="row.products" class="rounded border px-3 py-2" placeholder="Products" />
                <input x-model="row.technicalPocIncluded" class="rounded border px-3 py-2" placeholder="Technical POC?" />
                <input x-model="row.weekNumber" class="rounded border px-3 py-2" placeholder="Week" />
                <input x-model="row.builderLeader" class="rounded border px-3 py-2" placeholder="Builder leader" />
                <select x-model="row.valuePyramid" class="rounded border px-3 py-2"><option value="">Value pyramid?</option><option>Yes</option><option>No</option></select>
                <input x-model="row.preNbmDiscoCalls" class="rounded border px-3 py-2" placeholder="Pre-NBM disco calls" />
                <input x-model="row.meetingsSinceNBM" class="rounded border px-3 py-2" placeholder="Meetings since NBM" />
                <input x-model="row.currentStage" class="rounded border px-3 py-2" placeholder="Current stage" />
                <input x-model="row.opportunityValue" class="rounded border px-3 py-2" placeholder="Current $ opportunity" />
              </div>
            </template>
          </div>
        </section>
        <section class="rounded border p-4">
          <h3 class="mb-3 font-semibold">Territory & Asks</h3>
          <input x-model="form.territoryPlanLink" class="mb-3 w-full rounded border px-3 py-2" placeholder="Territory plan link" />
          <div class="grid gap-3 md:grid-cols-3">
            <input x-model="form.ask1" class="rounded border px-3 py-2" placeholder="Ask 1" />
            <input x-model="form.ask2" class="rounded border px-3 py-2" placeholder="Ask 2" />
            <input x-model="form.ask3" class="rounded border px-3 py-2" placeholder="Ask 3" />
          </div>
        </section>
      </div>
      <section x-show="deckOpen" class="fixed inset-0 z-50 flex flex-col bg-black text-white">
        <div class="flex shrink-0 items-center justify-between border-b border-gray-800 bg-[#0a0a0a] px-4 py-2">
          <button class="rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-900 hover:text-white" x-on:click="deckOpen = false">Exit</button>
          <div class="flex max-w-[55%] gap-1 overflow-x-auto">
            <template x-for="(label, i) in slides" :key="label">
              <button class="whitespace-nowrap rounded px-2 py-1 text-xs" x-bind:class="slide === i ? 'bg-[#00B4D8] font-bold text-black' : 'text-gray-500 hover:text-gray-300'" x-on:click="slide = i"><span x-text="(i + 1) + '. ' + label"></span></button>
            </template>
          </div>
          <div class="flex items-center gap-3">
            <div class="relative">
              <button class="rounded border border-gray-700 bg-[#1a1a1a] px-3 py-1.5 text-sm text-gray-300 hover:text-white" x-on:click="showExportMenu = !showExportMenu">Export</button>
              <div x-show="showExportMenu" class="absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-xl border border-gray-700 bg-[#1a1a1a] shadow-2xl">
                <button class="block w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-[#2a2a2a] hover:text-white" x-on:click="printDeck()"><span class="font-semibold">Save as PDF</span><span class="block text-xs text-gray-500">Browser print, landscape</span></button>
                <button class="block w-full border-t border-gray-800 px-4 py-3 text-left text-sm text-gray-300 hover:bg-[#2a2a2a] hover:text-white" x-on:click="downloadHtml()"><span class="font-semibold">Download deck HTML</span><span class="block text-xs text-gray-500">Open/import as needed</span></button>
              </div>
            </div>
            <span class="text-sm text-gray-500" x-text="(slide + 1) + ' / ' + slides.length"></span>
          </div>
        </div>
        <div class="flex flex-1 items-center justify-center bg-[#050505] p-4">
          <div class="relative w-full max-w-[calc((100vh-80px)*16/9)]" style="aspect-ratio:16/9">
            <div class="absolute inset-0 overflow-hidden rounded-sm shadow-2xl">
              <div class="slide relative h-full w-full bg-black" x-show="slide === 0">
                <div class="absolute right-0 top-0 h-full w-2/3 opacity-10" style="background:linear-gradient(135deg, transparent 40%, #333 100%)"></div>
                <div class="absolute right-[-5%] top-[10%] h-[80%] w-[45%] skew-x-[-5deg] bg-gradient-to-br from-[#222] to-[#444] opacity-20"></div>
                <div class="absolute left-[5%] top-[6%] flex items-center gap-2"><img x-bind:src="logoUrl" class="h-9 w-9 object-contain" alt="Builder.io" /><span class="text-lg font-bold tracking-wide">builder.io</span></div>
                <div class="relative z-10 flex h-full flex-col justify-center px-[5%]"><h1 class="text-6xl font-black leading-none tracking-tight">AE QBR Deck</h1><p class="mt-4 text-xl text-gray-400" x-text="owner || 'Select AE'"></p><p class="mt-1 text-lg text-gray-500">Q1 FY27 Review & Q2 FY27 Plan</p><p class="text-lg text-gray-500">May, 2026</p></div>
                <div class="absolute right-[5%] top-[15%] flex h-[70%] w-[38%] flex-col justify-center rounded border border-[#2a2a2a] bg-[#111] px-[6%]"><p class="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-gray-500">Review Period</p><p class="text-4xl font-black">Q1 FY27</p><p class="mt-2 text-sm text-gray-400">Feb 1 - Apr 30, 2026</p><div class="my-5 h-px w-full bg-gray-800"></div><p class="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-gray-500">Planning Period</p><p class="text-4xl font-black">Q2 FY27</p><p class="mt-2 text-sm text-gray-400">May 1 - Jul 31, 2026</p></div>
              </div>
              <div class="slide flex h-full w-full flex-col justify-center bg-[#0d0d0d] px-[7%] py-[6%]" x-show="slide === 1">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><h1 class="mb-8 text-5xl font-black">Agenda</h1>
                <template x-for="item in [{n:'1',t:'Q1 / FY27 Lookback'},{n:'2',t:'Q2 Forecast & Deals'},{n:'3',t:'FY27 Territory Plan\\nQ2 PipeGen Plan'},{n:'4',t:'Asks of the Business'}]" :key="item.n"><div class="flex items-center gap-6 py-2"><span class="text-5xl font-black text-[#00B4D8]" x-text="item.n"></span><div class="flex-1 border-t border-gray-700"></div><span class="min-w-56 whitespace-pre-line text-right text-xl font-semibold" x-text="item.t"></span></div></template>
              </div>
              <div class="slide flex h-full w-full flex-col bg-[#0d0d0d] px-[6%] py-[5%]" x-show="slide === 2">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><h1 class="mb-4 text-4xl font-black" x-text="'[' + (owner || 'AE Name') + ']'"></h1>
                <div class="grid flex-1 grid-cols-2 gap-3">
                  <div class="flex flex-col gap-3"><p class="text-xs font-bold uppercase tracking-wider text-[#00B4D8]">Look Back</p><div class="flex-1 rounded-lg border border-[#00B4D833] bg-[#1a1a1a] p-4"><p class="mb-2 text-xs font-bold uppercase tracking-wider text-[#00B4D8]">Q1 Goals - Did You Reach Them?</p><p class="whitespace-pre-line text-sm leading-relaxed" x-text="form.q1GoalsLookback || 'Not filled in yet'"></p></div><div class="flex-1 rounded-lg border border-[#00B4D833] bg-[#1a1a1a] p-4"><p class="mb-2 text-xs font-bold uppercase tracking-wider text-[#00B4D8]">Biggest Lesson from Q1</p><p class="whitespace-pre-line text-sm leading-relaxed" x-text="form.fy26GoalsLookback || 'Not filled in yet'"></p></div></div>
                  <div class="flex flex-col gap-3"><p class="text-xs font-bold uppercase tracking-wider text-purple-400">Looking Ahead</p><div class="flex-1 rounded-lg border border-purple-400/30 bg-[#1a1a1a] p-4"><p class="mb-2 text-xs font-bold uppercase tracking-wider text-purple-400">Q2 SMART Goals</p><p class="whitespace-pre-line text-sm leading-relaxed" x-text="form.q2SmartGoals || 'Not filled in yet'"></p></div><div class="flex-1 rounded-lg border border-purple-400/30 bg-[#1a1a1a] p-4"><p class="mb-2 text-xs font-bold uppercase tracking-wider text-purple-400">Biggest Blocker for Q2 Success</p><p class="whitespace-pre-line text-sm leading-relaxed" x-text="form.fy27SmartGoals || 'Not filled in yet'"></p></div></div>
                </div>
              </div>
              <div class="slide flex h-full w-full flex-col bg-[#0d0d0d] px-[5%] py-[4%]" x-show="slide === 3">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><h1 class="mb-3 text-4xl font-black">Q1 Performance Summary</h1>
                <div class="mb-3 overflow-hidden rounded-lg border border-gray-800"><table class="w-full text-xs"><thead><tr class="bg-[#1e1e2e]"><template x-for="m in ['Months in Role','S0s Created','NBMs Completed','Opps Advanced to S1+','Meetings / Week','Commit W5','Best Case W5','Revenue Closed']"><th class="border-r border-gray-700 px-2 py-2 text-left font-bold" x-text="m"></th></template></tr></thead><tbody><tr class="bg-[#141420]"><td class="border-r border-gray-800 px-2 py-3">-</td><td class="border-r border-gray-800 px-2 py-3" x-text="hs?.q1_s0_count || 0"></td><td class="border-r border-gray-800 px-2 py-3" x-text="hs?.q1_nbm_completed || 0"></td><td class="border-r border-gray-800 px-2 py-3" x-text="hs?.q2_pipeline_count || 0"></td><td class="border-r border-gray-800 px-2 py-3">-</td><td class="border-r border-gray-800 px-2 py-3" x-text="form.q1CommitAtWeek5 ? fullMoney(form.q1CommitAtWeek5) : '—'"></td><td class="border-r border-gray-800 px-2 py-3" x-text="form.q1BestCaseAtWeek5 ? fullMoney(form.q1BestCaseAtWeek5) : '—'"></td><td class="px-2 py-3"><p x-text="money(hs?.q1_closed_won_arr || 0)"></p><p class="mt-1 text-gray-400" x-text="'Q1 Attainment: ' + q1Attainment()"></p></td></tr></tbody></table></div>
                <div class="flex-1 overflow-hidden rounded-lg border border-[#333] bg-[#1a1a1a] p-4"><p class="mb-2 font-bold">Q1 Analysis (what went well / less well)</p><p class="whitespace-pre-line text-sm text-gray-300" x-text="form.q1Analysis || 'Analysis not filled in yet'"></p></div>
              </div>
              <div class="slide flex h-full w-full flex-col bg-[#0d0d0d] px-[4%] py-[4%]" x-show="slide === 4">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><h1 class="mb-3 text-4xl font-black">Q1 NBMs</h1>
                <div class="flex-1 overflow-hidden rounded-lg border border-gray-700"><table class="h-full w-full text-[10px]"><thead><tr class="bg-[#1e1e1e]"><template x-for="col in ['Account Name','Primary NBM Contact','Products','Technical POC','Week #','Builder Leader','Value Pyramid','Pre-NBM Calls','Meetings Since','Current Stage','Current $']"><th class="border-r border-gray-700 px-2 py-2 text-left font-bold whitespace-pre-line" x-text="col"></th></template></tr></thead><tbody><template x-if="!form.nbmRows.length"><template x-for="i in 8"><tr class="odd:bg-[#111] even:bg-[#141414]"><template x-for="col in 11"><td class="border-r border-gray-800 px-2 py-2 text-gray-700">&nbsp;</td></template></tr></template></template><template x-for="(row, i) in form.nbmRows" :key="row.id"><tr class="odd:bg-[#111] even:bg-[#141414]"><td class="border-r border-gray-800 px-2 py-2" x-text="row.accountName"></td><td class="border-r border-gray-800 px-2 py-2 text-gray-300" x-text="row.contactNameTitle"></td><td class="border-r border-gray-800 px-2 py-2 text-gray-300" x-text="row.products"></td><td class="border-r border-gray-800 px-2 py-2 text-center text-gray-300" x-text="row.technicalPocIncluded"></td><td class="border-r border-gray-800 px-2 py-2 text-center text-gray-300" x-text="row.weekNumber"></td><td class="border-r border-gray-800 px-2 py-2 text-gray-300" x-text="row.builderLeader"></td><td class="border-r border-gray-800 px-2 py-2 text-center text-gray-300" x-text="row.valuePyramid"></td><td class="border-r border-gray-800 px-2 py-2 text-center text-gray-300" x-text="row.preNbmDiscoCalls"></td><td class="border-r border-gray-800 px-2 py-2 text-center text-gray-300" x-text="row.meetingsSinceNBM"></td><td class="border-r border-gray-800 px-2 py-2 text-gray-300" x-text="row.currentStage"></td><td class="px-2 py-2 text-right" x-text="row.opportunityValue ? fullMoney(row.opportunityValue) : 'none'"></td></tr></template></tbody></table></div>
              </div>
              <div class="slide flex h-full w-full flex-col bg-[#0d0d0d] px-[5%] py-[4%]" x-show="slide === 5">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><h1 class="mb-[3%] text-4xl font-black">Q2 Forecast</h1>
                <div class="grid flex-1 grid-cols-2 gap-[2%]"><div class="flex flex-col justify-between rounded-lg border border-[#2a2a4a] bg-[#111] px-[6%] py-[5%]"><template x-for="m in [{l:'Q1 Target (Actual)',v:form.q1CommitAtWeek5 ? fullMoney(form.q1CommitAtWeek5) : '—'},{l:'Q2 Quota',v:form.q2Target ? fullMoney(form.q2Target) : '—'},{l:'Q2 Target',v:q2TargetDisplay()},{l:'Q2 Qualified Pipeline',v:money(hs?.q2_pipeline_arr || 0)}]"><div class="flex items-baseline justify-between gap-2"><span class="text-gray-400" x-text="m.l"></span><span class="text-right font-bold" x-text="m.v"></span></div></template></div><div class="flex flex-col rounded-lg border border-[#00B4D833] bg-[#111] px-[6%] py-[5%]"><template x-if="!q2Deals().length"><div class="flex h-full items-center justify-center text-gray-600 italic">No Q2 deals found in HubSpot with Q2 close dates</div></template><template x-for="deal in q2Deals()" :key="deal.deal_name || deal.company_name"><div class="flex flex-1 items-center justify-between gap-2 border-b border-gray-800"><span class="truncate" x-text="deal.deal_name || deal.company_name"></span><span class="shrink-0 font-bold" x-text="money(deal.amount || 0)"></span></div></template></div></div>
              </div>
              <div class="slide flex h-full w-full flex-col items-center justify-center bg-[#0d0d0d] px-[8%] py-[6%]" x-show="slide === 6">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><h1 class="mb-8 text-center text-4xl font-black">FY27 Territory Plan and Q2 PG Plan</h1><a x-show="form.territoryPlanLink" class="text-center text-xl text-[#00B4D8] underline" x-bind:href="form.territoryPlanLink" target="_blank" x-text="form.territoryPlanLink"></a><p x-show="!form.territoryPlanLink" class="text-xl italic text-gray-500">[Link to Territory / PG Plan Template]</p>
              </div>
              <div class="slide flex h-full w-full flex-col bg-[#0d0d0d] px-[8%] py-[8%]" x-show="slide === 7">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><h1 class="mb-6 text-4xl font-black">Growth and Support</h1><p class="mb-6 text-xl font-bold">Top 3 asks of the business:</p><div class="flex flex-1 flex-col gap-5"><template x-for="(ask, i) in askList()" :key="i"><div class="flex flex-1 items-start gap-4"><span class="shrink-0 text-3xl font-black text-[#00B4D8]" x-text="(i + 1) + ')'"></span><p class="text-xl leading-relaxed" x-text="ask || 'Not filled in yet'"></p></div></template></div>
              </div>
              <div class="slide flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#050a1a] to-[#0a0a2e]" x-show="slide === 8">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-10 w-10" alt="" /><div class="flex flex-col items-start"><h1 class="text-7xl font-black">Thank you</h1><div class="mt-2 h-[5px] w-[55%] rounded-full bg-[#00D4FF]"></div></div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center justify-center gap-6 border-t border-gray-800 bg-[#0a0a0a] py-2">
          <button class="rounded px-3 py-1.5 text-sm text-gray-300 disabled:opacity-30" x-bind:disabled="slide === 0" x-on:click="slide = Math.max(0, slide - 1)">Prev</button>
          <div class="flex gap-1"><template x-for="(_, i) in slides" :key="i"><button class="h-2 w-2 rounded-full" x-bind:class="slide === i ? 'bg-[#00B4D8]' : 'bg-gray-700'" x-on:click="slide = i"></button></template></div>
          <button class="rounded px-3 py-1.5 text-sm text-gray-300 disabled:opacity-30" x-bind:disabled="slide === slides.length - 1" x-on:click="slide = Math.min(slides.length - 1, slide + 1)">Next</button>
        </div>
        <div data-qbr-deck-print class="hidden">
          <template x-for="(_, i) in slides" :key="i"><div class="slide">Open the interactive extension and use browser print for the current deck.</div></template>
        </div>
      </section>
    </div>`,
  );
}

function csQbrExtension(): string {
  return baseExtension(
    "CS QBR Deck Builder",
    `<script>
      function csQbrDeckBuilder() {
        return {
          owners: [],
          selected: '',
          loadingOwners: false,
          loadingBook: false,
          saving: false,
          error: '',
          deckOpen: false,
          slide: 0,
          showExportMenu: false,
          logoUrl: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F1672146e7e56476c8dd86df8d630d5b7?format=webp&width=800&height=1200',
          slides: ['Cover','Q1 Lesson','Retention','Adoption','Expansion','Q2 Forecast','Asks','Thank You'],
          book: null,
          metrics: null,
          form: {
            q1LessonLearned: '',
            q2ChangeBecauseOfIt: '',
            atRiskAccounts: '',
            q2ChurnPrediction: '',
            predictedRetentionArr: '',
            laggardActionPlan: '',
            q2AdoptionGoal: '',
            predictedExpansionArr: '',
            keyExpansionOpportunities: '',
            ask1: '',
            ask2: '',
            ask3: '',
            extraAsks: []
          },
          ownerSql: "SELECT DISTINCT csm_owner_name FROM \`builder-3b0a2.dbt_staging.hubspot_companies\` WHERE csm_owner_name IS NOT NULL AND TRIM(csm_owner_name) != '' AND csm_owner_name NOT IN ('Aaron Bhawan','Andrew Rohman','Daphne Ghesquiere','Hannah Schutt','Justin Plemel','Kashi Elyassi','Natasha Mattesi','Taylor Nielsen','Unassigned') ORDER BY csm_owner_name",
          parse(row) {
            if (!row || row.data == null) return null;
            try {
              const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
              return parsed && parsed.value && parsed.value.csmName ? parsed.value : parsed;
            } catch (_) {
              return null;
            }
          },
          resetForm(name) {
            this.form = {
              csmName: name,
              q1LessonLearned: '',
              q2ChangeBecauseOfIt: '',
              atRiskAccounts: '',
              q2ChurnPrediction: '',
              predictedRetentionArr: '',
              laggardActionPlan: '',
              q2AdoptionGoal: '',
              predictedExpansionArr: '',
              keyExpansionOpportunities: '',
              ask1: '',
              ask2: '',
              ask3: '',
              extraAsks: []
            };
          },
          async init() {
            await this.loadOwners();
          },
          async loadOwners() {
            this.loadingOwners = true; this.error = '';
            try {
              const result = await appAction('bigquery', { sql: this.ownerSql });
              this.owners = (result.rows || []).map((row) => row.csm_owner_name).filter(Boolean);
            } catch (e) {
              const seeded = await extensionData.list('cs-qbr-notes', { scope: 'org' });
              this.owners = seeded.map((row) => row.id).filter(Boolean);
              this.error = this.owners.length ? '' : (e.message || String(e));
            } finally {
              this.loadingOwners = false;
            }
          },
          bookSql(name) {
            const csm = name.replace(/'/g, "''");
            return [
              "WITH accounts AS (",
              "  SELECT company_name, CAST(company_id AS STRING) AS company_id, COALESCE(root_org_id, '') AS root_org_id, COALESCE(SAFE_CAST(current_enterprise_arr AS FLOAT64), 0) AS arr, CAST(upcoming_renewal_date AS STRING) AS renewal_date, COALESCE(customer_stage, '') AS customer_stage, COALESCE(company_status, '') AS company_status, COALESCE(hs_csm_sentiment, '') AS sentiment, DATE_DIFF(CURRENT_DATE(), COALESCE(DATE(create_date), CURRENT_DATE()), DAY) AS account_age_days",
              "  FROM \`builder-3b0a2.dbt_staging.hubspot_companies\`",
              "  WHERE LOWER(TRIM(csm_owner_name)) = LOWER(TRIM('" + csm + "'))",
              "    AND account_profile = 'Enterprise Active Customer'",
              "    AND LOWER(COALESCE(customer_stage, '')) NOT IN ('churned', 'churn risk')",
              "), seat_latest AS (",
              "  SELECT root_org_id, contracted_user_seats, active_users_30d, ROUND(seat_utilization_30d * 100, 1) AS seat_util_pct",
              "  FROM \`builder-3b0a2.dbt_analytics.enterprise_seat_utilization\`",
              "  WHERE root_org_id IN (SELECT root_org_id FROM accounts WHERE root_org_id != '')",
              "  QUALIFY ROW_NUMBER() OVER (PARTITION BY root_org_id ORDER BY date DESC) = 1",
              "), credit_latest AS (",
              "  SELECT root_org_id, contracted_ai_credits, ai_credits_used_30d, ROUND(ai_credit_utilization_30d * 100, 1) AS credit_util_pct",
              "  FROM \`builder-3b0a2.dbt_analytics.enterprise_ai_credit_utilization\`",
              "  WHERE root_org_id IN (SELECT root_org_id FROM accounts WHERE root_org_id != '')",
              "  QUALIFY ROW_NUMBER() OVER (PARTITION BY root_org_id ORDER BY date DESC) = 1",
              "), pipeline AS (",
              "  SELECT CAST(company_id AS STRING) AS company_id, SUM(SAFE_CAST(amount AS FLOAT64)) AS open_pipeline_arr",
              "  FROM \`builder-3b0a2.dbt_mart.dim_hs_deals\`",
              "  WHERE CAST(company_id AS STRING) IN (SELECT company_id FROM accounts WHERE company_id IS NOT NULL)",
              "    AND (LOWER(pipeline_name) LIKE '%expansion%' OR LOWER(pipeline_name) LIKE '%renewal%')",
              "    AND COALESCE(is_closed_won, FALSE) = FALSE",
              "    AND LOWER(COALESCE(stage_name, '')) NOT LIKE '%lost%'",
              "    AND LOWER(COALESCE(stage_name, '')) NOT LIKE '%stall%'",
              "  GROUP BY company_id",
              ")",
              "SELECT a.*, COALESCE(s.active_users_30d, 0) AS active_users_30d, COALESCE(s.contracted_user_seats, 0) AS contracted_user_seats, COALESCE(s.seat_util_pct, 0) AS seat_util_pct, COALESCE(c.ai_credits_used_30d, 0) AS ai_credits_used_30d, COALESCE(c.contracted_ai_credits, 0) AS contracted_ai_credits, COALESCE(c.credit_util_pct, 0) AS credit_util_pct, COALESCE(p.open_pipeline_arr, 0) AS open_pipeline_arr",
              "FROM accounts a",
              "LEFT JOIN seat_latest s USING (root_org_id)",
              "LEFT JOIN credit_latest c USING (root_org_id)",
              "LEFT JOIN pipeline p USING (company_id)",
              "ORDER BY arr DESC"
            ].join("\\n");
          },
          async selectOwner(name) {
            this.selected = name;
            this.resetForm(name);
            this.deckOpen = false;
            this.slide = 0;
            await Promise.all([this.loadSaved(name), this.loadBook(name)]);
          },
          async loadSaved(name) {
            const row = await extensionData.get('cs-qbr-notes', name, { scope: 'org' });
            const data = this.parse(row);
            if (data) this.form = { ...this.form, ...data, csmName: name };
          },
          async loadBook(name) {
            this.loadingBook = true; this.error = '';
            try {
              this.book = await appAction('bigquery', { sql: this.bookSql(name) });
              this.computeMetrics();
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loadingBook = false;
            }
          },
          computeMetrics() {
            const rows = this.book?.rows || [];
            const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
            const q2RenewalArr = rows.filter((row) => row.renewal_date >= '2026-05-01' && row.renewal_date <= '2026-07-31').reduce((total, row) => total + Number(row.arr || 0), 0);
            const active = sum('active_users_30d');
            const seats = sum('contracted_user_seats');
            const creditsUsed = sum('ai_credits_used_30d');
            const credits = sum('contracted_ai_credits');
            this.metrics = {
              accountCount: rows.length,
              arr: sum('arr'),
              q2RenewalArr,
              bookSeatUtil: seats ? (active / seats) * 100 : 0,
              bookCreditUtil: credits ? (creditsUsed / credits) * 100 : 0,
              openPipelineArr: sum('open_pipeline_arr')
            };
          },
          money(value) {
            return '$' + Math.round(Number(value || 0)).toLocaleString();
          },
          pct(value) {
            return Math.round(Number(value || 0)) + '%';
          },
          rows() {
            return this.book?.rows || [];
          },
          topAccounts(limit = 6) {
            return this.rows().slice(0, limit);
          },
          renewalAccounts() {
            return this.rows().filter((row) => row.renewal_date >= '2026-05-01' && row.renewal_date <= '2026-07-31').slice(0, 6);
          },
          adoptionAccounts() {
            return this.rows().slice(0, 18).map((row) => {
              const seat = Number(row.seat_util_pct || 0);
              const credit = Number(row.credit_util_pct || 0);
              return { name: row.company_name, pct: Math.max(seat, credit), seat, credit };
            });
          },
          expansionPipeline() {
            return this.rows().filter((row) => Number(row.open_pipeline_arr || 0) > 0).slice(0, 8);
          },
          retentionAchievement() {
            const raw = Number(String(this.form.predictedRetentionArr || '').replace(/[^0-9.]/g, ''));
            const due = Number(this.metrics?.q2RenewalArr || 0);
            return due ? Math.round((raw / due) * 100) : 0;
          },
          expansionAchievement() {
            const raw = Number(String(this.form.predictedExpansionArr || '').replace(/[^0-9.]/g, ''));
            const pipeline = Number(this.metrics?.openPipelineArr || 0);
            return pipeline ? Math.round((raw / pipeline) * 100) : 0;
          },
          achievementColor(value) {
            const pct = Number(value || 0);
            if (pct >= 100) return '#4ade80';
            if (pct >= 75) return '#facc15';
            return '#f87171';
          },
          askList() {
            return [this.form.ask1, this.form.ask2, this.form.ask3];
          },
          printDeck() {
            this.showExportMenu = false;
            window.print();
          },
          downloadHtml() {
            this.showExportMenu = false;
            const deck = document.querySelector('[data-cs-qbr-deck-print]');
            if (!deck) return;
            const title = 'CS_QBR_' + (this.selected || 'CSM').replace(/[^a-z0-9]+/gi, '_') + '.html';
            const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><script src="https://cdn.tailwindcss.com"><\\/script><style>body{margin:0;background:#050505;color:white;font-family:Arial,sans-serif}.slide{width:1280px;height:720px;page-break-after:always;overflow:hidden}.slide:last-child{page-break-after:auto}@media print{@page{size:1280px 720px;margin:0}body{background:#050505}}</style></head><body>' + deck.innerHTML + '</body></html>';
            const blob = new Blob([html], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = title;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
          async save() {
            if (!this.selected) return;
            this.saving = true;
            await extensionData.set('cs-qbr-notes', this.selected, { ...this.form, csmName: this.selected, savedAt: new Date().toISOString() }, { scope: 'org' });
            this.saving = false;
          },
          addAsk() {
            this.form.extraAsks.push('');
          }
        };
      }
    </script>
    <div x-data="csQbrDeckBuilder()" x-init="init()" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <select class="min-w-64 rounded border px-3 py-2" x-bind:disabled="loadingOwners" x-on:change="selectOwner($event.target.value)">
          <option value="">Select CSM</option>
          <template x-for="name in owners" :key="name"><option x-text="name" x-bind:value="name"></option></template>
        </select>
        <button class="rounded border px-3 py-2" x-bind:disabled="!selected || loadingBook" x-on:click="loadBook(selected)">Refresh book</button>
        <button class="rounded border px-3 py-2" x-bind:disabled="!selected || saving" x-on:click="save()" x-text="saving ? 'Saving...' : 'Save notes'"></button>
        <button class="rounded bg-primary px-3 py-2 text-primary-foreground" x-bind:disabled="!selected" x-on:click="slide = 0; deckOpen = true">View Deck</button>
      </div>
      <p x-show="loadingOwners || loadingBook" class="text-muted-foreground" x-text="loadingOwners ? 'Loading CSMs...' : 'Loading book data...'"></p>
      <p x-show="error" x-text="error" class="text-red-600"></p>
      <template x-if="selected && metrics">
        <div class="grid gap-2 md:grid-cols-4">
          <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Book ARR</p><p class="text-lg font-semibold" x-text="money(metrics.arr)"></p></div>
          <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Q2 Renewals</p><p class="text-lg font-semibold" x-text="money(metrics.q2RenewalArr)"></p></div>
          <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Seat Utilization</p><p class="text-lg font-semibold" x-text="pct(metrics.bookSeatUtil)"></p></div>
          <div class="rounded border p-3"><p class="text-xs text-muted-foreground">Open Pipeline</p><p class="text-lg font-semibold" x-text="money(metrics.openPipelineArr)"></p></div>
        </div>
      </template>
      <div x-show="selected && !deckOpen" class="grid gap-3 md:grid-cols-2">
        <textarea x-model="form.q1LessonLearned" class="h-24 rounded border p-3" placeholder="Q1 lesson learned"></textarea>
        <textarea x-model="form.q2ChangeBecauseOfIt" class="h-24 rounded border p-3" placeholder="Q2 change because of it"></textarea>
        <textarea x-model="form.atRiskAccounts" class="h-24 rounded border p-3" placeholder="At-risk accounts"></textarea>
        <textarea x-model="form.q2ChurnPrediction" class="h-24 rounded border p-3" placeholder="Q2 churn prediction"></textarea>
        <textarea x-model="form.laggardActionPlan" class="h-24 rounded border p-3" placeholder="Laggard adoption action plan"></textarea>
        <textarea x-model="form.keyExpansionOpportunities" class="h-24 rounded border p-3" placeholder="Expansion action plan"></textarea>
        <input x-model="form.predictedRetentionArr" class="rounded border px-3 py-2" placeholder="Predicted retained ARR" />
        <input x-model="form.predictedExpansionArr" class="rounded border px-3 py-2" placeholder="Predicted expansion ARR" />
        <input x-model="form.ask1" class="rounded border px-3 py-2" placeholder="Ask 1" />
        <input x-model="form.ask2" class="rounded border px-3 py-2" placeholder="Ask 2" />
        <input x-model="form.ask3" class="rounded border px-3 py-2" placeholder="Ask 3" />
      </div>
      <section x-show="deckOpen" class="fixed inset-0 z-50 flex flex-col bg-black text-white">
        <div class="flex shrink-0 items-center justify-between border-b border-gray-800 bg-[#0a0a0a] px-4 py-2">
          <button class="rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-900 hover:text-white" x-on:click="deckOpen = false">Exit</button>
          <div class="flex max-w-[55%] gap-1 overflow-x-auto">
            <template x-for="(label, i) in slides" :key="label"><button class="whitespace-nowrap rounded px-2 py-1 text-xs" x-bind:class="slide === i ? 'bg-[#00B4D8] font-bold text-black' : 'text-gray-500 hover:text-gray-300'" x-on:click="slide = i"><span x-text="(i + 1) + '. ' + label"></span></button></template>
          </div>
          <div class="flex items-center gap-3">
            <div class="relative">
              <button class="rounded border border-gray-700 bg-[#1a1a1a] px-3 py-1.5 text-sm text-gray-300 hover:text-white" x-on:click="showExportMenu = !showExportMenu">Export</button>
              <div x-show="showExportMenu" class="absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-xl border border-gray-700 bg-[#1a1a1a] shadow-2xl">
                <button class="block w-full px-4 py-3 text-left text-sm text-gray-300 hover:bg-[#2a2a2a] hover:text-white" x-on:click="printDeck()"><span class="font-semibold">Save as PDF</span><span class="block text-xs text-gray-500">Browser print, landscape</span></button>
                <button class="block w-full border-t border-gray-800 px-4 py-3 text-left text-sm text-gray-300 hover:bg-[#2a2a2a] hover:text-white" x-on:click="downloadHtml()"><span class="font-semibold">Download deck HTML</span><span class="block text-xs text-gray-500">Open/import as needed</span></button>
              </div>
            </div>
            <span class="text-sm text-gray-500" x-text="(slide + 1) + ' / ' + slides.length"></span>
          </div>
        </div>
        <div class="flex flex-1 items-center justify-center bg-[#050505] p-4">
          <div class="relative w-full max-w-[calc((100vh-80px)*16/9)]" style="aspect-ratio:16/9">
            <div class="absolute inset-0 overflow-hidden rounded-sm shadow-2xl">
              <div class="slide relative h-full w-full overflow-hidden bg-black" x-show="slide === 0">
                <div class="absolute right-0 top-0 h-full w-2/3 opacity-10" style="background:linear-gradient(135deg, transparent 40%, #0d3060 100%)"></div>
                <div class="absolute right-[-5%] top-[10%] h-[80%] w-[45%] skew-x-[-5deg] bg-gradient-to-br from-[#0d2040] to-[#1a3a60] opacity-20"></div>
                <div class="absolute left-[5%] top-[6%] flex items-center gap-2"><img x-bind:src="logoUrl" class="h-9 w-9 object-contain" alt="Builder.io" /><span class="text-lg font-bold tracking-wide">builder.io</span></div>
                <div class="relative z-10 flex h-full flex-col justify-center px-[5%]"><p class="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-[#00B4D8]">Customer Success</p><h1 class="text-6xl font-black leading-none tracking-tight">Quarterly Business Review</h1><p class="mt-4 text-xl font-semibold text-gray-300" x-text="selected || 'Select CSM'"></p><p class="mt-1 text-base text-gray-500">Q2 FY27 (May-Jul 2026)</p></div>
              </div>
              <div class="slide flex h-full w-full flex-col overflow-hidden bg-[#0a0a0a] px-[8%] py-[7%]" x-show="slide === 1">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><p class="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-[#00B4D8]">01 - Q1 Lookback</p><h2 class="mb-8 text-4xl font-black">Key Lesson from Q1</h2>
                <div class="flex flex-1 gap-6"><div class="flex flex-1 flex-col rounded-xl border border-[#1e1e2e] bg-[#111] p-6"><p class="mb-4 text-xs font-bold uppercase tracking-wider text-yellow-400">Biggest Lesson</p><p class="flex-1 text-lg leading-relaxed text-gray-200" x-text="form.q1LessonLearned || 'Not yet filled in...'"></p></div><div class="flex flex-1 flex-col rounded-xl border border-[#1a3a1a] bg-[#0d1a0d] p-6"><p class="mb-4 text-xs font-bold uppercase tracking-wider text-green-400">What is Different in Q2</p><p class="flex-1 text-lg leading-relaxed text-gray-200" x-text="form.q2ChangeBecauseOfIt || 'Not yet filled in...'"></p></div></div>
              </div>
              <div class="slide flex h-full w-full flex-col overflow-hidden bg-[#0a0a0a] px-[6%] py-[5%]" x-show="slide === 2">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><p class="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-[#00B4D8]">02 - Retention</p><div class="mb-4 flex items-end justify-between"><h2 class="text-3xl font-black">Retention Health</h2><div class="text-right"><p class="text-xs text-gray-500">Q2 Renewals</p><p class="text-2xl font-black" x-text="money(metrics?.q2RenewalArr || 0)"></p></div></div>
                <div class="flex flex-1 gap-4"><div class="flex flex-1 flex-col rounded-lg border border-[#1a2a40] bg-[#0d1520] p-4"><p class="mb-3 text-xs font-bold uppercase tracking-wider text-blue-400">Up for Renewal This Quarter</p><template x-if="!renewalAccounts().length"><p class="text-sm italic text-gray-600">None this quarter</p></template><div class="flex flex-col gap-1.5 overflow-hidden"><template x-for="acct in renewalAccounts()" :key="acct.company_id"><div class="flex justify-between text-sm"><span class="truncate text-gray-300" x-text="acct.company_name"></span><span class="shrink-0 font-semibold" x-text="money(acct.arr)"></span></div></template></div></div><div class="flex flex-1 flex-col rounded-lg border border-[#3a1a1a] bg-[#1a0d0d] p-4"><p class="mb-2 text-xs font-bold uppercase tracking-wider text-red-400">Retention Plan</p><p class="text-sm leading-relaxed text-gray-300" x-text="form.atRiskAccounts || form.q2ChurnPrediction || 'Not yet filled in...'"></p></div></div><p class="mt-3 text-xs text-gray-600">Team target: <=12% churn - 40% of variable comp - excludes Shopify ARR</p>
              </div>
              <div class="slide flex h-full w-full flex-col overflow-hidden bg-[#0a0a0a] px-[6%] py-[5%]" x-show="slide === 3">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><p class="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-[#00B4D8]">03 - Product Adoption</p><div class="mb-4 flex items-end justify-between"><h2 class="text-3xl font-black">Adoption Health</h2><div class="text-right"><p class="text-xs text-gray-500">Book Utilization</p><p class="text-2xl font-black" x-text="pct(metrics?.bookSeatUtil || 0)"></p></div></div>
                <div class="flex flex-1 gap-4"><div class="flex flex-1 flex-col rounded-lg border border-[#1a2a40] bg-[#0d1520] p-4"><p class="mb-3 text-xs font-bold uppercase tracking-wider text-blue-400">Utilization by Account</p><div class="relative flex flex-1 items-end gap-px"><div class="absolute left-0 right-0 z-10 border-t border-dashed border-gray-600" style="bottom:50%"></div><template x-for="acct in adoptionAccounts()" :key="acct.name"><div class="flex h-full flex-1 flex-col justify-end"><div class="w-full rounded-t-sm" x-bind:style="'height:' + Math.max(2, Math.min(100, acct.pct)) + '%; background:' + (acct.pct >= 50 ? '#4ade80' : acct.pct >= 30 ? '#facc15' : '#f87171')"></div></div></template></div></div><div class="flex flex-1 flex-col rounded-lg border border-[#1a3a1a] bg-[#0d1a0d] p-4"><p class="mb-2 text-xs font-bold uppercase tracking-wider text-green-400">Laggard Action Plan</p><p class="text-sm leading-relaxed text-gray-300" x-text="form.laggardActionPlan || 'Not yet filled in...'"></p></div></div><p class="mt-3 text-xs text-gray-600">Goal: >=50% contracted seat/credit utilization - 30% of variable comp</p>
              </div>
              <div class="slide flex h-full w-full flex-col overflow-hidden bg-[#0a0a0a] px-[6%] py-[5%]" x-show="slide === 4">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><p class="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-[#00B4D8]">04 - Expansion</p><div class="mb-3 flex items-end justify-between"><h2 class="text-3xl font-black">Expansion Performance</h2><div class="rounded-lg border px-4 py-2 text-sm font-bold" x-bind:style="'background:' + achievementColor(expansionAchievement()) + '18; border-color:' + achievementColor(expansionAchievement()) + '44; color:' + achievementColor(expansionAchievement())"><span x-text="expansionAchievement() + '% target achievement'"></span></div></div>
                <div class="mb-4"><div class="mb-1 flex justify-between text-sm"><span class="text-gray-400">Predicted Expansion</span><span class="text-gray-400"><strong class="text-white" x-text="form.predictedExpansionArr || money(metrics?.openPipelineArr || 0)"></strong></span></div><div class="h-2 w-full overflow-hidden rounded-full bg-gray-800"><div class="h-full rounded-full" x-bind:style="'width:' + Math.min(100, expansionAchievement()) + '%; background:' + achievementColor(expansionAchievement())"></div></div></div>
                <div class="flex flex-1 gap-4"><div class="flex flex-1 flex-col rounded-lg border border-[#1a2a40] bg-[#0d1520] p-4"><p class="mb-3 text-xs font-bold uppercase tracking-wider text-yellow-400">Open Pipeline</p><template x-if="!expansionPipeline().length"><p class="text-sm italic text-gray-600">No open pipeline</p></template><template x-for="acct in expansionPipeline()" :key="acct.company_id"><div class="flex justify-between text-sm"><span class="truncate text-gray-400" x-text="acct.company_name"></span><span class="shrink-0 font-bold text-yellow-400" x-text="money(acct.open_pipeline_arr)"></span></div></template></div><div class="flex flex-1 flex-col rounded-lg border border-[#1a3a1a] bg-[#0d1a0d] p-4"><p class="mb-2 text-xs font-bold uppercase tracking-wider text-green-400">Expansion Action Plan</p><p class="text-sm leading-relaxed text-gray-300" x-text="form.keyExpansionOpportunities || 'Not yet filled in...'"></p></div></div><p class="mt-3 text-xs text-gray-600">30% of variable comp - includes uplift ARR</p>
              </div>
              <div class="slide flex h-full w-full flex-col overflow-hidden bg-[#0a0a0a] px-[6%] py-[5%]" x-show="slide === 5">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><p class="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-[#00B4D8]">05 - Q2 Forecast</p><h2 class="mb-5 text-3xl font-black">Q2 Predictions</h2>
                <div class="flex flex-1 gap-4"><template x-for="card in [{i:'Retention',w:'40%',t:'Retention',l:'Predicted Retention',v:form.predictedRetentionArr || money(metrics?.q2RenewalArr || 0),a:retentionAchievement(),c:'#60a5fa'},{i:'Adoption',w:'30%',t:'Adoption',l:'Predicted Utilization',v:pct(metrics?.bookSeatUtil || 0),a:Math.round(metrics?.bookSeatUtil || 0),c:'#4ade80'},{i:'Expansion',w:'30%',t:'Expansion',l:'Predicted Expansion',v:form.predictedExpansionArr || money(metrics?.openPipelineArr || 0),a:expansionAchievement(),c:'#f59e0b'}]" :key="card.i"><div class="flex flex-1 flex-col rounded-xl border-t-4 bg-[#111] p-6" x-bind:style="'border-color:' + card.c"><p class="mb-1 text-xs font-bold uppercase tracking-wider" x-bind:style="'color:' + card.c" x-text="card.i + ' - ' + card.w + ' of variable'"></p><h3 class="text-2xl font-black" x-text="card.t"></h3><div class="flex flex-1 flex-col items-center justify-center text-center"><p class="mb-2 text-xs uppercase tracking-widest text-gray-500" x-text="card.l"></p><p class="mb-4 text-4xl font-black" x-bind:style="'color:' + card.c" x-text="card.v"></p><p class="rounded-lg border px-3 py-1.5 text-xs font-bold" x-bind:style="'background:' + achievementColor(card.a) + '18; border-color:' + achievementColor(card.a) + '44; color:' + achievementColor(card.a)" x-text="card.a + '% target achievement'"></p></div></div></template></div>
              </div>
              <div class="slide flex h-full w-full flex-col overflow-hidden bg-[#0a0a0a] px-[8%] py-[7%]" x-show="slide === 6">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-9 w-9" alt="" /><p class="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-[#00B4D8]">06 - Asks</p><h2 class="mb-8 text-4xl font-black">Asks of the Business</h2><div class="flex flex-1 flex-col justify-center gap-5"><template x-for="(ask, i) in askList()" :key="i"><div class="flex items-start gap-5 rounded-xl border border-[#1e1e2e] bg-[#111] px-6 py-5"><div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00B4D8] text-lg font-black text-black" x-text="i + 1"></div><p class="flex-1 pt-1 text-lg leading-relaxed text-gray-200" x-text="ask || ('Ask #' + (i + 1) + ' not yet filled in...')"></p></div></template></div>
              </div>
              <div class="slide flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#050a1a] to-[#0a0a2e]" x-show="slide === 7">
                <img x-bind:src="logoUrl" class="absolute right-[4%] top-[5%] h-10 w-10" alt="" /><div class="flex flex-col items-start"><h1 class="text-7xl font-black">Thank you</h1><div class="mt-2 h-[5px] w-[55%] rounded-full bg-[#00B4D8]"></div><p class="mt-6 text-lg text-gray-500">Questions & discussion</p></div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center justify-center gap-6 border-t border-gray-800 bg-[#0a0a0a] py-2">
          <button class="rounded px-3 py-1.5 text-sm text-gray-300 disabled:opacity-30" x-bind:disabled="slide === 0" x-on:click="slide = Math.max(0, slide - 1)">Prev</button>
          <div class="flex gap-1"><template x-for="(_, i) in slides" :key="i"><button class="h-2 w-2 rounded-full" x-bind:class="slide === i ? 'bg-[#00B4D8]' : 'bg-gray-700'" x-on:click="slide = i"></button></template></div>
          <button class="rounded px-3 py-1.5 text-sm text-gray-300 disabled:opacity-30" x-bind:disabled="slide === slides.length - 1" x-on:click="slide = Math.min(slides.length - 1, slide + 1)">Next</button>
        </div>
        <div data-cs-qbr-deck-print class="hidden">
          <template x-for="(_, i) in slides" :key="i"><div class="slide">Open the interactive extension and use browser print for the current deck.</div></template>
        </div>
      </section>
    </div>`,
  );
}

function discoveryCoachExtension(): string {
  const rel = "client/pages/adhoc/discovery-coach/index.tsx";
  const opPains = extractConstArrayLiteral(rel, "opPains");
  const painMap = extractConstArrayLiteral(rel, "painMap");
  const wonSignals = extractConstArrayLiteral(rel, "wonSignals");
  const lostSignals = extractConstArrayLiteral(rel, "lostSignals");
  const stages = extractConstArrayLiteral(rel, "stages");
  return baseExtension(
    "Discovery Coach",
    `<script>
      function discoveryCoach() {
        return {
          tab: 'discovery',
          selectedPain: null,
          opPains: ${opPains},
          painMap: ${painMap},
          wonSignals: ${wonSignals},
          lostSignals: ${lostSignals},
          stages: ${stages}
        };
      }
    </script>
    <div x-data="discoveryCoach()" class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <button class="rounded border px-3 py-1.5 text-xs" x-bind:class="tab === 'discovery' && 'bg-primary text-primary-foreground'" x-on:click="tab = 'discovery'">Discovery sequence</button>
        <button class="rounded border px-3 py-1.5 text-xs" x-bind:class="tab === 'painmap' && 'bg-primary text-primary-foreground'" x-on:click="tab = 'painmap'">Pain translation map</button>
        <button class="rounded border px-3 py-1.5 text-xs" x-bind:class="tab === 'signals' && 'bg-primary text-primary-foreground'" x-on:click="tab = 'signals'">Win/loss signals</button>
        <button class="rounded border px-3 py-1.5 text-xs" x-bind:class="tab === 'opains' && 'bg-primary text-primary-foreground'" x-on:click="tab = 'opains'">Operational pains</button>
      </div>
      <section x-show="tab === 'discovery'" class="space-y-3">
        <template x-for="stage in stages" :key="stage.num">
          <div class="rounded border p-3">
            <div class="flex gap-3"><span class="flex h-7 w-7 items-center justify-center rounded bg-muted text-xs font-semibold" x-text="stage.num"></span><div><h2 class="font-medium" x-text="stage.title"></h2><p class="text-xs text-muted-foreground" x-text="stage.sub"></p></div></div>
            <div class="mt-3 space-y-2 pl-10"><template x-for="item in stage.qs" :key="item.q"><div class="rounded bg-muted p-3 text-sm"><p x-text="'“' + item.q + '”'"></p><p class="mt-1 text-xs text-muted-foreground" x-text="item.signal"></p></div></template></div>
          </div>
        </template>
      </section>
      <section x-show="tab === 'painmap'" class="space-y-2">
        <template x-for="row in painMap" :key="row.op">
          <div class="grid gap-2 md:grid-cols-3">
            <div class="rounded border p-3 text-sm" x-text="row.op"></div>
            <div class="rounded border p-3 text-sm" x-text="row.biz"></div>
            <div class="rounded border p-3 text-sm font-medium" x-text="row.who"></div>
          </div>
        </template>
      </section>
      <section x-show="tab === 'signals'" class="grid gap-3 md:grid-cols-2">
        <div class="rounded border p-3"><h2 class="font-medium">Won deals</h2><ul class="mt-2 list-disc space-y-1 pl-5 text-sm"><template x-for="signal in wonSignals" :key="signal"><li x-text="signal"></li></template></ul></div>
        <div class="rounded border p-3"><h2 class="font-medium">Lost deals</h2><ul class="mt-2 list-disc space-y-1 pl-5 text-sm"><template x-for="signal in lostSignals" :key="signal"><li x-text="signal"></li></template></ul></div>
      </section>
      <section x-show="tab === 'opains'" class="space-y-3">
        <div class="grid gap-2 md:grid-cols-2">
          <template x-for="(pain, index) in opPains" :key="pain.title">
            <button class="rounded border p-3 text-left hover:bg-accent" x-on:click="selectedPain = selectedPain === index ? null : index">
              <p class="font-medium" x-text="pain.title"></p>
              <p class="text-xs text-muted-foreground" x-text="pain.count"></p>
            </button>
          </template>
        </div>
        <template x-if="selectedPain !== null">
          <div class="rounded border bg-muted p-4">
            <h2 class="font-medium" x-text="opPains[selectedPain].title"></h2>
            <div class="mt-3 space-y-2"><template x-for="item in opPains[selectedPain].questions" :key="item.q"><div class="rounded bg-background p-3 text-sm"><p x-text="'“' + item.q + '”'"></p><p class="mt-1 text-xs text-muted-foreground" x-text="'Listen for: ' + item.listen"></p></div></template></div>
          </div>
        </template>
      </section>
    </div>`,
  );
}

function gcnExtension(): string {
  return baseExtension(
    "GCN Conference Prep",
    `<div x-data="{ rows: [], selected: null, query: '', async init() { const speakers = await extensionData.get('legacy', 'speakers', { scope: 'org' }); const meetings = await extensionData.get('legacy', 'meetings', { scope: 'org' }); this.rows = [{ itemId: 'speakers', data: speakers }, { itemId: 'meetings', data: meetings }]; } }" x-init="init()" class="space-y-3">
      <input x-model="query" class="w-full rounded border px-3 py-2" placeholder="Filter rendered JSON text" />
      <template x-for="row in rows" :key="row.itemId">
        <button class="rounded border px-3 py-2 text-left" x-on:click="selected = row"><span class="font-medium" x-text="row.itemId"></span></button>
      </template>
      <pre x-show="selected" class="max-h-[560px] overflow-auto rounded border bg-muted p-3 text-xs" x-text="JSON.stringify(selected?.data?.value ?? selected?.data, null, 2)"></pre>
    </div>`,
  );
}

function engagementExtension(): string {
  return baseExtension(
    "User Engagement Planner",
    `<div x-data="{ company: '', prompt: '', async build() { this.prompt = 'Analyze user engagement and create an outreach strategy for ' + this.company + '. Use BigQuery, HubSpot, Gong, Slack, Pylon, and Apollo where available. Include active users, dormant users, power users, team segmentation, blockers, and recommended outreach.'; await extensionData.set('prompts', this.company || String(Date.now()), { company: this.company, prompt: this.prompt, createdAt: new Date().toISOString() }, { scope: 'org' }); } }" class="space-y-3">
      <input x-model="company" class="w-full rounded border px-3 py-2" placeholder="Company name or org ID" />
      <button class="rounded bg-primary px-3 py-2 text-primary-foreground" x-on:click="build()">Build analysis prompt</button>
      <textarea x-show="prompt" x-model="prompt" class="h-56 w-full rounded border p-3"></textarea>
    </div>`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function validateDashboardSql(
  dashboards: DashboardMigration[],
  orgId: string,
) {
  process.env.AGENT_USER_EMAIL = OWNER_EMAIL;
  process.env.AGENT_ORG_ID = orgId;
  const { runWithRequestContext } =
    await import("../../packages/core/src/server/request-context.ts");
  const { dryRunQuery } =
    await import("../../templates/analytics/server/lib/bigquery.ts");
  const { interpolate } =
    await import("../../templates/analytics/app/pages/adhoc/sql-dashboard/interpolate.ts");

  const errors: string[] = [];
  await runWithRequestContext({ userEmail: OWNER_EMAIL, orgId }, async () => {
    for (const dashboard of dashboards) {
      if (dashboard.kind === "explorer") continue;
      const vars = { dateStart: "2026-02-01", dateEnd: "2026-05-01" };
      const panels = Array.isArray((dashboard.config as DashboardConfig).panels)
        ? (dashboard.config as DashboardConfig).panels
        : [];
      for (const p of panels) {
        if (p.chartType === "section" || p.source !== "bigquery") continue;
        const sql = interpolate(p.sql, vars);
        const err = await dryRunQuery(sql).catch((e: any) => e.message);
        if (err) {
          errors.push(`${dashboard.id}/${p.id}: ${err}`);
          console.warn(`SQL validation failed: ${dashboard.id}/${p.id}`);
        }
      }
    }
  });

  if (errors.length > 0) {
    console.log(`SQL validation found ${errors.length} issue(s).`);
    for (const err of errors.slice(0, 20)) console.log(`- ${err}`);
    if (errors.length > 20) console.log(`... ${errors.length - 20} more`);
  } else {
    console.log("SQL validation passed for all generated BigQuery panels.");
  }
}

async function pruneRemovedLegacyResources(db: Db) {
  for (const id of REMOVED_LEGACY_IDS) {
    await db.execute(`DELETE FROM dashboard_shares WHERE resource_id = ?`, [
      id,
    ]);
    await db.execute(`DELETE FROM analysis_shares WHERE resource_id = ?`, [id]);
    await db.execute(`DELETE FROM tool_shares WHERE resource_id = ?`, [id]);
    await db.execute(`DELETE FROM tool_data WHERE tool_id = ?`, [id]);
    const deletedDash = await db.execute(
      `DELETE FROM dashboards WHERE id = ?`,
      [id],
    );
    const deletedAnalysis = await db.execute(
      `DELETE FROM analyses WHERE id = ?`,
      [id],
    );
    const deletedExtension = await db.execute(
      `DELETE FROM tools WHERE id = ?`,
      [id],
    );
    const removed =
      deletedDash.rowsAffected +
      deletedAnalysis.rowsAffected +
      deletedExtension.rowsAffected;
    if (removed > 0) {
      console.log(`Pruned removed Fusion resource ${id}.`);
    }
  }
}

async function upsertDashboard(
  db: Db,
  dashboard: DashboardMigration,
  orgId: string,
) {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO dashboards (id, kind, title, config, created_at, updated_at, owner_email, org_id, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'org')
     ON CONFLICT (id) DO UPDATE SET
       kind = EXCLUDED.kind,
       title = EXCLUDED.title,
       config = EXCLUDED.config,
       updated_at = EXCLUDED.updated_at,
       owner_email = EXCLUDED.owner_email,
       org_id = EXCLUDED.org_id,
       visibility = EXCLUDED.visibility`,
    [
      dashboard.id,
      dashboard.kind ?? "sql",
      dashboard.title,
      JSON.stringify(dashboard.config),
      now,
      now,
      OWNER_EMAIL,
      orgId,
    ],
  );
}

async function upsertAnalysis(
  db: Db,
  analysis: AnalysisMigration,
  orgId: string,
) {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO analyses (id, name, description, question, instructions, data_sources, result_markdown, result_data, author, created_at, updated_at, owner_email, org_id, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'org')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       question = EXCLUDED.question,
       instructions = EXCLUDED.instructions,
       data_sources = EXCLUDED.data_sources,
       result_markdown = EXCLUDED.result_markdown,
       result_data = EXCLUDED.result_data,
       author = EXCLUDED.author,
       updated_at = EXCLUDED.updated_at,
       owner_email = EXCLUDED.owner_email,
       org_id = EXCLUDED.org_id,
       visibility = EXCLUDED.visibility`,
    [
      analysis.id,
      analysis.name,
      analysis.description,
      analysis.question,
      analysis.instructions,
      JSON.stringify(analysis.dataSources),
      analysis.resultMarkdown,
      JSON.stringify(analysis.resultData ?? {}),
      analysis.author,
      now,
      now,
      OWNER_EMAIL,
      orgId,
    ],
  );
}

async function upsertExtension(
  db: Db,
  extension: ExtensionMigration,
  orgId: string,
) {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO tools (id, name, description, content, icon, created_at, updated_at, owner_email, org_id, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'org')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       content = EXCLUDED.content,
       icon = EXCLUDED.icon,
       updated_at = EXCLUDED.updated_at,
       owner_email = EXCLUDED.owner_email,
       org_id = EXCLUDED.org_id,
       visibility = EXCLUDED.visibility`,
    [
      extension.id,
      extension.name,
      extension.description,
      extension.content,
      extension.icon ?? null,
      now,
      now,
      OWNER_EMAIL,
      orgId,
    ],
  );

  for (const item of extension.data ?? []) {
    const rowId = `${extension.id}:${item.collection}:${item.itemId}`;
    await db.execute(
      `INSERT INTO tool_data (id, tool_id, collection, item_id, data, owner_email, scope, org_id, scope_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'org', ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         owner_email = EXCLUDED.owner_email,
         scope = EXCLUDED.scope,
         org_id = EXCLUDED.org_id,
         scope_key = EXCLUDED.scope_key,
         updated_at = EXCLUDED.updated_at`,
      [
        rowId,
        extension.id,
        item.collection,
        item.itemId,
        JSON.stringify(item.data),
        OWNER_EMAIL,
        orgId,
        `org:${orgId}`,
        now,
        now,
      ],
    );
  }
}

async function upsertExplorerSetting(
  db: Db,
  setting: ExplorerSettingMigration,
  orgId: string,
) {
  await db.execute(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = EXCLUDED.updated_at`,
    [
      orgSettingKey(orgId, setting.key),
      JSON.stringify(setting.value),
      Date.now(),
    ],
  );
}

async function printVerification(
  db: Db,
  orgId: string,
  planned: {
    dashboards: DashboardMigration[];
    analyses: AnalysisMigration[];
    extensions: ExtensionMigration[];
    explorerSettings: ExplorerSettingMigration[];
  },
) {
  const dash = await countMatching(
    db,
    "dashboards",
    planned.dashboards.map((d) => d.id),
    orgId,
  );
  const analyses = await countMatching(
    db,
    "analyses",
    planned.analyses.map((a) => a.id),
    orgId,
  );
  const extensions = await countMatching(
    db,
    "tools",
    planned.extensions.map((e) => e.id),
    orgId,
  );
  const explorerSettings = await countSettings(
    db,
    planned.explorerSettings.map((setting) =>
      orgSettingKey(orgId, setting.key),
    ),
  );
  const toolData = await db
    .execute(
      `SELECT COUNT(*) AS count FROM tool_data WHERE scope = 'org' AND org_id = ? AND tool_id = ANY(?)`,
      [orgId, planned.extensions.map((e) => e.id)],
    )
    .catch(async () => {
      const ids = planned.extensions.map((e) => e.id);
      if (ids.length === 0) return { rows: [{ count: 0 }], rowsAffected: 0 };
      const placeholders = ids.map(() => "?").join(",");
      return db.execute(
        `SELECT COUNT(*) AS count FROM tool_data WHERE scope = 'org' AND org_id = ? AND tool_id IN (${placeholders})`,
        [orgId, ...ids],
      );
    });
  console.log(
    `Verification: dashboards ${dash}/${planned.dashboards.length}, analyses ${analyses}/${planned.analyses.length}, extensions ${extensions}/${planned.extensions.length}, Explorer settings ${explorerSettings}/${planned.explorerSettings.length}, extension data rows ${toolData.rows[0]?.count ?? 0}.`,
  );
}

async function countMatching(
  db: Db,
  table: string,
  ids: string[],
  orgId: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const res = await db.execute(
    `SELECT COUNT(*) AS count FROM ${table} WHERE org_id = ? AND visibility = 'org' AND id IN (${placeholders})`,
    [orgId, ...ids],
  );
  return Number(res.rows[0]?.count ?? 0);
}

async function countSettings(db: Db, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const placeholders = keys.map(() => "?").join(",");
  const res = await db.execute(
    `SELECT COUNT(*) AS count FROM settings WHERE key IN (${placeholders})`,
    keys,
  );
  return Number(res.rows[0]?.count ?? 0);
}

async function ensureTables(db: Db) {
  const nowExpr = db.dialect === "postgres" ? "now()" : "datetime('now')";
  const intType = db.dialect === "postgres" ? "BIGINT" : "INTEGER";
  await db.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at ${intType} NOT NULL
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    icon TEXT,
    created_at TEXT NOT NULL DEFAULT (${nowExpr}),
    updated_at TEXT NOT NULL DEFAULT (${nowExpr}),
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS tool_data (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    item_id TEXT,
    data TEXT NOT NULL,
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    scope TEXT NOT NULL DEFAULT 'user',
    org_id TEXT,
    scope_key TEXT NOT NULL DEFAULT 'local@localhost',
    created_at TEXT NOT NULL DEFAULT (${nowExpr}),
    updated_at TEXT NOT NULL DEFAULT (${nowExpr})
  )`);
}

function orgSettingKey(orgId: string, key: string): string {
  return `o:${orgId}:${key}`;
}

async function resolveBuilderOrgId(db: Db): Promise<string> {
  const res = await db.execute(
    `SELECT id FROM organizations WHERE name = ? OR allowed_domain = ? ORDER BY name = ? DESC LIMIT 1`,
    [ORG_NAME, ORG_DOMAIN, ORG_NAME],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Builder.io org not found in analytics database");
  return String(id);
}

function loadAppEnv(app: string): AppEnv {
  const envPath = path.resolve("templates", app, ".env");
  if (!fs.existsSync(envPath)) throw new Error(`missing ${envPath}`);
  const parsed = parseEnv(fs.readFileSync(envPath, "utf8"));
  const appKey = app.toUpperCase().replace(/-/g, "_");
  const databaseUrl =
    parsed[`${appKey}_DATABASE_URL`]?.trim() || parsed.DATABASE_URL?.trim();
  if (!databaseUrl)
    throw new Error("DATABASE_URL is not set in analytics .env");
  const databaseAuthToken =
    parsed[`${appKey}_DATABASE_AUTH_TOKEN`]?.trim() ||
    parsed.DATABASE_AUTH_TOKEN?.trim();
  return { databaseUrl, databaseAuthToken: databaseAuthToken || undefined };
}

function parseEnv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if (
      (quote === `"` || quote === `'`) &&
      value.length >= 2 &&
      value[value.length - 1] === quote
    ) {
      value = value.slice(1, -1);
      if (quote === `"`) {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, `"`)
          .replace(/\\\\/g, "\\");
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result[key] = value;
  }
  return result;
}

async function importWorkspacePackage<T>(specifier: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch {
    const resolved = coreRequire.resolve(specifier);
    return (await import(pathToFileURL(resolved).href)) as T;
  }
}

async function connect(
  databaseUrl: string,
  databaseAuthToken: string | undefined,
): Promise<Db> {
  if (
    databaseUrl.startsWith("postgres://") ||
    databaseUrl.startsWith("postgresql://")
  ) {
    if (/\.neon\.tech([:/?]|$)/.test(databaseUrl)) {
      const { Pool } = await importWorkspacePackage<{
        Pool: new (opts: { connectionString: string }) => {
          query(
            sql: string,
            args: any[],
          ): Promise<{ rows: any[]; rowCount?: number | null }>;
          end(): Promise<void>;
        };
      }>("@neondatabase/serverless");
      const pool = new Pool({ connectionString: databaseUrl });
      return {
        dialect: "postgres",
        async execute(sql, args = []) {
          const result = await pool.query(toPostgresParams(sql), args as any[]);
          return { rows: result.rows, rowsAffected: result.rowCount ?? 0 };
        },
        close: () => pool.end(),
      };
    }
    const { default: postgres } = await importWorkspacePackage<{
      default: any;
    }>("postgres");
    const client = postgres(databaseUrl, {
      onnotice: () => {},
      idle_timeout: 240,
      max_lifetime: 60 * 30,
      connect_timeout: 10,
      ...(databaseUrl.includes("supabase") ? { prepare: false } : {}),
    });
    return {
      dialect: "postgres",
      async execute(sql, args = []) {
        const result = await client.unsafe(
          toPostgresParams(sql),
          args as any[],
        );
        return { rows: Array.from(result), rowsAffected: result.count ?? 0 };
      },
      close: () => client.end(),
    };
  }

  const { createClient } = await importWorkspacePackage<{ createClient: any }>(
    "@libsql/client",
  );
  const client = createClient({
    url: databaseUrl,
    authToken: databaseAuthToken,
  });
  return {
    dialect: "sqlite",
    async execute(sql, args = []) {
      const result = await client.execute({ sql, args: args as any[] });
      return { rows: result.rows as any[], rowsAffected: result.rowsAffected };
    },
    close: async () => {
      await (client as { close?: () => void }).close?.();
    },
  };
}

function toPostgresParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
