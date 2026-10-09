import { defineAction, embedApp } from "@agent-native/core";
import { fail } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { MULTI_SELECT_EMPTY } from "../app/pages/adhoc/sql-dashboard/filter-vars";
import {
  interpolate,
  interpolateDashboardPanelSql,
} from "../app/pages/adhoc/sql-dashboard/interpolate";
import { dryRunQuery } from "../server/lib/bigquery";
import {
  dashboardNoopReceipt,
  dashboardWriteReceipt,
  requireEditableDashboard,
} from "../server/lib/dashboard-agent-write";
import { queueDashboardCollabSync } from "../server/lib/dashboard-collab-sync";
import { serializeProgramDescriptorInput } from "../server/lib/dashboard-panel-query";
import {
  annotateSummary,
  isAgentCaller,
  resolveVerificationVars,
  verdictFields,
  verifyPanelWrite,
  type PanelVerification,
  type PanelWriteVerdict,
} from "../server/lib/dashboard-panel-verification";
import { validateFirstPartyDashboardTimeScope } from "../server/lib/dashboard-time-scope";
import {
  getDashboard,
  upsertDashboardOutcome,
  upsertDashboardWithRetryOutcome,
  DashboardConflictError,
  type DashboardUpsertOutcome,
} from "../server/lib/dashboards-store";
import { parseDemoDescriptor } from "../server/lib/demo-source";
import { FirstPartyAnalyticsUnsupportedSqlError } from "../server/lib/first-party-analytics-backend.js";
import { validateFirstPartyAnalyticsSqlForScope } from "../server/lib/first-party-analytics.js";
import { normalizeDashboardConfig } from "../shared/dashboard-config-normalization";
import { DASHBOARD_SQL_VALIDATION_TIMEOUT_MS } from "../shared/dashboard-report-timeouts.js";
import { panelLabel, stableStringify } from "../shared/panel-render-contract";
import {
  applyPanelOrder,
  compactDashboardResult,
  type PanelOrderResult,
} from "./dashboard-panel-order";

