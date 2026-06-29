import { defineAction, embedApp } from "@agent-native/core";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import {
  getRequestUserEmail,
  getRequestOrgId,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { interpolate } from "../app/pages/adhoc/sql-dashboard/interpolate";
import { dryRunQuery } from "../server/lib/bigquery";
import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store";
import { parseDemoDescriptor } from "../server/lib/demo-source";
import { validateFirstPartyAnalyticsSql } from "../server/lib/first-party-analytics.js";
import {
  applyPanelOrder,
  compactDashboardResult,
} from "./dashboard-panel-order";

/**
 * Same validation shape used in the sql-dashboard save path.
 * Variables declared on the dashboard take priority; filter `default` values
 * fill in anything missing so parametric SQL validates against a real value.
 *
 * date-range filters expand into `<id>Start` / `<id>End` to match the runtime
 * expansion in DashboardFilterBar; without this, any panel that uses
 * `{{dateStart}}` / `{{dateEnd}}` fails the dry-run.
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

/** Reject out-of-bounds array indices so a bad pointer can't silently
 *  create sparse arrays. `mode` controls whether the index may equal
 *  length (insertion-style) or must be strictly less (access-style). */
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
      // Destination path is resolved AFTER the source splice, so natural
      // splice semantics place the element at the requested index in the
      // final array. No adjustment needed for same-array moves.
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

/**
 * Reject configs missing the fields the UI assumes are always present.
 * Returns a human-readable error string, or `null` when the config passes.
 * Mirrors the shape required by `app/pages/adhoc/sql-dashboard/types.ts`.
 */
export function validateDashboardConfig(
  config: Record<string, unknown>,
): string | null {
  if (!config || typeof config !== "object") {
    return "config must be an object";
  }
  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    return "config.name is required (non-empty string) — without it the dashboard renders as a blank row in the sidebar";
  }
  if (config.parentId !== undefined && config.parentId !== null) {
    if (
      typeof config.parentId !== "string" ||
      config.parentId.trim().length === 0
    ) {
      return "config.parentId must be a non-empty dashboard id (or omitted) — it nests this dashboard under that parent in the sidebar";
    }
  }
  // Filter ID collisions cause two controls to read/write the same URL param.
  // For paired start/end dates use a single date-range filter — the FilterBar
  // expands it to <id>Start / <id>End at runtime, so the SQL can still
  // reference both halves.
  const filters = config.filters;
  if (filters !== undefined && !Array.isArray(filters)) {
    return "config.filters must be an array";
  }
  if (Array.isArray(filters)) {
    const seen = new Set<string>();
    const deduped: unknown[] = [];
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i] as Record<string, unknown> | null;
      if (!f || typeof f !== "object") {
        return `config.filters[${i}] must be an object`;
      }
      const id = typeof f.id === "string" ? f.id.trim() : "";
      if (!id) return `config.filters[${i}].id is required`;
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
    return "config.panels must be an array (use [] for an empty dashboard)";
  }
  const validSources = new Set([
    "bigquery",
    "ga4",
    "amplitude",
    "first-party",
    "demo",
    "prometheus",
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
      return `panel[${i}] must be an object`;
    }
    // Section panels are pure layout dividers and extension panels render their
    // own iframe, so both make source and sql optional. Width stays required for
    // backward-compatible dashboard payloads.
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
          return `panel[${i}].width must be an integer between 1 and 6 (legacy layout field)`;
        }
        continue;
      }
      if (typeof v !== "string" || v.trim().length === 0) {
        return `panel[${i}].${field} is required (non-empty string)`;
      }
    }
    if (!isSection && !isExtension && !validSources.has(p.source as string)) {
      return `panel[${i}].source must be 'bigquery', 'ga4', 'amplitude', 'first-party', 'demo', or 'prometheus' (got '${p.source}'). source selects the backend — put the PromQL/SQL/table name in sql, not here.`;
    }
    if (isExtension) {
      const cfg = p.config as Record<string, unknown> | undefined;
      const extensionId =
        cfg && typeof cfg.extensionId === "string"
          ? cfg.extensionId.trim()
          : "";
      if (!extensionId) {
        return `panel[${i}].config.extensionId is required for extension panels (the id of the extension to render inline)`;
      }
    }
    if (
      isSection &&
      p.columns !== undefined &&
      !isValidColumnCount(p.columns)
    ) {
      return `panel[${i}].columns must be an integer between 1 and 6 (only valid on section panels)`;
    }
  }
  if (config.columns !== undefined && !isValidColumnCount(config.columns)) {
    return "config.columns must be an integer between 1 and 6";
  }
  return null;
}

