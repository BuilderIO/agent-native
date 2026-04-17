import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

/**
 * Dashboards table — covers both Explorer and SQL dashboards. The
 * distinction lives in `kind` and the shape of the `config` JSON blob.
 * Previously stored in the settings KV store under
 * `u:<email>:dashboard-{id}` / `u:<email>:sql-dashboard-{id}` /
 * `o:<orgId>:sql-dashboard-{id}`. Those keys are read as a fallback
 * during lazy migration (see server/lib/dashboards-store.ts) and the
 * legacy rows can be removed once the team is sure everyone's migrated.
 */
export const dashboards = table("dashboards", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["explorer", "sql"] }).notNull(),
  title: text("title").notNull().default("Untitled"),
  /** Full dashboard config (SqlDashboardConfig or Explorer state) as JSON. */
  config: text("config").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const dashboardShares = createSharesTable("dashboard_shares");

/**
 * Saved filter views per dashboard. Lives alongside the parent and is
 * governed by the parent's sharing (no separate share rows).
 */
export const dashboardViews = table("dashboard_views", {
  id: text("id").primaryKey(),
  dashboardId: text("dashboard_id").notNull(),
  name: text("name").notNull(),
  /** Filter params as JSON (Record<string, string>). */
  filters: text("filters").notNull().default("{}"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(now()),
});

/**
 * Ad-hoc analyses. Previously stored in the settings KV store under
 * `adhoc-analysis-{id}`. Those keys are read as a fallback during lazy
 * migration. See server/lib/analyses-store.ts.
 */
export const analyses = table("analyses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Original user question that triggered the analysis. */
  question: text("question").notNull().default(""),
  /** Step-by-step re-run instructions. */
  instructions: text("instructions").notNull().default(""),
  /** Data sources referenced, as JSON array of strings. */
  dataSources: text("data_sources").notNull().default("[]"),
  /** Full findings in Markdown. */
  resultMarkdown: text("result_markdown").notNull().default(""),
  /** Optional structured result data, as JSON. */
  resultData: text("result_data"),
  author: text("author"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const analysisShares = createSharesTable("analysis_shares");

/**
 * BigQuery result cache (pre-existing — moved here from db plugin so a
 * single drizzle schema covers the template).
 */
export const bigqueryCache = table("bigquery_cache", {
  key: text("key").primaryKey(),
  sql: text("sql").notNull(),
  result: text("result").notNull(),
  bytesProcessed: integer("bytes_processed").notNull().default(0),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});