function printable(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

type JsonOp = {
  op: "set" | "replace" | "remove" | "move" | "move-before" | "insert";
  path?: string;
  from?: string;
  value?: unknown;
};

const jsonOpSchema = z.object({
  op: z.enum(["set", "replace", "remove", "move", "move-before", "insert"]),
  path: z.string().optional(),
  from: z.string().optional(),
  value: z.unknown().optional(),
});

function parseJsonArrayString(value: string, fieldName: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err: any) {
    throw new Error(`${fieldName} must be a JSON array: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }
  return parsed;
}

const jsonOpsInputSchema = z
  .union([
    z.array(jsonOpSchema),
    z.string().transform((value) => parseJsonArrayString(value, "ops")),
  ])
  .optional();

const panelOrderInputSchema = z
  .union([
    z.array(z.string()),
    z
      .string()
      .transform((value) =>
        parseJsonArrayString(value, "panelOrder").map((item) => String(item)),
      ),
  ])
  .optional();

const configInputSchema = z
  .union([
    z.record(z.string(), z.unknown()),
    z.string().transform((value) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch (err: any) {
        throw new Error(`config must be a JSON object: ${err.message}`);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("config must be a JSON object");
      }
      return parsed as Record<string, unknown>;
    }),
  ])
  .optional();

function parsePointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`JSON path must start with '/' (got: ${pointer})`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function resolveParent(
  root: unknown,
  segments: string[],
): [any, string | number] {
  if (segments.length === 0) throw new Error("Root path is not supported");
  let node: any = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (Array.isArray(node)) {
      const idx = parseInt(seg, 10);
      if (isNaN(idx) || idx < 0 || idx >= node.length) {
        throw new Error(
          `Path segment "${seg}" out of bounds for array of length ${node.length}`,
        );
      }
      node = node[idx];
    } else if (node && typeof node === "object") {
      if (!(seg in node)) throw new Error(`Path segment "${seg}" not found`);
      node = node[seg];
    } else {
      throw new Error(`Cannot descend into ${typeof node} at "${seg}"`);
    }
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(node)) {
    const idx = last === "-" ? node.length : parseInt(last, 10);
    if (isNaN(idx)) throw new Error(`Expected numeric index, got "${last}"`);
    return [node, idx];
  }
  return [node, last];
}

function checkArrayIndex(
  parent: unknown[],
  key: number,
  path: string,
  mode: "access" | "insert",
): void {
  const max = mode === "insert" ? parent.length : parent.length - 1;
  if (!Number.isInteger(key) || key < 0 || key > max) {
    throw new Error(
      `Index ${key} out of bounds for array of length ${parent.length} at ${path}`,
    );
  }
}

function applyJsonOp(root: any, op: JsonOp): string {
  switch (op.op) {
    case "set":
    case "replace": {
      if (op.path === undefined) throw new Error(`${op.op} requires 'path'`);
      const [parent, key] = resolveParent(root, parsePointer(op.path));
      if (Array.isArray(parent))
        checkArrayIndex(parent, key as number, op.path, "access");
      parent[key as any] = op.value;
      return `${op.op} ${op.path}`;
    }
    case "remove": {
      if (op.path === undefined) throw new Error("remove requires 'path'");
      const [parent, key] = resolveParent(root, parsePointer(op.path));
      if (Array.isArray(parent)) {
        checkArrayIndex(parent, key as number, op.path, "access");
        parent.splice(key as number, 1);
      } else {
        delete parent[key as string];
      }
      return `remove ${op.path}`;
    }
    case "insert": {
      if (op.path === undefined) throw new Error("insert requires 'path'");
      const [parent, key] = resolveParent(root, parsePointer(op.path));
      if (!Array.isArray(parent))
        throw new Error("insert target must be array");
      checkArrayIndex(parent, key as number, op.path, "insert");
      parent.splice(key as number, 0, op.value);
      return `insert at ${op.path}`;
    }
    case "move":
    case "move-before": {
      if (!op.from || op.path === undefined) {
        throw new Error(`${op.op} requires 'from' and 'path'`);
      }
      const [fromParent, fromKey] = resolveParent(root, parsePointer(op.from));
      let value: unknown;
      if (Array.isArray(fromParent)) {
        checkArrayIndex(fromParent, fromKey as number, op.from, "access");
        value = fromParent[fromKey as number];
        fromParent.splice(fromKey as number, 1);
      } else {
        value = fromParent[fromKey as string];
        delete fromParent[fromKey as string];
      }
      const [toParent, toKey] = resolveParent(root, parsePointer(op.path));
      if (Array.isArray(toParent)) {
        checkArrayIndex(toParent, toKey as number, op.path, "insert");
        toParent.splice(toKey as number, 0, value);
      } else {
        toParent[toKey as string] = value;
      }
      return `${op.op} ${op.from} → ${op.path}`;
    }
    default:
      throw new Error(`Unknown JSON op: ${(op as any).op}`);
  }
}

export interface DashboardConfigIssue {
  rule: string;
  message: string;
}

export interface ValidateDashboardConfigOptions {
  /**
   * The config as stored before this edit. Only panels inserted or changed
   * against it are validated, so a legacy panel never blocks an unrelated edit.
   */
  baseline?: Record<string, unknown> | null;
}

function collectDashboardConfigIssues(
  config: Record<string, unknown>,
  options: ValidateDashboardConfigOptions,
): DashboardConfigIssue[] {
  const dashboardIssue = (message: string): DashboardConfigIssue[] => [
    { rule: "dashboard_config", message },
  ];
  if (!config || typeof config !== "object") {
    return dashboardIssue("config must be an object");
  }
  const normalized = normalizeDashboardConfig(config);
  if (normalized !== config) config.panels = normalized.panels;
  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    return dashboardIssue(
      "config.name is required (non-empty string) — without it the dashboard renders as a blank row in the sidebar",
    );
  }
  if (config.parentId !== undefined && config.parentId !== null) {
    if (
      typeof config.parentId !== "string" ||
      config.parentId.trim().length === 0
    ) {
      return dashboardIssue(
        "config.parentId must be a non-empty dashboard id (or omitted) — it nests this dashboard under that parent in the sidebar",
      );
    }
  }
  const filters = config.filters;
  if (filters !== undefined && !Array.isArray(filters)) {
    return dashboardIssue("config.filters must be an array");
  }
  if (Array.isArray(filters)) {
    const seen = new Set<string>();
    const deduped: unknown[] = [];
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i] as Record<string, unknown> | null;
      if (!f || typeof f !== "object") {
        return dashboardIssue(`config.filters[${i}] must be an object`);
      }
      const id = typeof f.id === "string" ? f.id.trim() : "";
      if (!id) return dashboardIssue(`config.filters[${i}].id is required`);
      if (f.type === "multi-select") {
        // The selection is comma-joined in the URL, so a value cannot be empty or contain ",". MULTI_SELECT_EMPTY is reserved for the cleared state.
        const options = Array.isArray(f.options)
          ? (f.options as Array<{ value?: unknown } | null>)
          : [];
        const badIndex = options.findIndex(
          (option) =>
            typeof option?.value === "string" &&
            (option.value === "" ||
              option.value.includes(",") ||
              option.value === MULTI_SELECT_EMPTY),
        );
        if (badIndex !== -1) {
          return dashboardIssue(
            `config.filters[${i}].options[${badIndex}].value must be non-empty, cannot contain ",", and cannot be "${MULTI_SELECT_EMPTY}" in a multi-select filter`,
          );
        }
        if (f.default === MULTI_SELECT_EMPTY) {
          return dashboardIssue(
            `config.filters[${i}].default cannot be "${MULTI_SELECT_EMPTY}" in a multi-select filter`,
          );
        }
      }
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push(f);
    }
    if (deduped.length !== filters.length) {
      (config as Record<string, unknown>).filters = deduped;
    }
  }
  const panels = config.panels;
  if (!Array.isArray(panels)) {
    return dashboardIssue(
      "config.panels must be an array (use [] for an empty dashboard)",
    );
  }
  // A baseline that is the config itself would mark every panel unchanged.
  const baseline =
    options.baseline && options.baseline !== config
      ? normalizeDashboardConfig(options.baseline)
      : null;
  const baselinePanels = new Map<string, string>();
  for (const panel of Array.isArray(baseline?.panels) ? baseline.panels : []) {
    if (panel && typeof panel.id === "string") {
      baselinePanels.set(panel.id, stableStringify(panel));
    }
  }
  const issues: DashboardConfigIssue[] = [];
  const validSources = new Set([
    "bigquery",
    "ga4",
    "amplitude",
    "first-party",
    "demo",
    "prometheus",
    "program",
  ]);
  const isValidColumnCount = (v: unknown): v is number =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= 1 &&
    v <= 6 &&
    Math.floor(v) === v;
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i] as Record<string, unknown> | null;
    if (!p || typeof p !== "object") {
      issues.push({
        rule: "panel_not_object",
        message: `panel[${i}] must be an object`,
      });
      continue;
    }
    if (
      typeof p.id === "string" &&
      baselinePanels.get(p.id) === stableStringify(p)
    ) {
      continue;
    }
    const label = panelLabel(p, i);
    const issue = (rule: string, message: string) =>
      issues.push({ rule: `panel_${rule}`, message: `${label} ${message}` });
    const isSection = p.chartType === "section";
    const isExtension = p.chartType === "extension";
    const required =
      isSection || isExtension
        ? (["id", "title", "chartType", "width"] as const)
        : (["id", "title", "sql", "source", "chartType", "width"] as const);
    for (const field of required) {
      const v = p[field];
      if (field === "width") {
        if (!isValidColumnCount(v)) {
          issue(
            "width",
            `width is ${v === undefined ? "missing" : JSON.stringify(v)}; set width to an integer 1-6 (updatePanel patch {"width":1}).`,
          );
        }
        continue;
      }
      if (typeof v !== "string" || v.trim().length === 0) {
        issue(
          field,
          `${field} is ${v === undefined ? "missing" : JSON.stringify(v)}; set ${field} to a non-empty string.`,
        );
      }
    }
    if (
      !isSection &&
      !isExtension &&
      typeof p.source === "string" &&
      p.source.trim() &&
      !validSources.has(p.source)
    ) {
      issue(
        "source",
        `source must be 'bigquery', 'ga4', 'amplitude', 'first-party', 'demo', 'prometheus', or 'program' (got '${printable(p.source)}'). source selects the backend — put the PromQL/SQL/table name or program descriptor in sql, not here.`,
      );
    }
    if (p.source === "program") {
      try {
        serializeProgramDescriptorInput(p.sql);
      } catch (e: any) {
        issue(
          "program_descriptor",
          `program descriptor is invalid: ${e instanceof Error ? e.message : printable(e)}`,
        );
      }
    }
    if (isExtension) {
      const cfg = p.config as Record<string, unknown> | undefined;
      const extensionId =
        cfg && typeof cfg.extensionId === "string"
          ? cfg.extensionId.trim()
          : "";
      const extensionSlotId =
        cfg && typeof cfg.extensionSlotId === "string"
          ? cfg.extensionSlotId.trim()
          : "";
      if (!extensionId && !extensionSlotId) {
        issue(
          "extension_target",
          "config.extensionId or config.extensionSlotId is required for extension panels",
        );
      }
    }
    if (
      isSection &&
      p.columns !== undefined &&
      !isValidColumnCount(p.columns)
    ) {
      issue(
        "section_columns",
        `columns is ${JSON.stringify(p.columns)}; set columns to an integer 1-6 (only valid on section panels).`,
      );
    }
  }
  if (config.columns !== undefined && !isValidColumnCount(config.columns)) {
    issues.push({
      rule: "dashboard_config",
      message: "config.columns must be an integer between 1 and 6",
    });
  }
  return issues;
}

export function validateDashboardConfig(
  config: Record<string, unknown>,
  options: ValidateDashboardConfigOptions = {},
): string | null {
  const issues = collectDashboardConfigIssues(config, options);
  return issues.length > 0
    ? issues.map((issue) => issue.message).join("\n")
    : null;
}

export function assertValidDashboardConfig(
  config: Record<string, unknown>,
  options: ValidateDashboardConfigOptions = {},
): void {
  const issues = collectDashboardConfigIssues(config, options);
  if (issues.length === 0) return;
  fail(issues.map((issue) => issue.message).join("\n"), {
    errorCode: issues.some((issue) => issue.rule.startsWith("panel_"))
      ? "dashboard_invalid_panel"
      : "dashboard_invalid_config",
    details: { issues },
  });
}

const MAX_CONCURRENT_SQL_VALIDATIONS = 8;

function firstPartyScope() {
  const { email, orgId } = resolveScope();
  return { userEmail: email, orgId };
}

export interface ValidatePanelSqlOptions {
  signal?: AbortSignal;
}

export async function validatePanelSql(
  config: Record<string, unknown>,
  panelIds?: ReadonlySet<string>,
  options: ValidatePanelSqlOptions = {},
): Promise<string | null> {
  const panels = config.panels;
  if (!Array.isArray(panels)) return null;
  const vars = resolveVerificationVars(config);
  const bigQueryPanels: Array<{
    index: number;
    panel: Record<string, unknown>;
    sql: string;
  }> = [];
  for (let i = 0; i < panels.length; i++) {
    if (options.signal?.aborted) {
      throw new Error("Dashboard SQL validation was cancelled");
    }
    const p = panels[i] as Record<string, unknown>;
    if (panelIds && (typeof p.id !== "string" || !panelIds.has(p.id))) {
      continue;
    }
    if (p.chartType === "section" || p.chartType === "extension") continue;
    if (p.source === "amplitude") {
      const raw = typeof p.sql === "string" ? p.sql : "";
      if (raw.trim()) {
        try {
          const desc = JSON.parse(interpolate(raw, vars));
          if (!desc?.event || typeof desc.event !== "string") {
            return `panel[${i}] "${printable(p.title || p.id)}" Amplitude descriptor requires an 'event' field`;
          }
        } catch (e: any) {
          return `panel[${i}] "${printable(p.title || p.id)}" Amplitude descriptor is not valid JSON: ${e instanceof Error ? e.message : printable(e)}`;
        }
      }
      continue;
    }
    if (p.source === "first-party") {
      const raw = typeof p.sql === "string" ? p.sql : "";
      if (raw.trim()) {
        try {
          const timeScopeError = validateFirstPartyDashboardTimeScope(
            p,
            config,
            i,
          );
          if (timeScopeError) return timeScopeError;
          await validateFirstPartyAnalyticsSqlForScope(
            interpolateDashboardPanelSql(raw, vars, p),
            firstPartyScope(),
          );
        } catch (e: any) {
          if (
            typeof e?.message === "string" &&
            e.message.startsWith("panel[")
          ) {
            return e.message;
          }
          if (e instanceof FirstPartyAnalyticsUnsupportedSqlError) {
            return `panel[${i}] "${printable(p.title || p.id)}" cannot run on this scope's active data backend (BigQuery) because its SQL uses ${e.construct}. Rewrite it with BigQuery-compatible SQL, or move the scope back to the PostgreSQL backend.`;
          }
          return `panel[${i}] "${printable(p.title || p.id)}" first-party analytics SQL is invalid: ${e instanceof Error ? e.message : printable(e)}`;
        }
      }
      continue;
    }
    if (p.source === "demo") {
      const raw = typeof p.sql === "string" ? p.sql : "";
      if (raw.trim()) {
        try {
          parseDemoDescriptor(interpolate(raw, vars));
        } catch (e: any) {
          return `panel[${i}] "${printable(p.title || p.id)}" demo descriptor is invalid: ${e instanceof Error ? e.message : printable(e)}`;
        }
      }
      continue;
    }
    if (p.source !== "bigquery") continue;
    const raw = typeof p.sql === "string" ? p.sql : "";
    if (!raw.trim()) continue;
    const sql = interpolateDashboardPanelSql(raw, vars, p);
    if (!sql.trim()) continue;
    bigQueryPanels.push({ index: i, panel: p, sql });
  }

  if (bigQueryPanels.length === 0) return null;

  const validationController = new AbortController();
  const abortFromCaller = () => validationController.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    validationController.abort();
  }, DASHBOARD_SQL_VALIDATION_TIMEOUT_MS);
  const errors: Array<string | null> = Array(bigQueryPanels.length).fill(null);
  let nextIndex = 0;

  const worker = async () => {
    while (!validationController.signal.aborted) {
      const taskIndex = nextIndex++;
      const task = bigQueryPanels[taskIndex];
      if (!task) return;

      let err: string | null;
      try {
        err = await dryRunQuery(task.sql, {
          signal: validationController.signal,
        });
      } catch (e: any) {
        err = e?.message ?? String(e);
      }
      errors[taskIndex] = err;
    }
  };

  try {
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            MAX_CONCURRENT_SQL_VALIDATIONS,
            bigQueryPanels.length,
          ),
        },
        () => worker(),
      ),
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (options.signal?.aborted && !timedOut) {
    throw new Error("Dashboard SQL validation was cancelled");
  }
  if (timedOut) {
    return `Dashboard SQL validation timed out after ${Math.round(DASHBOARD_SQL_VALIDATION_TIMEOUT_MS / 1000)} seconds`;
  }

  for (let i = 0; i < bigQueryPanels.length; i++) {
    const err = errors[i];
    if (err) {
      const task = bigQueryPanels[i];
      return `panel[${task.index}] "${printable(task.panel.title || task.panel.id)}" SQL is invalid: ${printable(err)}`;
    }
  }
  return null;
}

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

