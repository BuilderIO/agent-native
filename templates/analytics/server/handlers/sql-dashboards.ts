import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import {
  deleteScopedSettingRecord,
  getScopedSettingRecord,
  listScopedSettingRecords,
  putScopedSettingRecord,
  resolveSettingsScope,
} from "../lib/scoped-settings";
import { dryRunQuery } from "../lib/bigquery";
import { interpolate } from "../../app/pages/adhoc/sql-dashboard/interpolate";

const KEY_PREFIX = "sql-dashboard-";

/**
 * Build the variable map used when dry-running a panel's SQL. Variables
 * declared on the dashboard take priority, then each filter's `default`
 * fills in anything missing — so a parametric dashboard (e.g. one with
 * `{{dateStart}}`) validates against a real value instead of blowing up
 * on the empty string the interpolator would otherwise produce.
 */
function buildDryRunVars(
  config: Record<string, unknown>,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const filters = Array.isArray(config.filters)
    ? (config.filters as Array<Record<string, unknown>>)
    : [];
  for (const f of filters) {
    const key =
      typeof f.key === "string" ? f.key : typeof f.id === "string" ? f.id : "";
    if (!key) continue;
    const def = f.default;
    if (typeof def === "string" && def) vars[key] = def;
  }
  const declared =
    config.variables && typeof config.variables === "object"
      ? (config.variables as Record<string, unknown>)
      : {};
  for (const [k, v] of Object.entries(declared)) {
    if (typeof v === "string") vars[k] = v;
  }
  return vars;
}

export const listSqlDashboards = defineEventHandler(async (event) => {
  try {
    const scope = await resolveSettingsScope(event);
    const all = await listScopedSettingRecords(scope, KEY_PREFIX);
    const dashboards = Object.entries(all).map(([key, data]) => ({
      id: key.slice(KEY_PREFIX.length),
      ...data,
    }));
    return { dashboards };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const getSqlDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const key = `${KEY_PREFIX}${id}`;
    const scope = await resolveSettingsScope(event);
    const data = await getScopedSettingRecord(scope, key);
    if (!data) {
      setResponseStatus(event, 404);
      return { error: "Dashboard not found" };
    }
    return { id, ...data };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const saveSqlDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const body = (await readBody(event)) as Record<string, unknown>;
    const validation = validateDashboardConfig(body);
    if (validation) {
      setResponseStatus(event, 400);
      return { error: validation };
    }
    const sqlError = await validatePanelSql(body);
    if (sqlError) {
      setResponseStatus(event, 400);
      return { error: sqlError };
    }
    const scope = await resolveSettingsScope(event);
    const key = `${KEY_PREFIX}${id}`;
    await putScopedSettingRecord(scope, key, body);
    return { id, success: true };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

/**
 * Dry-run every BigQuery panel's SQL so compilation errors (unknown
 * columns, type mismatches, bad joins) surface as a 400 here instead of
 * being persisted and blowing up every render. Free via BigQuery's
 * `dryRun` flag (no bytes billed). Returns the first error found — one
 * broken panel is enough to tell the agent to fix its SQL before saving.
 */
async function validatePanelSql(
  config: Record<string, unknown>,
): Promise<string | null> {
  const panels = config.panels;
  if (!Array.isArray(panels)) return null;
  const vars = buildDryRunVars(config);
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i] as Record<string, unknown>;
    const raw = typeof p.sql === "string" ? p.sql : "";
    if (!raw.trim()) continue;

    if (p.source === "ga4") {
      const err = validateGa4PanelShape(raw);
      if (err) {
        return `panel[${i}] "${p.title || p.id}" GA4 descriptor is invalid: ${err}`;
      }
      continue;
    }

    if (p.source !== "bigquery") continue;
    const sql = interpolate(raw, vars);
    if (!sql.trim()) continue;
    let err: string | null;
    try {
      err = await dryRunQuery(sql);
    } catch (e: any) {
      err = e?.message ?? String(e);
    }
    if (err) {
      return `panel[${i}] "${p.title || p.id}" SQL is invalid: ${err}`;
    }
  }
  return null;
}

/**
 * Match the shape runGa4Panel() will insist on at render time so malformed
 * descriptors fail the save instead of the dashboard page. Keep this in sync
 * with `server/handlers/sql-query.ts:runGa4Panel`.
 */
function validateGa4PanelShape(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    return `sql must be a JSON object (${err?.message ?? err})`;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "sql must be a JSON object";
  }
  const obj = parsed as Record<string, unknown>;
  const metrics = Array.isArray(obj.metrics)
    ? obj.metrics.filter((m): m is string => typeof m === "string" && !!m)
    : [];
  if (metrics.length === 0) {
    return "requires at least one metric (array of strings)";
  }
  if (obj.dimensions !== undefined && !Array.isArray(obj.dimensions)) {
    return "dimensions must be an array of strings";
  }
  return null;
}

/**
 * Reject configs that would render as a blank sidebar row or crash the
 * dashboard page. Mirrors `actions/update-dashboard.ts` so both write
 * paths refuse the same shapes — see `app/pages/adhoc/sql-dashboard/types.ts`.
 */
function validateDashboardConfig(
  config: Record<string, unknown> | null | undefined,
): string | null {
  if (!config || typeof config !== "object") return "config must be an object";
  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    return "name is required";
  }
  const panels = config.panels;
  if (panels !== undefined && !Array.isArray(panels)) {
    return "panels must be an array";
  }
  if (Array.isArray(panels)) {
    const requiredStrings = ["id", "title", "sql", "source", "chartType"];
    const validSources = new Set(["bigquery", "app-db", "ga4"]);
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i] as Record<string, unknown> | null;
      if (!p || typeof p !== "object") return `panel[${i}] must be an object`;
      for (const field of requiredStrings) {
        const v = p[field];
        if (typeof v !== "string" || v.trim().length === 0) {
          return `panel[${i}].${field} is required`;
        }
      }
      if (!validSources.has(p.source as string)) {
        return `panel[${i}].source must be 'bigquery', 'app-db', or 'ga4' (got '${p.source}'). The table name belongs in the panel's sql, not in source — source selects the backend, not the table.`;
      }
      if (p.width !== 1 && p.width !== 2) {
        return `panel[${i}].width must be 1 or 2`;
      }
    }
  }
  return null;
}

export const deleteSqlDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  const scope = await resolveSettingsScope(event);
  const key = `${KEY_PREFIX}${id}`;
  await deleteScopedSettingRecord(scope, key);
  return { id, success: true };
});
