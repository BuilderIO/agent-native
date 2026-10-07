import { fail } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server/request-context";

import {
  FILTER_PARAM_PREFIX,
  resolveFilterVars,
} from "../../app/pages/adhoc/sql-dashboard/filter-vars";
import { interpolateDashboardPanelSql } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import { serializePanelSql } from "../../app/pages/adhoc/sql-dashboard/panel-sql";
import { timeRangeDays } from "../../app/pages/adhoc/sql-dashboard/pivot";
import type {
  DashboardFilter,
  SqlPanel,
} from "../../app/pages/adhoc/sql-dashboard/types";
import { normalizeDashboardConfig } from "../../shared/dashboard-config-normalization";
import {
  clipHead,
  duplicatePanelIdIssue,
  duplicatePanelIds,
  isNumericLikeValue,
  missingKeysFromColumns,
  planPanelRender,
  stableStringify,
  unknownPanelConfigKeys,
  type ConfigKeyIssue,
} from "../../shared/panel-render-contract";
import {
  MAX_CONCURRENT_FIRST_PARTY_SQL_QUERIES,
  MAX_CONCURRENT_SQL_QUERIES,
} from "../../shared/sql-query-limits";
import { dryRunQuerySchema, type DryRunQueryResult } from "./bigquery";
import { repairKnownFirstPartyDashboardQueries } from "./canonical-first-party-dashboard-repair";
import type { DashboardPanelSource } from "./dashboard-panel-query";
import {
  buildPanelQuery,
  describeError,
  runResolvedPanel,
} from "./dashboard-panel-runner";

export type PanelVerificationStatus =
  | "ok"
  | "empty"
  | "missing-columns"
  | "query-error"
  | "render-error"
  | "unverified";

export type PanelUnverifiedNote =
  | "timeout"
  | "missing_credential"
  | "skipped:program"
  | "too_expensive"
  | "not_executed:over_budget";

export interface PanelVerification {
  panelId: string;
  title: string;
  source: string;
  chartType: string;
  /**
   * `missing-columns` covers any configured key the rendered result drops:
   * absent from the columns, or ignored because config.pivot supplies the
   * series.
   */
  status: PanelVerificationStatus;
  /** Raw rows from the source; null when the panel was not executed. */
  rowCount: number | null;
  /** Rows the renderer plots (post-pivot); this is what "No data" tests. */
  renderedRowCount: number | null;
  /** At most MAX_COLUMNS_LISTED names; `columnCount` is the true total. */
  columns: string[];
  columnCount: number;
  missingKeys: string[];
  ignoredConfig: { key: string; reason: string }[];
  staticIssues: ConfigKeyIssue[];
  /** Only the variables whose {{token}} appears in the panel SQL. */
  resolvedFilters: Record<string, string>;
  resolvedSql: string;
  truncated?: boolean;
  error?: string;
  note?: PanelUnverifiedNote;
  hint?: string;
  sample?: Record<string, unknown>[];
  ms: number;
}

export interface DashboardVerification {
  /** Every requested panel is ok and has no static contract issue. */
  verified: boolean;
  /** Any panel is empty, missing columns, failed, or has a static issue. */
  blocking: boolean;
  filterState: "defaults" | "overridden";
  panels: PanelVerification[];
  budgetMs: number;
  ms: number;
}

export interface VerifyOptions {
  signal?: AbortSignal;
  /** Execution deadline shared by every panel in one call. */
  budgetMs?: number;
  /** Filter values keyed like the page URL (`timeRange`, or `f_timeRange`). */
  filters?: Record<string, string>;
  forceRefresh?: boolean;
  sampleRows?: number;
  /** Panels beyond this get static and dry-run checks only. */
  maxExecuted?: number;
  maxBytesToExecute?: number;
  /** BigQuery dry run before executing; the inspect action turns it off. */
  dryRun?: boolean;
  /** The config before this edit, so legacy stray config keys never block. */
  base?: Record<string, unknown> | null;
  /** Reuse results across a retried write inside one action call. */
  memo?: Map<string, PanelVerification>;
  /**
   * Panels whose config the server wrote, such as catalog panels. The agent
   * cannot edit that config, so the config-key rules skip them; the chart
   * type and id still come from the agent's request and stay checked.
   */
  serverAuthoredPanelIds?: ReadonlySet<string>;
}

