import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseStatus,
} from "h3";
import { readBody } from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import { runApiHandlerWithContext } from "../lib/credentials";
import {
  getDashboard,
  listDashboards,
  upsertDashboard,
  removeDashboard,
  archiveDashboard,
  unarchiveDashboard,
  type DashboardArchiveFilter,
} from "../lib/dashboards-store";
import { dryRunQuery } from "../lib/bigquery";
import { interpolate } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import { validateFirstPartyAnalyticsSql } from "../lib/first-party-analytics";
import { parsePanelDescriptor as parsePrometheusPanelDescriptor } from "../lib/prometheus";
import { loadDashboardSeed } from "../lib/dashboard-seeds";

async function ctxFromEvent(event: any) {
  const ctx = await getOrgContext(event);
  return { email: ctx.email, orgId: ctx.orgId ?? null };
}

/**
 * Build the variable map used when dry-running a panel's SQL. Variables
 * declared on the dashboard take priority, then each filter's `default`
 * fills in anything missing — so a parametric dashboard (e.g. one with
 * `{{dateStart}}`) validates against a real value instead of blowing up
 * on the empty string the interpolator would otherwise produce.
 *
 * date-range filters expand into `<id>Start` / `<id>End` to match the
 * runtime expansion in DashboardFilterBar's resolveFilterVars; without
 * this, any panel that uses `{{dateStart}}` / `{{dateEnd}}` fails the
 * dry-run with a literal "" cast error.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveDateDefault(raw: string | undefined): string {
  if (!raw) return "";
  const m = /^(\d+)d$/.exec(raw);
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(m[1], 10));
    return d.toISOString().slice(0, 10);
  }
  if (raw === "today") return todayUtc();
  return raw;
}

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
    const def = typeof f.default === "string" ? f.default : "";
    if (f.type === "date-range") {
      vars[`${key}Start`] = resolveDateDefault(def);
      vars[`${key}End`] = todayUtc();
    } else if (f.type === "date" || f.type === "toggle-date") {
      if (def) vars[key] = resolveDateDefault(def);
    } else {
      if (def) vars[key] = def;
    }
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

function parseArchivedFilter(raw: unknown): DashboardArchiveFilter {
  if (raw === "1" || raw === "true" || raw === "only" || raw === "archived")
    return "archived";
  if (raw === "all") return "all";
  return "active";
}

function isEmptyDashboardConfig(config: Record<string, unknown>): boolean {
  return !Array.isArray(config.panels) || config.panels.length === 0;
}

function seededSqlDashboardResponse(
  id: string,
  seed: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    ...seed,
    ownerEmail: null,
    orgId: null,
    visibility: "org",
    archivedAt: null,
  };
}

export const listSqlDashboards = defineEventHandler(async (event) => {
  try {
    const ctx = await ctxFromEvent(event);
    const archived = parseArchivedFilter(getQuery(event).archived);
    const rows = await listDashboards(ctx, { kind: "sql", archived });
    const dashboards = rows.map((d) => ({
      id: d.id,
      ...(d.config as Record<string, unknown>),
      ownerEmail: d.ownerEmail,
      orgId: d.orgId,
      visibility: d.visibility,
      archivedAt: d.archivedAt,
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
    const ctx = await ctxFromEvent(event);
    const dash = await getDashboard(id, ctx);
    if (!dash || dash.kind !== "sql") {
      const seed = loadDashboardSeed(id);
      if (seed) return seededSqlDashboardResponse(id, seed);
      setResponseStatus(event, 404);
      return { error: "Dashboard not found" };
    }
    const config = dash.config as Record<string, unknown>;
    if (isEmptyDashboardConfig(config)) {
      const seed = loadDashboardSeed(id);
      if (seed) return seededSqlDashboardResponse(id, seed);
    }
    return {
      id,
      ...config,
      ownerEmail: dash.ownerEmail,
      orgId: dash.orgId,
      visibility: dash.visibility,
      archivedAt: dash.archivedAt,
    };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const saveSqlDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  return runApiHandlerWithContext(event, async () => {
    try {
      const body = (await readBody(event)) as Record<string, unknown>;
      const validation = validateDashboardConfig(body);
      if (validation) {
        setResponseStatus(event, 400);
        return { error: validation };
      }
      const ctx = await ctxFromEvent(event);
      const sqlError = await validatePanelSql(body);
      if (sqlError) {
        setResponseStatus(event, 400);
        return { error: sqlError };
      }
      await upsertDashboard(id, "sql", body, ctx);
      return { id, success: true };
    } catch (err: any) {
      const status = err?.statusCode ?? 500;
      setResponseStatus(event, status);
      return { error: err.message };
    }
  });
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
    // Sections are layout-only — no SQL to dry-run. heatmap, callout, and other
    // query panels still validate normally below.
    if (p.chartType === "section") continue;
    const raw = typeof p.sql === "string" ? p.sql : "";
    if (!raw.trim()) continue;

    if (p.source === "ga4") {
      const err = validateGa4PanelShape(interpolate(raw, vars));
      if (err) {
        return `panel[${i}] "${p.title || p.id}" GA4 descriptor is invalid: ${err}`;
      }
      continue;
    }

    if (p.source === "amplitude") {
      const err = validateAmplitudePanelShape(interpolate(raw, vars));
      if (err) {
        return `panel[${i}] "${p.title || p.id}" Amplitude descriptor is invalid: ${err}`;
      }
      continue;
    }

    if (p.source === "first-party") {
      try {
        validateFirstPartyAnalyticsSql(interpolate(raw, vars));
      } catch (e: any) {
        return `panel[${i}] "${p.title || p.id}" first-party analytics SQL is invalid: ${e?.message ?? e}`;
      }
      continue;
    }

    if (p.source === "prometheus") {
      try {
        parsePrometheusPanelDescriptor(interpolate(raw, vars));
      } catch (e: any) {
        return `panel[${i}] "${p.title || p.id}" Prometheus descriptor is invalid: ${e?.message ?? e}`;
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

function validateAmplitudePanelShape(raw: string): string | null {
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
  if (typeof obj.event !== "string" || !obj.event.trim()) {
    return "requires an 'event' field (non-empty string)";
  }
  if (obj.groupBy !== undefined && typeof obj.groupBy !== "string") {
    return "groupBy must be a string";
  }
  if (
    obj.metric !== undefined &&
    obj.metric !== "totals" &&
    obj.metric !== "uniques"
  ) {
    return "metric must be 'totals' or 'uniques'";
  }
  if (obj.days !== undefined && typeof obj.days !== "number") {
    return "days must be a number";
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
  // Filter ID collisions cause two controls to read/write the same URL param
  // — the symptom we caught in the wild was a "Closed-Lost" dashboard whose
  // start-date and end-date both used `id: "close_date"`, so changing one
  // value visibly updated the other. A single date-range filter (which the
  // FilterBar splits into <id>Start / <id>End) is the right shape.
  const filters = config.filters;
  if (filters !== undefined && !Array.isArray(filters)) {
    return "filters must be an array";
  }
  if (Array.isArray(filters)) {
    const seen = new Set<string>();
    const deduped: unknown[] = [];
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i] as Record<string, unknown> | null;
      if (!f || typeof f !== "object") return `filters[${i}] must be an object`;
      const id = typeof f.id === "string" ? f.id.trim() : "";
      if (!id) return `filters[${i}].id is required`;
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push(f);
    }
    if (deduped.length !== filters.length) {
      config.filters = deduped;
    }
  }
  const panels = config.panels;
  if (panels !== undefined && !Array.isArray(panels)) {
    return "panels must be an array";
  }
  if (Array.isArray(panels)) {
    const requiredStringsForQueryPanel = [
      "id",
      "title",
      "sql",
      "source",
      "chartType",
    ];
    const requiredStringsForSection = ["id", "title", "chartType"];
    const validSources = new Set([
      "bigquery",
      "ga4",
      "amplitude",
      "first-party",
      "prometheus",
    ]);
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i] as Record<string, unknown> | null;
      if (!p || typeof p !== "object") return `panel[${i}] must be an object`;
      const isSection = p.chartType === "section";
      const requiredStrings = isSection
        ? requiredStringsForSection
        : requiredStringsForQueryPanel;
      for (const field of requiredStrings) {
        const v = p[field];
        if (typeof v !== "string" || v.trim().length === 0) {
          return `panel[${i}].${field} is required`;
        }
      }
      if (!isSection && !validSources.has(p.source as string)) {
        return `panel[${i}].source must be 'bigquery', 'ga4', 'amplitude', 'first-party', or 'prometheus' (got '${p.source}'). The PromQL/SQL/table belongs in the panel's sql, not in source — source selects the backend, not the table.`;
      }
      if (
        typeof p.width !== "number" ||
        !Number.isFinite(p.width) ||
        p.width < 1 ||
        p.width > 6 ||
        Math.floor(p.width) !== p.width
      ) {
        return `panel[${i}].width must be an integer between 1 and 6 (number of grid columns to span)`;
      }
      if (isSection && p.columns !== undefined) {
        if (
          typeof p.columns !== "number" ||
          !Number.isFinite(p.columns) ||
          p.columns < 1 ||
          p.columns > 6 ||
          Math.floor(p.columns) !== p.columns
        ) {
          return `panel[${i}].columns must be an integer between 1 and 6 (only valid on section panels)`;
        }
      }
    }
  }
  if (config.columns !== undefined) {
    if (
      typeof config.columns !== "number" ||
      !Number.isFinite(config.columns) ||
      config.columns < 1 ||
      config.columns > 6 ||
      Math.floor(config.columns) !== config.columns
    ) {
      return "config.columns must be an integer between 1 and 6";
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
  try {
    const ctx = await ctxFromEvent(event);
    await removeDashboard(id, ctx);
    return { id, success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const archiveSqlDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    const dash = await archiveDashboard(id, ctx);
    if (!dash) {
      setResponseStatus(event, 404);
      return { error: "Dashboard not found" };
    }
    return { id, archivedAt: dash.archivedAt, success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const unarchiveSqlDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    const dash = await unarchiveDashboard(id, ctx);
    if (!dash) {
      setResponseStatus(event, 404);
      return { error: "Dashboard not found" };
    }
    return { id, archivedAt: dash.archivedAt, success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});