/**
 * Dry-run each BigQuery panel's SQL so bad column names or type
 * mismatches fail here, with the full BigQuery error text, rather than
 * silently saving a broken dashboard that crashes on render.
 */
export async function validatePanelSql(
  config: Record<string, unknown>,
): Promise<string | null> {
  const panels = config.panels;
  if (!Array.isArray(panels)) return null;
  const vars = buildDryRunVars(config);
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i] as Record<string, unknown>;
    // Sections are layout-only and extensions render their own iframe — neither
    // has SQL to dry-run. heatmap, callout, and other query panels still
    // validate normally below.
    if (p.chartType === "section" || p.chartType === "extension") continue;
    if (p.source === "amplitude") {
      const raw = typeof p.sql === "string" ? p.sql : "";
      if (raw.trim()) {
        try {
          const desc = JSON.parse(interpolate(raw, vars));
          if (!desc?.event || typeof desc.event !== "string") {
            return `panel[${i}] "${p.title || p.id}" Amplitude descriptor requires an 'event' field`;
          }
        } catch (e: any) {
          return `panel[${i}] "${p.title || p.id}" Amplitude descriptor is not valid JSON: ${e?.message}`;
        }
      }
      continue;
    }
    if (p.source === "first-party") {
      const raw = typeof p.sql === "string" ? p.sql : "";
      if (raw.trim()) {
        try {
          validateFirstPartyAnalyticsSql(interpolate(raw, vars));
        } catch (e: any) {
          return `panel[${i}] "${p.title || p.id}" first-party analytics SQL is invalid: ${e?.message ?? e}`;
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
          return `panel[${i}] "${p.title || p.id}" demo descriptor is invalid: ${e?.message ?? e}`;
        }
      }
      continue;
    }
    if (p.source !== "bigquery") continue;
    const raw = typeof p.sql === "string" ? p.sql : "";
    if (!raw.trim()) continue;
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

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

/** Resulting panel count, used for the proof-of-done return summary. */
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
) {
  const compact = compactDashboardResult(config, movedPanelIds);
  return {
    id: dashboardId,
    dashboardId,
    name: typeof config.name === "string" ? config.name : dashboardId,
    ...compact,
    appliedOps,
    summary,
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
        : " Full config omitted; call get-sql-dashboard with includeConfig=true only if full SQL/config is needed."),
  };
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

/**
 * Push a config update through the collab layer so open dashboard editors
 * receive the change in real time. Seeds the collab state if it doesn't
 * exist yet (e.g. dashboard was created before the collab plugin was added).
 */
async function syncToCollab(
  dashboardId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const configStr = JSON.stringify(config);
  try {
    const exists = await hasCollabState(docId);
    if (exists) {
      await applyText(docId, configStr, "content", "agent");
    } else {
      await seedFromText(docId, configStr);
    }
  } catch {
    // Collab sync is best-effort — the SQL write is the source of truth
  }
}

// Reads + writes now go through the SQL-backed dashboards store, which
// lazy-migrates legacy settings keys on first access. See
// `server/lib/dashboards-store.ts`.