export const PANEL_VERIFICATION_BUDGET_MS = 18_000;
const DEFAULT_MAX_EXECUTED = 6;
const DEFAULT_MAX_BYTES_TO_EXECUTE = 50 * 1024 ** 3;
const MAX_SAMPLE_ROWS = 20;
const MAX_COLUMNS_LISTED = 60;
const MAX_COLUMNS_IN_MESSAGE = 6;
const MAX_BLOCKERS_SHOWN = 4;
const MIN_DETAIL_CHARS = 40;
const SAMPLE_CELL_CHARS = 80;
const RESOLVED_SQL_CHARS = 2000;
const FAILURE_MESSAGE_CHARS = 1500;

const NOTE_REASONS: Record<PanelUnverifiedNote, string> = {
  timeout: "did not finish within the verification budget",
  missing_credential:
    "its data source is not connected (the viewer sees a connect prompt)",
  "skipped:program": "data-program panels are not run during verification",
  too_expensive:
    "the dry run is larger than the automatic-verification byte limit",
  "not_executed:over_budget":
    "more panels were affected than the per-save verification cap runs",
};

const AGENT_CALLERS: ReadonlySet<string> = new Set([
  "tool",
  "mcp",
  "a2a",
  "webmcp",
  "automation",
]);

/** Agent callers get the strict verified-write boundary; UI saves keep today's behavior. */
export function isAgentCaller(caller: string | undefined): boolean {
  return caller !== undefined && AGENT_CALLERS.has(caller);
}

/**
 * The config the dashboard page renders: the store's legacy-key promotion,
 * then the known first-party repairs get-sql-dashboard applies on every read.
 * Without a `dashboardId` no repair applies.
 */
export function pageDashboardConfig(
  config: Record<string, unknown>,
  dashboardId?: string,
): Record<string, unknown> {
  const normalized = normalizeDashboardConfig(config);
  return dashboardId
    ? repairKnownFirstPartyDashboardQueries(dashboardId, normalized).config
    : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function panelsOf(config: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(config.panels) ? config.panels.filter(isRecord) : [];
}

function hasSqlToRun(panel: Record<string, unknown>): boolean {
  return panel.chartType !== "section" && panel.chartType !== "extension";
}

/**
 * The variable state a fresh dashboard tab resolves: dashboard variables with
 * filter values on top, exactly as the page merges them.
 */
export function resolveVerificationVars(
  config: Record<string, unknown>,
  overrides?: Record<string, string>,
): Record<string, string> {
  const filters = Array.isArray(config.filters)
    ? (config.filters.filter(isRecord) as unknown as DashboardFilter[])
    : [];
  const variables = isRecord(config.variables)
    ? (config.variables as Record<string, string>)
    : {};
  return {
    ...variables,
    ...resolveFilterVars(
      filters,
      (key) => overrides?.[key] ?? overrides?.[FILTER_PARAM_PREFIX + key] ?? "",
    ),
  };
}

function resolvedSqlOf(
  panel: Record<string, unknown>,
  vars: Record<string, string>,
): string {
  return interpolateDashboardPanelSql(
    serializePanelSql(panel.sql),
    vars,
    panel,
  );
}

function renderFingerprint(panel: Record<string, unknown>): string {
  return stableStringify({
    sql: panel.sql,
    source: panel.source,
    chartType: panel.chartType,
    config: panel.config,
  });
}

/**
 * Panels an edit can change on screen. `direct` panels were added or had a
 * render-affecting field edited; `affected` panels are unchanged but resolve
 * to different SQL because a dashboard filter or variable changed. Titles,
 * widths and moves touch nothing.
 */
export function touchedPanelIds(
  rawBase: Record<string, unknown> | null | undefined,
  rawNext: Record<string, unknown>,
): { direct: string[]; affected: string[] } {
  const base = rawBase && normalizeDashboardConfig(rawBase);
  const next = normalizeDashboardConfig(rawNext);
  // Copies of one id pair up in order, so a change to any copy touches the id.
  const baseCopies = new Map<string, Record<string, unknown>[]>();
  for (const panel of base ? panelsOf(base) : []) {
    if (typeof panel.id !== "string") continue;
    baseCopies.set(panel.id, [...(baseCopies.get(panel.id) ?? []), panel]);
  }
  const baseVars = base ? resolveVerificationVars(base) : {};
  const nextVars = resolveVerificationVars(next);
  const seen = new Map<string, number>();
  const direct = new Set<string>();
  const affected = new Set<string>();
  for (const panel of panelsOf(next)) {
    if (typeof panel.id !== "string" || !hasSqlToRun(panel)) continue;
    const copy = seen.get(panel.id) ?? 0;
    seen.set(panel.id, copy + 1);
    const before = baseCopies.get(panel.id)?.[copy];
    if (!before || renderFingerprint(before) !== renderFingerprint(panel)) {
      direct.add(panel.id);
    } else if (
      resolvedSqlOf(before, baseVars) !== resolvedSqlOf(panel, nextVars)
    ) {
      affected.add(panel.id);
    }
  }
  return {
    direct: Array.from(direct),
    affected: Array.from(affected).filter((id) => !direct.has(id)),
  };
}

function sqlTokens(sql: unknown): string[] {
  const names = new Set<string>();
  for (const match of serializePanelSql(sql).matchAll(/\{\{[?/]?(\w+)\}\}/g)) {
    names.add(match[1]);
  }
  return Array.from(names);
}

function interpolationFailure(
  query: string,
  sql: unknown,
  vars: Record<string, string>,
): string | null {
  const trimmed = query.trim();
  if (trimmed === "SELECT __invalid_custom_date_range__") {
    return "the dashboard's custom date range is invalid for this panel (start or end missing, start after end, or longer than the panel supports)";
  }
  if (trimmed === "SELECT __unsupported_custom_date_range__") {
    return "this panel's SQL has no custom-date-range form, so it cannot run for a custom range";
  }
  if (query.includes("__missing_dashboard_time_filter__")) {
    const missing = sqlTokens(sql).filter(
      (name) => /^(timeRange|.*(Start|End))$/.test(name) && !vars[name],
    );
    return `SQL uses ${missing.map((name) => `{{${name}}}`).join(", ")} but the dashboard has no filter that provides it; add a timeRange select filter or a date-range filter with that id`;
  }
  return null;
}

function truncateCell(value: unknown): unknown {
  const text =
    typeof value === "string"
      ? value
      : value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : null;
  if (text === null) return value;
  return text.length > SAMPLE_CELL_CHARS
    ? `${clipHead(text, SAMPLE_CELL_CHARS)}…`
    : text;
}

function sampleOf(
  rows: Record<string, unknown>[],
  count: number,
): Record<string, unknown>[] {
  return rows
    .slice(0, Math.min(count, MAX_SAMPLE_ROWS))
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, truncateCell(value)]),
      ),
    );
}