function countPanels(config: Record<string, unknown>): number {
  return Array.isArray(config.panels) ? config.panels.length : 0;
}

function resolveDashboardId(args: { dashboardId?: string; id?: string }) {
  const dashboardId = args.dashboardId || args.id;
  if (!dashboardId) {
    throw new Error("provide `dashboardId` (or legacy `id`).");
  }
  return dashboardId;
}

function dashboardResult(
  dashboardId: string,
  config: Record<string, unknown>,
  appliedOps: number,
  summary: string,
  movedPanelIds: string[] = [],
  returnConfig = false,
  updatedAt?: string,
  verdict: PanelWriteVerdict | null = null,
  receiptSaved?: string,
) {
  const compact = compactDashboardResult(config, movedPanelIds);
  summary = annotateSummary(summary, verdict);
  return {
    id: dashboardId,
    dashboardId,
    name: typeof config.name === "string" ? config.name : dashboardId,
    ...compact,
    saved: true,
    changed: true,
    appliedOps,
    summary,
    ...verdictFields(verdict),
    ...(receiptSaved
      ? { _receipt: dashboardWriteReceipt(dashboardId, receiptSaved, verdict) }
      : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(returnConfig ? { config } : {}),
    urlPath: `/dashboards/${dashboardId}`,
    deepLink: buildDeepLink({
      app: "analytics",
      view: "adhoc",
      params: { dashboardId },
    }),
    message:
      `${summary} First panels: ${compact.firstPanelIds.join(", ")}.` +
      (returnConfig
        ? ""
        : " Full config omitted; call get-sql-dashboard with panelIds for a panel's SQL and config (includeConfig=true only to review the whole dashboard)."),
  };
}

/**
 * A save the store did not persist (`didWrite: false`) is reported like an
 * unchanged `mutate-dashboard` batch: no sync, no tracking, and nothing verified.
 */
function unchangedDashboardResult(
  dashboardId: string,
  config: Record<string, unknown>,
  returnConfig: boolean,
  updatedAt: string,
  agentCaller: boolean,
) {
  return {
    ...dashboardResult(
      dashboardId,
      config,
      0,
      `No dashboard changes were needed for "${dashboardId}"; the requested state already matches.` +
        (agentCaller
          ? " If the viewer still sees the old result, call inspect-dashboard-panel to see what the panel renders."
          : ""),
      [],
      returnConfig,
      updatedAt,
    ),
    saved: false,
    changed: false,
    ...(agentCaller ? { _receipt: dashboardNoopReceipt(dashboardId) } : {}),
  };
}

function trackDashboardSaved(
  dashboardId: string,
  config: Record<string, unknown>,
  actionContext?: ActionRunContext,
) {
  track(
    "dashboard_saved",
    {
      app_name: "analytics",
      template_name: "analytics",
      output_id: dashboardId,
      output_type: "dashboard",
      dashboard_id: dashboardId,
      panel_count: countPanels(config),
    },
    actionContext,
  );
}

function opCanChangePanelSql(op: JsonOp): boolean {
  if (op.op === "move" || op.op === "move-before" || op.op === "remove") {
    return false;
  }
  if (!op.path) return true;
  return (
    op.path === "/panels" || /^\/panels\/(?:-|[0-9]+)(?:\/|$)/.test(op.path)
  );
}

export { isAgentCaller };

export default defineAction({
  description:
    "Save or replace a SQL dashboard full config (scope-aware) atomically in ONE call. " +
    "For existing dashboard panel/layout edits, use `mutate-dashboard` instead; it has the typed `dashboard.*` API for moves, inserts, deletes, duplicates, SQL/title/config edits, and bulk edits without JSON-pointer index math. " +
    "Use this action when creating a brand-new dashboard from a complete config, for the UI full-config save path, or for an explicitly requested low-level JSON-pointer compatibility edit. " +
    "Do not use `ops` or `panelOrder` for ordinary agent edits like moving charts, adding panels to an existing dashboard, changing widths, or updating panel config; call `mutate-dashboard` once with the full edit script. " +
    "When this action is appropriate, provide only one of `ops`, `panelOrder`, or `config`; `config` replaces the whole dashboard config. " +
    "First-party event panels must bind to a declared dashboard time filter with `{{timeRange}}` or date-range variables. Intentional fixed-window, cohort-history, and all-time exceptions must be explicit in `panel.config.timeScope`; unbounded first-party SQL is rejected at save time. " +
    "The result is compact by default: `panelCount`, `appliedOps`, `panelOrder`, `firstPanelIds`, and `summary`. Set `returnConfig: true` only when you truly need the full config in the tool result. " +
    "Agent writes run each changed panel the way the dashboard page does before saving: a panel that would show 'No data', drop configured columns, or fail is refused and nothing is saved. Only `verified:true` proves the edit renders; on `verified:false` call `inspect-dashboard-panel`. " +
    "The UI auto-refreshes after this action — do NOT call `refresh-screen`.",
  schema: z.object({
    dashboardId: z
      .string()
      .optional()
      .describe(
        "Dashboard id (without the `sql-dashboard-` prefix). e.g. 'devrel-leaderboard'",
      ),
    id: z
      .string()
      .optional()
      .describe("Legacy alias for dashboardId. Prefer dashboardId."),
    ops: jsonOpsInputSchema.describe(
      "Legacy low-level JSON-pointer compatibility ops. Agents should use mutate-dashboard for existing dashboard edits; only use this when the user explicitly requests raw JSON-pointer operations.",
    ),
    panelOrder: panelOrderInputSchema.describe(
      "Legacy compatibility reorder input. Agents should use mutate-dashboard id-based move methods for ordinary chart/section moves.",
    ),
    config: configInputSchema.describe(
      "Replace the whole dashboard config (or a JSON string).",
    ),
    expectedUpdatedAt: z
      .string()
      .optional()
      .describe(
        "Only used with `config`. The dashboard `updatedAt` observed before this edit was built (from get-sql-dashboard or a prior update-dashboard result). " +
          "When provided, the save is fenced against concurrent writers: if someone else (another tab, user, or agent call) saved in between, this call is rejected with a conflict error instead of silently overwriting their change — re-fetch and reapply. Omit only for a brand-new dashboard or a one-shot write that isn't derived from a prior read; an agent save without it is still rejected if the dashboard changed while the save was being verified.",
      ),
    allowEmptyResult: z
      .boolean()
      .optional()
      .describe(
        "Agent calls only. Set true only when the user expects a changed panel to have no rows right now; the save then reports verified:false.",
      ),
    returnConfig: z
      .boolean()
      .optional()
      .describe(
        "If true, include the full dashboard config in the result. Defaults to false to keep tool output compact.",
      ),
  }),
  http: { method: "POST" },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Dashboard preview",
      description: "Open the updated dashboard in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open dashboard",
      height: 680,
    }),
  },
  run: async (args, actionContext) => {
    const dashboardId = resolveDashboardId(args);
    const modeCount = [args.ops, args.panelOrder, args.config].filter(
      (value) => value !== undefined,
    ).length;

    if (modeCount === 0) {
      fail(
        "provide `ops` (surgical edits), `panelOrder` (id reorder), or `config` (full replace).",
      );
    }
    if (modeCount > 1) {
      fail("provide only one of `ops`, `panelOrder`, or `config`.");
    }

    const scope = resolveScope();
    const ctx = { email: scope.email, orgId: scope.orgId };
    const agentCaller = isAgentCaller(actionContext?.caller);
    const verificationMemo = new Map<string, PanelVerification>();

    if (args.config) {
      // A dashboard that does not exist yet has no base, so every panel is new.
      const before = await getDashboard(dashboardId, ctx);
      if (before) await requireEditableDashboard(dashboardId, ctx, before);
      assertValidDashboardConfig(args.config, {
        baseline: before ? before.config : null,
      });
      const sqlError = await validatePanelSql(args.config);
      if (sqlError) fail(sqlError);
      const verdict = agentCaller
        ? await verifyPanelWrite({
            base: before ? before.config : null,
            next: args.config,
            signal: actionContext?.signal,
            allowEmptyResult: args.allowEmptyResult,
            memo: verificationMemo,
            dashboardId,
          })
        : null;
      // Verification can run for seconds after `before` was read, so an agent
      // save without a caller-supplied revision is fenced to the record it
      // verified against. Other callers keep last-write-wins unless they send one.
      const fence =
        args.expectedUpdatedAt ?? (agentCaller ? before?.updatedAt : undefined);
      let outcome: DashboardUpsertOutcome;
      try {
        outcome =
          fence !== undefined
            ? await upsertDashboardOutcome(
                dashboardId,
                "sql",
                args.config,
                ctx,
                fence,
              )
            : await upsertDashboardOutcome(
                dashboardId,
                "sql",
                args.config,
                ctx,
              );
      } catch (err) {
        if (err instanceof DashboardConflictError) {
          fail(
            `Dashboard "${dashboardId}" was changed by someone else since you loaded it (another tab, user, or agent saved in between). Reload the dashboard and reapply your edit — your change was NOT saved, so nothing was lost.`,
            { errorCode: "dashboard_conflict", statusCode: 409 },
          );
        }
        throw err;
      }
      const saved = outcome.dashboard;
      if (!outcome.didWrite) {
        return unchangedDashboardResult(
          dashboardId,
          args.config,
          args.returnConfig === true,
          saved.updatedAt,
          agentCaller,
        );
      }
      void queueDashboardCollabSync(
        dashboardId,
        saved.updatedAt,
        () => getDashboard(dashboardId, ctx),
        agentCaller ? "agent" : undefined,
      );
      const panelCount = countPanels(args.config);
      trackDashboardSaved(dashboardId, args.config, actionContext);
      return dashboardResult(
        dashboardId,
        args.config,
        0,
        `Replaced dashboard "${dashboardId}"; it now has ${panelCount} panel(s).`,
        [],
        args.returnConfig === true,
        saved.updatedAt,
        verdict,
        agentCaller ? `Saved dashboard "${dashboardId}"` : undefined,
      );
    }

    if (args.panelOrder) {
      let orderDetails!: PanelOrderResult;
      let orderVerdict: PanelWriteVerdict | null = null;
      const outcome = await upsertDashboardWithRetryOutcome(
        dashboardId,
        ctx,
        async (existing) => {
          await requireEditableDashboard(dashboardId, ctx, existing);
          const root = existing.config as Record<string, unknown>;
          // applyPanelOrder edits `root` in place, so the pre-edit config must be copied first.
          const baseline = JSON.parse(JSON.stringify(root)) as Record<
            string,
            unknown
          >;
          try {
            orderDetails = applyPanelOrder(root, args.panelOrder!);
          } catch (err: any) {
            fail(err instanceof Error ? err.message : String(err));
          }
          assertValidDashboardConfig(root, { baseline });
          if (agentCaller) {
            orderVerdict = await verifyPanelWrite({
              base: baseline,
              next: root,
              signal: actionContext?.signal,
              dashboardId,
            });
          }
          return { kind: existing.kind, body: root };
        },
      );
      const saved = outcome.dashboard;
      const root = saved.config as Record<string, unknown>;
      if (!outcome.didWrite) {
        return unchangedDashboardResult(
          dashboardId,
          root,
          args.returnConfig === true,
          saved.updatedAt,
          agentCaller,
        );
      }
      void queueDashboardCollabSync(
        dashboardId,
        saved.updatedAt,
        () => getDashboard(dashboardId, ctx),
        agentCaller ? "agent" : undefined,
      );
      trackDashboardSaved(dashboardId, root, actionContext);
      return dashboardResult(
        dashboardId,
        root,
        1,
        `Moved ${orderDetails.movedPanelIds.length} panel id(s) to the front of dashboard "${dashboardId}"; it now has ${orderDetails.panelCount} panel(s).`,
        orderDetails.movedPanelIds,
        args.returnConfig === true,
        saved.updatedAt,
        orderVerdict,
        agentCaller ? `Saved panel order for "${dashboardId}"` : undefined,
      );
    }

    let appliedDetails: string[] = [];
    let opsVerdict: PanelWriteVerdict | null = null;
    const outcome = await upsertDashboardWithRetryOutcome(
      dashboardId,
      ctx,
      async (existing) => {
        await requireEditableDashboard(dashboardId, ctx, existing);
        const root = existing.config as Record<string, unknown>;
        // The ops below edit `root` in place, so the pre-edit config must be copied first.
        const baseline = JSON.parse(JSON.stringify(root)) as Record<
          string,
          unknown
        >;
        const details: string[] = [];
        for (const op of args.ops!) {
          try {
            details.push(applyJsonOp(root, op as JsonOp));
          } catch (err: any) {
            fail(`applying op ${JSON.stringify(op)}: ${err.message}`);
          }
        }

        assertValidDashboardConfig(root, { baseline });
        if (args.ops!.some((op) => opCanChangePanelSql(op as JsonOp))) {
          const sqlError = await validatePanelSql(root);
          if (sqlError) fail(sqlError);
        }
        // Filter and variable edits re-resolve every panel's SQL, so the gate
        // diffs every agent write rather than guessing from the op paths.
        if (agentCaller) {
          opsVerdict = await verifyPanelWrite({
            base: baseline,
            next: root,
            signal: actionContext?.signal,
            allowEmptyResult: args.allowEmptyResult,
            memo: verificationMemo,
            dashboardId,
          });
        }
        appliedDetails = details;
        return { kind: existing.kind, body: root };
      },
    );
    const saved = outcome.dashboard;
    const root = saved.config as Record<string, unknown>;
    if (!outcome.didWrite) {
      return unchangedDashboardResult(
        dashboardId,
        root,
        args.returnConfig === true,
        saved.updatedAt,
        agentCaller,
      );
    }
    void queueDashboardCollabSync(
      dashboardId,
      saved.updatedAt,
      () => getDashboard(dashboardId, ctx),
      agentCaller ? "agent" : undefined,
    );

    const panelCount = countPanels(root);
    trackDashboardSaved(dashboardId, root, actionContext);
    return dashboardResult(
      dashboardId,
      root,
      appliedDetails.length,
      `Applied ${appliedDetails.length} op(s); dashboard "${dashboardId}" now has ${panelCount} panel(s).`,
      [],
      args.returnConfig === true,
      saved.updatedAt,
      opsVerdict,
      agentCaller
        ? `Saved ${appliedDetails.length} op(s) to "${dashboardId}"`
        : undefined,
    );
  },
  link: ({ result }) => {
    const dashboardId =
      result && typeof result === "object"
        ? (result as { dashboardId?: string }).dashboardId
        : undefined;
    if (!dashboardId) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      label: "Open dashboard in Analytics",
      view: "adhoc",
    };
  },
});