export default defineAction({
  description:
    "Save or replace a SQL dashboard full config (scope-aware) atomically in ONE call. " +
    "For existing dashboard panel/layout edits, use `mutate-dashboard` instead; it has the typed `dashboard.*` API for moves, inserts, deletes, duplicates, SQL/title/config edits, and bulk edits without JSON-pointer index math. " +
    "Use this action when creating a brand-new dashboard from a complete config, for the UI full-config save path, or for an explicitly requested low-level JSON-pointer compatibility edit. " +
    "Do not use `ops` or `panelOrder` for ordinary agent edits like moving charts, adding panels to an existing dashboard, changing widths, or updating panel config; call `mutate-dashboard` once with the full edit script. " +
    "When this action is appropriate, provide only one of `ops`, `panelOrder`, or `config`; `config` replaces the whole dashboard config. " +
    "To add a shipped catalog template's panels to an existing dashboard, prefer `install-dashboard-template` with `mergePanels: true` — it appends the template's panels in one call without you having to author each panel. " +
    "The result is compact by default: `panelCount`, `appliedOps`, `panelOrder`, `firstPanelIds`, and `summary`. Set `returnConfig: true` only when you truly need the full config in the tool result. " +
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
    returnConfig: z
      .boolean()
      .optional()
      .describe(
        "If true, include the full dashboard config in the result. Defaults to false to keep tool output compact.",
      ),
  }),
  // The SQL dashboard editor persists user edits through callAction(), which
  // needs this action mounted under /_agent-native/actions/update-dashboard.
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
  run: async (args) => {
    const dashboardId = resolveDashboardId(args);
    const modeCount = [args.ops, args.panelOrder, args.config].filter(
      (value) => value !== undefined,
    ).length;

    if (modeCount === 0) {
      throw new Error(
        "provide `ops` (surgical edits), `panelOrder` (id reorder), or `config` (full replace).",
      );
    }
    if (modeCount > 1) {
      throw new Error("provide only one of `ops`, `panelOrder`, or `config`.");
    }

    const scope = resolveScope();
    const ctx = { email: scope.email, orgId: scope.orgId };

    if (args.config) {
      const validation = validateDashboardConfig(args.config);
      if (validation) throw new Error(validation);
      const sqlError = await validatePanelSql(args.config);
      if (sqlError) throw new Error(sqlError);
      await upsertDashboard(dashboardId, "sql", args.config, ctx);
      await syncToCollab(dashboardId, args.config);
      const panelCount = countPanels(args.config);
      return dashboardResult(
        dashboardId,
        args.config,
        0,
        `Replaced dashboard "${dashboardId}"; it now has ${panelCount} panel(s).`,
        [],
        args.returnConfig === true,
      );
    }

    const existing = await getDashboard(dashboardId, ctx);
    if (!existing) {
      throw new Error(
        `dashboard "${dashboardId}" not found (or you don't have access).`,
      );
    }

    const root = existing.config as any;

    if (args.panelOrder) {
      const orderDetails = applyPanelOrder(root, args.panelOrder);
      const validation = validateDashboardConfig(root);
      if (validation) throw new Error(validation);
      await upsertDashboard(
        dashboardId,
        existing.kind,
        root as Record<string, unknown>,
        ctx,
      );
      await syncToCollab(dashboardId, root as Record<string, unknown>);
      return dashboardResult(
        dashboardId,
        root as Record<string, unknown>,
        1,
        `Moved ${orderDetails.movedPanelIds.length} panel id(s) to the front of dashboard "${dashboardId}"; it now has ${orderDetails.panelCount} panel(s).`,
        orderDetails.movedPanelIds,
        args.returnConfig === true,
      );
    }

    const details: string[] = [];
    for (const op of args.ops!) {
      try {
        details.push(applyJsonOp(root, op as JsonOp));
      } catch (err: any) {
        throw new Error(`applying op ${JSON.stringify(op)}: ${err.message}`);
      }
    }

    const validation = validateDashboardConfig(root);
    if (validation) throw new Error(validation);
    if (args.ops!.some((op) => opCanChangePanelSql(op as JsonOp))) {
      const sqlError = await validatePanelSql(root);
      if (sqlError) throw new Error(sqlError);
    }

    await upsertDashboard(
      dashboardId,
      existing.kind,
      root as Record<string, unknown>,
      ctx,
    );
    await syncToCollab(dashboardId, root as Record<string, unknown>);

    const panelCount = countPanels(root as Record<string, unknown>);
    return dashboardResult(
      dashboardId,
      root as Record<string, unknown>,
      details.length,
      `Applied ${details.length} op(s); dashboard "${dashboardId}" now has ${panelCount} panel(s).`,
      [],
      args.returnConfig === true,
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