function fixHint(
  panel: SqlPanel,
  columns: string[],
  firstRow: Record<string, unknown> | undefined,
  missingKeys: string[],
): string | undefined {
  if (missingKeys.length === 0) return undefined;
  const pivot = panel.config?.pivot;
  if (
    pivot &&
    missingKeys.some((key) =>
      [pivot.xKey, pivot.seriesKey, pivot.valueKey].includes(key),
    )
  ) {
    const numeric = columns.filter((col) =>
      isNumericLikeValue(firstRow?.[col]),
    );
    // The long-format yKey names the value column the wide result no longer has.
    const cleared = panel.config?.yKey
      ? "config.pivot and config.yKey (patch both to null)"
      : "config.pivot (patch it to null)";
    return `config.pivot expects long-format rows with columns ${[pivot.xKey, pivot.seriesKey, pivot.valueKey].join(", ")}, but the query returns wide-format columns. Remove ${cleared} and set config.yKeys to the numeric columns to plot${numeric.length > 0 ? ` [${numeric.slice(0, 6).join(", ")}${numeric.length > 6 ? ", ..." : ""}]` : ""}, or change the SQL back to long format.`;
  }
  return `Add ${missingKeys.join(", ")} to the SQL select list, or remove it from config (xKey, yKey, yKeys, rightYKeys, columns).`;
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

interface RunState {
  vars: Record<string, string>;
  opts: VerifyOptions;
  ctx: NonNullable<ReturnType<typeof getCredentialContext>>;
  deadline: number;
  baseById: Map<string, Record<string, unknown>>;
  duplicateIds: Set<string>;
  sampleRows: number;
  maxBytes: number;
}

function cancelled(): Error {
  return new Error("Dashboard panel verification was cancelled");
}

async function dryRunPanel(
  query: string,
  signal: AbortSignal,
  callerSignal: AbortSignal | undefined,
): Promise<DryRunQueryResult | null> {
  try {
    return await dryRunQuerySchema(query, { signal });
  } catch (error) {
    if (callerSignal?.aborted) throw cancelled();
    // coercion-ok: a dry run that could not run falls through to execution, whose result is the verdict.
    return null;
  }
}

async function verifyOne(
  panel: Record<string, unknown>,
  state: RunState,
  execute: boolean,
): Promise<PanelVerification> {
  const startedAt = Date.now();
  const { vars, opts } = state;
  const panelId = String(panel.id);
  const title = typeof panel.title === "string" ? panel.title : panelId;
  const source = typeof panel.source === "string" ? panel.source : "";
  const serverAuthored = opts.serverAuthoredPanelIds?.has(panelId) === true;
  const staticIssues = [
    ...unknownPanelConfigKeys(panel, state.baseById.get(panelId)).filter(
      (issue) => !serverAuthored || issue.kind === "unknown-chart-type",
    ),
    ...(state.duplicateIds.has(panelId) ? [duplicatePanelIdIssue(panel)] : []),
  ];
  const result = (
    fields: Partial<PanelVerification> & { status: PanelVerificationStatus },
  ): PanelVerification => {
    const columns = fields.columns ?? [];
    return {
      panelId,
      title,
      source,
      chartType: typeof panel.chartType === "string" ? panel.chartType : "",
      rowCount: null,
      renderedRowCount: null,
      columnCount: columns.length,
      missingKeys: [],
      ignoredConfig: [],
      staticIssues,
      resolvedFilters: Object.fromEntries(
        sqlTokens(panel.sql)
          .filter((name) => name in vars)
          .map((name) => [name, vars[name]]),
      ),
      resolvedSql: "",
      ms: Date.now() - startedAt,
      ...fields,
      // Every error leaves through the redaction and clip the executed path uses.
      ...(fields.error === undefined
        ? {}
        : { error: describeError(fields.error) }),
      columns: columns.slice(0, MAX_COLUMNS_LISTED),
    };
  };

  if (!hasSqlToRun(panel)) return result({ status: "ok" });

  let query: string;
  try {
    query = buildPanelQuery(panel as unknown as SqlPanel, vars);
  } catch (error) {
    return result({
      status: "query-error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const resolvedSql = clipHead(query, RESOLVED_SQL_CHARS);
  const sentinel = interpolationFailure(query, panel.sql, vars);
  if (sentinel) {
    return result({ status: "query-error", error: sentinel, resolvedSql });
  }
  if (source === "program") {
    return result({
      status: "unverified",
      note: "skipped:program",
      resolvedSql,
    });
  }

  const memoKey = stableStringify({
    source,
    query,
    chartType: panel.chartType,
    config: panel.config,
    staticIssues,
    execute,
    forceRefresh: opts.forceRefresh === true,
    sampleRows: state.sampleRows,
  });
  const memoized = opts.memo?.get(memoKey);
  if (memoized) return { ...memoized, panelId, title };

  const finish = (fields: Parameters<typeof result>[0]) => {
    const verification = result({ resolvedSql, ...fields });
    opts.memo?.set(memoKey, verification);
    return verification;
  };
  const rendered = panel as unknown as SqlPanel;
  const remainingMs = () => state.deadline - Date.now();
  const budgetSignal = () =>
    AbortSignal.any([
      ...(opts.signal ? [opts.signal] : []),
      AbortSignal.timeout(Math.max(1, remainingMs())),
    ]);

  const dryRun =
    source === "bigquery" && opts.dryRun !== false && remainingMs() > 0
      ? await dryRunPanel(query, budgetSignal(), opts.signal)
      : null;
  if (dryRun?.error && !dryRun.timedOut) {
    return finish({ status: "query-error", error: dryRun.error });
  }
  const dryRunColumns = dryRun?.schema?.map((field) => field.name) ?? [];
  const dryRunMissing = dryRunColumns.length
    ? missingKeysFromColumns(dryRunColumns, rendered)
    : [];
  if (dryRunMissing.length > 0) {
    return finish({
      status: "missing-columns",
      columns: dryRunColumns,
      columnCount: dryRunColumns.length,
      missingKeys: dryRunMissing,
      hint: fixHint(rendered, dryRunColumns, undefined, dryRunMissing),
    });
  }
  if (
    dryRun?.totalBytesProcessed !== undefined &&
    dryRun.totalBytesProcessed > state.maxBytes
  ) {
    return finish({ status: "unverified", note: "too_expensive" });
  }
  if (!execute) {
    return finish({ status: "unverified", note: "not_executed:over_budget" });
  }
  if (remainingMs() <= 0) {
    return finish({ status: "unverified", note: "timeout" });
  }

  const data = await runResolvedPanel({
    source: source as DashboardPanelSource,
    query,
    ctx: state.ctx,
    timeoutMs: remainingMs(),
    signal: budgetSignal(),
    forceRefresh: opts.forceRefresh,
  });
  if (opts.signal?.aborted) throw cancelled();
  if (data.status === "missing-credential") {
    return finish({
      status: "unverified",
      note: "missing_credential",
      error: data.message,
    });
  }
  if (data.status === "query-failed") {
    return data.timedOut
      ? finish({ status: "unverified", note: "timeout", error: data.message })
      : finish({ status: "query-error", error: data.message });
  }
  if (data.status !== "rows") {
    return finish({
      status: "unverified",
      error: `panel source returned an unsupported result (${data.status})`,
    });
  }

  let plan: ReturnType<typeof planPanelRender>;
  try {
    plan = planPanelRender(data.rows, rendered, {
      timeRange: timeRangeDays(vars.timeRange),
    });
  } catch (error) {
    // The renderer would crash on this config and result, so it is a verdict.
    return finish({
      status: "render-error",
      error: `the renderer cannot draw this result: ${error instanceof Error ? error.message : String(error)}`,
      rowCount: data.rows.length,
    });
  }
  const schemaColumns = data.schema.map((field) => field.name);
  const columns = data.rows.length > 0 ? plan.rawColumns : schemaColumns;
  // A zero-row result still carries its schema, so a config that cannot bind
  // is reported as such instead of passing as "legitimately empty".
  const missingKeys =
    data.rows.length > 0
      ? plan.missingKeys
      : schemaColumns.length > 0
        ? missingKeysFromColumns(schemaColumns, rendered)
        : [];
  const ignoredConfig = data.rows.length > 0 ? plan.ignoredConfig : [];
  const status: PanelVerificationStatus =
    missingKeys.length > 0 || ignoredConfig.length > 0
      ? "missing-columns"
      : data.rows.length === 0 || plan.empty
        ? "empty"
        : "ok";
  return finish({
    status,
    rowCount: data.rows.length,
    renderedRowCount: plan.renderedRowCount,
    columns,
    columnCount: columns.length,
    missingKeys,
    ignoredConfig,
    ...(data.truncated ? { truncated: true } : {}),
    ...(state.sampleRows > 0
      ? { sample: sampleOf(data.rows, state.sampleRows) }
      : {}),
    hint: fixHint(rendered, columns, data.rows[0], missingKeys),
  });
}

function blocksSave(
  panel: PanelVerification,
  allowEmptyResult: boolean,
): boolean {
  if (panel.staticIssues.length > 0) return true;
  if (panel.status === "empty") return !allowEmptyResult;
  return (
    panel.status === "missing-columns" ||
    panel.status === "query-error" ||
    panel.status === "render-error"
  );
}

/**
 * Runs each panel the way the dashboard page does (same variables, same SQL
 * interpolation, same source resolver and result cache) and applies the
 * renderer's own predicates to the rows. A timeout, missing credential or
 * skipped source is `unverified` with a note, never `ok`.
 */
export async function verifyDashboardPanels(
  rawConfig: Record<string, unknown>,
  panelIds: readonly string[],
  opts: VerifyOptions = {},
): Promise<DashboardVerification> {
  const config = normalizeDashboardConfig(rawConfig);
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs ?? PANEL_VERIFICATION_BUDGET_MS;
  const filterState =
    opts.filters && Object.keys(opts.filters).length > 0
      ? "overridden"
      : "defaults";
  if (panelIds.length === 0) {
    return {
      verified: true,
      blocking: false,
      filterState,
      panels: [],
      budgetMs,
      ms: 0,
    };
  }
  const ctx = getCredentialContext();
  if (!ctx) {
    throw new Error(
      "No authenticated context for dashboard panel verification.",
    );
  }

  // The first panel with an id is the one the edit API addresses.
  const firstById = (panels: Record<string, unknown>[]) => {
    const byId = new Map<string, Record<string, unknown>>();
    for (const panel of panels) {
      if (typeof panel.id === "string" && !byId.has(panel.id)) {
        byId.set(panel.id, panel);
      }
    }
    return byId;
  };
  const byId = firstById(panelsOf(config));
  const requested = Array.from(new Set(panelIds));
  const unknown = requested.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Cannot verify unknown panel id(s): ${unknown.join(", ")}.`,
    );
  }

  const state: RunState = {
    vars: resolveVerificationVars(config, opts.filters),
    opts,
    ctx,
    deadline: startedAt + budgetMs,
    baseById: firstById(
      opts.base ? panelsOf(normalizeDashboardConfig(opts.base)) : [],
    ),
    duplicateIds: duplicatePanelIds(panelsOf(config)),
    sampleRows: Math.max(0, Math.min(opts.sampleRows ?? 0, MAX_SAMPLE_ROWS)),
    maxBytes: opts.maxBytesToExecute ?? DEFAULT_MAX_BYTES_TO_EXECUTE,
  };
  const maxExecuted = opts.maxExecuted ?? DEFAULT_MAX_EXECUTED;
  let executing = 0;
  const jobs = requested.map((id) => {
    const panel = byId.get(id)!;
    const execute = panel.source === "program" || executing++ < maxExecuted;
    return { panel, execute };
  });

  const firstParty = jobs.filter((job) => job.panel.source === "first-party");
  const others = jobs.filter((job) => job.panel.source !== "first-party");
  const run = (job: (typeof jobs)[number]) =>
    verifyOne(job.panel, state, job.execute);
  const [firstPartyResults, otherResults] = await Promise.all([
    runPool(firstParty, MAX_CONCURRENT_FIRST_PARTY_SQL_QUERIES, run),
    runPool(others, MAX_CONCURRENT_SQL_QUERIES, run),
  ]);
  if (opts.signal?.aborted) throw cancelled();

  const resultById = new Map(
    [...firstPartyResults, ...otherResults].map((v) => [v.panelId, v]),
  );
  const panels = requested.map((id) => resultById.get(id)!);
  return {
    verified: panels.every(
      (panel) => panel.status === "ok" && panel.staticIssues.length === 0,
    ),
    blocking: panels.some((panel) => blocksSave(panel, false)),
    filterState,
    panels,
    budgetMs,
    ms: Date.now() - startedAt,
  };
}

/**
 * `nextStep` is the sentence telling the agent what to do. It stays separate
 * so a length clip shortens the detail around it, never the fix.
 */
function problemSegments(panel: PanelVerification): {
  detail: string[];
  nextStep?: string;
  columns?: string;
} {
  const filters = Object.entries(panel.resolvedFilters)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const detail: string[] = panel.staticIssues
    .slice(0, 2)
    .map((issue) => issue.message);
  if (panel.status === "query-error") {
    detail.push(`the query fails: ${panel.error}`);
  } else if (panel.status === "render-error") {
    detail.push(panel.error ?? "the renderer cannot draw this result");
  } else if (panel.status === "empty") {
    detail.push(
      panel.rowCount === 0
        ? `returns 0 rows with the dashboard's default filters${filters ? ` (${filters})` : ""}, so the viewer sees "No data"`
        : `returns ${panel.rowCount} row(s) but 0 render, so the viewer sees "No data"`,
    );
  } else if (panel.status === "missing-columns") {
    detail.push("renders without configured columns");
  }
  if (panel.missingKeys.length > 0) {
    detail.push(`config binds missing [${panel.missingKeys.join(", ")}]`);
  }
  for (const ignored of panel.ignoredConfig.slice(0, 2)) {
    detail.push(`config.${ignored.key} ignored: ${ignored.reason}`);
  }
  const nextStep =
    panel.hint?.replace(/\.$/, "") ??
    (panel.status === "empty" && panel.staticIssues.length === 0
      ? "If no rows is expected right now, retry with allowEmptyResult:true"
      : undefined);
  const columns =
    panel.columns.length > 0
      ? `result columns [${panel.columns.slice(0, MAX_COLUMNS_IN_MESSAGE).join(", ")}${panel.columns.length > MAX_COLUMNS_IN_MESSAGE ? ", ..." : ""}]`
      : undefined;
  return { detail, nextStep, columns };
}

function describeProblem(panel: PanelVerification): string {
  const { detail, nextStep, columns } = problemSegments(panel);
  return [...detail, nextStep, columns].filter(Boolean).join("; ");
}

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${clipHead(text, maxChars - 1)}…` : text;
}

const shortLine = (panel: PanelVerification) => `- panel "${panel.panelId}": `;

function describeBlocker(panel: PanelVerification, maxChars: number): string {
  const full = `- panel "${panel.panelId}" ("${clipHead(panel.title, 40)}") [${panel.source}]: ${describeProblem(panel)}.`;
  const { detail, nextStep } = problemSegments(panel);
  if (full.length <= maxChars || !nextStep) return clip(full, maxChars);
  // Over budget: drop the title and shorten the detail so the next step stays whole.
  const prefix = shortLine(panel);
  const room = maxChars - prefix.length - nextStep.length - 3;
  const shortDetail =
    room >= MIN_DETAIL_CHARS ? clip(detail.join("; "), room) : "";
  return clip(
    `${prefix}${[shortDetail, nextStep].filter(Boolean).join("; ")}.`,
    maxChars,
  );
}

/**
 * The runtime drops ActionContractError.details from the tool result, so the
 * message alone must name the panel, the reason, the columns and the next step.
 */
export function formatVerificationFailure(
  blockers: readonly PanelVerification[],
): string {
  const header = `Not saved: ${blockers.length === 1 ? "this panel" : `${blockers.length} panels`} would not render correctly with the dashboard's default filters, so the dashboard is unchanged.`;
  const footer =
    "Fix the panel and call again; dryRun:true previews the same check without saving.";
  const moreNote = (shown: number) =>
    blockers.length > shown
      ? `(+${blockers.length - shown} more panel(s) not shown)`
      : "";
  const budgetFor = (shown: number) =>
    Math.floor(
      (FAILURE_MESSAGE_CHARS -
        header.length -
        moreNote(shown).length -
        footer.length -
        8) /
        shown,
    );
  // Show fewer panels rather than clip a fix: every shown line keeps its next step whole.
  let count = Math.min(blockers.length, MAX_BLOCKERS_SHOWN);
  while (
    count > 1 &&
    blockers
      .slice(0, count)
      .some(
        (panel) =>
          shortLine(panel).length +
            (problemSegments(panel).nextStep?.length ?? 0) +
            1 >
          budgetFor(count),
      )
  ) {
    count--;
  }
  const shown = blockers.slice(0, count);
  const more = moreNote(count);
  const perPanelChars = budgetFor(count);
  return [
    header,
    ...shown.map((panel) => describeBlocker(panel, perPanelChars)),
    ...(more ? [more] : []),
    footer,
  ].join("\n");
}

export interface PanelWriteVerdict {
  verified: boolean;
  /** True when no panel the viewer renders differently was touched, so nothing needed to run. */
  noRenderAffected?: true;
  verification: DashboardVerification | null;
  proof: {
    panelId: string;
    title: string;
    status: PanelVerificationStatus;
    rowCount: number | null;
    columns: string[];
    missingKeys: string[];
  }[];
  unverified: {
    panelId: string;
    title: string;
    status: PanelVerificationStatus;
    note?: PanelUnverifiedNote;
    reason: string;
  }[];
  nextStep?: string;
}

/** One line saying what the viewer sees, or why that could not be checked. */
export function describePanelOutcome(panel: PanelVerification): string {
  if (panel.status === "ok" && panel.staticIssues.length === 0) {
    return `renders ${panel.renderedRowCount} row(s), columns [${panel.columns.slice(0, 12).join(", ")}]`;
  }
  if (panel.status === "unverified") {
    const why = panel.note ? NOTE_REASONS[panel.note] : "could not be checked";
    return panel.error ? `${why} (${clipHead(panel.error, 200)})` : why;
  }
  if (panel.status === "empty") {
    return panel.rowCount
      ? `returns ${panel.rowCount} row(s) but 0 render (its keys or labels give nothing to draw), so it shows "No data"`
      : 'returns no rows, so it shows "No data"';
  }
  if (panel.status === "query-error") {
    return `query failed: ${panel.error ? clipHead(panel.error, 200) : ""}`;
  }
  return clipHead(describeProblem(panel), 600);
}

export interface PanelWriteGateOptions {
  base: Record<string, unknown> | null;
  next: Record<string, unknown>;
  signal?: AbortSignal;
  /** `report` never throws; recovery paths such as a revision restore use it. */
  mode?: "block" | "report";
  /** Only for a panel the user expects to have no rows right now. */
  allowEmptyResult?: boolean;
  memo?: Map<string, PanelVerification>;
  /** Lets the gate apply the same known-dashboard repairs the page reads through. */
  dashboardId?: string;
  /** See VerifyOptions: render verification still runs on these panels. */
  serverAuthoredPanelIds?: ReadonlySet<string>;
}

/**
 * Pre-commit gate shared by every agent write path. Verifies the panels the
 * edit touched; in `block` mode a directly edited panel that would not render
 * throws (nothing is written). Everything else saves with `verified:false`.
 */
export async function verifyPanelWrite(
  options: PanelWriteGateOptions,
): Promise<PanelWriteVerdict> {
  const base = options.base
    ? pageDashboardConfig(options.base, options.dashboardId)
    : null;
  const next = pageDashboardConfig(options.next, options.dashboardId);
  const { direct, affected } = touchedPanelIds(base, next);
  if (direct.length + affected.length === 0) {
    return {
      verified: true,
      noRenderAffected: true,
      verification: null,
      proof: [],
      unverified: [],
    };
  }
  const verification = await verifyDashboardPanels(
    next,
    [...direct, ...affected],
    {
      signal: options.signal,
      base,
      memo: options.memo,
      serverAuthoredPanelIds: options.serverAuthoredPanelIds,
    },
  );
  const allowEmpty = options.allowEmptyResult === true;
  const directIds = new Set(direct);
  const blockers = verification.panels.filter(
    (panel) => directIds.has(panel.panelId) && blocksSave(panel, allowEmpty),
  );
  if (blockers.length > 0 && options.mode !== "report") {
    fail(formatVerificationFailure(blockers), {
      errorCode: "dashboard_panel_verification_failed",
      statusCode: 422,
      details: { verification },
    });
  }

  const attention = verification.panels.filter(
    (panel) => panel.status !== "ok" || panel.staticIssues.length > 0,
  );
  const verified = attention.length === 0;
  const notRun = attention.filter(
    (panel) => panel.note === "not_executed:over_budget",
  );
  const problems = attention.filter((panel) => !notRun.includes(panel));
  const idList = (panels: PanelVerification[]) =>
    `${panels
      .slice(0, 5)
      .map((panel) => panel.panelId)
      .join(", ")}${panels.length > 5 ? ` (+${panels.length - 5} more)` : ""}`;
  return {
    verified,
    verification,
    proof: verification.panels
      .filter((panel) => panel.rowCount !== null)
      .map((panel) => ({
        panelId: panel.panelId,
        title: panel.title,
        status: panel.status,
        rowCount: panel.rowCount,
        columns: panel.columns.slice(0, 12),
        missingKeys: panel.missingKeys,
      })),
    unverified: attention.map((panel) => ({
      panelId: panel.panelId,
      title: panel.title,
      status: panel.status,
      ...(panel.note ? { note: panel.note } : {}),
      reason: describePanelOutcome(panel),
    })),
    ...(verified
      ? {}
      : {
          nextStep: [
            ...(problems.length > 0
              ? [
                  `REQUIRED: call inspect-dashboard-panel for ${idList(problems)} and confirm the panel renders before telling the user the change is visible. Do not claim success; each unverified[].reason says why.`,
                ]
              : []),
            ...(notRun.length > 0
              ? [
                  `Not run: ${idList(notRun)} were beyond the per-save cap of ${DEFAULT_MAX_EXECUTED} executed panels, so only the verified panels are confirmed. Call inspect-dashboard-panel before claiming the others render.`,
                ]
              : []),
          ].join(" "),
        }),
  };
}

/** Result fields for a write; empty for callers that were not verified. */
export function verdictFields(
  verdict: PanelWriteVerdict | null,
): Record<string, unknown> {
  if (!verdict) return {};
  return {
    verified: verdict.verified,
    ...(verdict.noRenderAffected ? { noRenderAffected: true } : {}),
    ...(verdict.proof.length > 0 ? { verification: verdict.proof } : {}),
    ...(verdict.unverified.length > 0
      ? { unverified: verdict.unverified }
      : {}),
    ...(verdict.nextStep ? { nextStep: verdict.nextStep } : {}),
  };
}

export function annotateSummary(
  summary: string,
  verdict: PanelWriteVerdict | null,
  options: { saved?: boolean } = {},
): string {
  if (!verdict) return summary;
  if (verdict.noRenderAffected) {
    return `${summary} No panel render was affected, so there was nothing to verify.`;
  }
  if (verdict.verified) {
    const shown = verdict.proof.slice(0, 3).map((panel) => {
      const rows = panel.rowCount === null ? "" : ` -> ${panel.rowCount} rows`;
      return `${panel.title}${rows}, columns [${panel.columns.join(", ")}]`;
    });
    const more = verdict.proof.length - shown.length;
    return `${summary} Verified: ${shown.join("; ")}${more > 0 ? ` (+${more} more)` : ""}.`;
  }
  return `${options.saved === false ? "NOT VERIFIED" : "SAVED BUT NOT VERIFIED"}: ${summary} ${verdict.nextStep}`;
}
