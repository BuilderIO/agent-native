import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";
import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store";
import { dryRunQuery } from "../server/lib/bigquery";
import { interpolate } from "../app/pages/adhoc/sql-dashboard/interpolate";
import { validateFirstPartyAnalyticsSql } from "../server/lib/first-party-analytics.js";
import {
  hasCollabState,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";

/**
 * Same shape as the server-side validator in `server/handlers/sql-dashboards.ts`.
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
function validateDashboardConfig(
  config: Record<string, unknown>,
): string | null {
  if (!config || typeof config !== "object") {
    return "config must be an object";
  }
  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    return "config.name is required (non-empty string) — without it the dashboard renders as a blank row in the sidebar";
  }
  const panels = config.panels;
  if (!Array.isArray(panels)) {
    return "config.panels must be an array (use [] for an empty dashboard)";
  }
  const validSources = new Set(["bigquery", "ga4", "amplitude", "first-party"]);
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i] as Record<string, unknown> | null;
    if (!p || typeof p !== "object") {
      return `panel[${i}] must be an object`;
    }
    // Section panels are pure layout dividers — they have no query, so source
    // and sql are optional. They still need id/title/chartType/width so the
    // grid renders them.
    const isSection = p.chartType === "section";
    const required = isSection
      ? (["id", "title", "chartType", "width"] as const)
      : (["id", "title", "sql", "source", "chartType", "width"] as const);
    for (const field of required) {
      const v = p[field];
      if (field === "width") {
        if (v !== 1 && v !== 2) return `panel[${i}].width must be 1 or 2`;
        continue;
      }
      if (typeof v !== "string" || v.trim().length === 0) {
        return `panel[${i}].${field} is required (non-empty string)`;
      }
    }
    if (!isSection && !validSources.has(p.source as string)) {
      return `panel[${i}].source must be 'bigquery', 'ga4', 'amplitude', or 'first-party' (got '${p.source}'). source selects the backend — put the table name in sql, not here.`;
    }
  }
  return null;
}

/**
 * Dry-run each BigQuery panel's SQL so bad column names or type
 * mismatches fail here, with the full BigQuery error text, rather than
 * silently saving a broken dashboard that crashes on render.
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
    "Edit a SQL dashboard config (scope-aware). Prefer this over raw db-patch on the settings table — " +
    "it resolves org vs. user scope correctly so the edit lands on the row the UI actually renders. " +
    "Use `ops` for structural changes (reorder/insert/remove panels, update field values via JSON Pointer paths). " +
    "Use `config` to replace the entire dashboard config. Call `refresh-screen` after to update the UI.",
  schema: z.object({
    dashboardId: z
      .string()
      .describe(
        "Dashboard id (without the `sql-dashboard-` prefix). e.g. 'devrel-leaderboard'",
      ),
    ops: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.array(
          z.object({
            op: z.enum([
              "set",
              "replace",
              "remove",
              "move",
              "move-before",
              "insert",
            ]),
            path: z.string().optional(),
            from: z.string().optional(),
            value: z.unknown().optional(),
          }),
        ),
      )
      .optional()
      .describe(
        "Array of JSON-patch-style ops applied in order (or a JSON string). " +
          "Example reorder: [{op:'move', from:'/panels/2', path:'/panels/0'}]",
      ),
    config: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .optional()
      .describe("Replace the whole dashboard config (or a JSON string)."),
  }),
  http: false,
  run: async (args) => {
    if (!args.ops && !args.config) {
      return "Error: provide either `ops` (for surgical edits) or `config` (for full replace).";
    }
    if (args.ops && args.config) {
      return "Error: provide `ops` OR `config`, not both.";
    }

    const scope = resolveScope();
    const ctx = { email: scope.email, orgId: scope.orgId };

    if (args.config) {
      const validation = validateDashboardConfig(args.config);
      if (validation) return `Error: ${validation}`;
      const sqlError = await validatePanelSql(args.config);
      if (sqlError) return `Error: ${sqlError}`;
      await upsertDashboard(args.dashboardId, "sql", args.config, ctx);
      await syncToCollab(args.dashboardId, args.config);
      return {
        id: args.dashboardId,
        dashboardId: args.dashboardId,
        name:
          typeof args.config.name === "string"
            ? args.config.name
            : args.dashboardId,
        urlPath: `/adhoc/${args.dashboardId}`,
        message: `Dashboard "${args.dashboardId}" replaced.`,
      };
    }

    const existing = await getDashboard(args.dashboardId, ctx);
    if (!existing) {
      return `Error: dashboard "${args.dashboardId}" not found (or you don't have access).`;
    }

    const root = existing.config as any;
    const details: string[] = [];
    for (const op of args.ops!) {
      try {
        details.push(applyJsonOp(root, op as JsonOp));
      } catch (err: any) {
        return `Error applying op ${JSON.stringify(op)}: ${err.message}`;
      }
    }

    const sqlError = await validatePanelSql(root);
    if (sqlError) return `Error: ${sqlError}`;

    await upsertDashboard(
      args.dashboardId,
      existing.kind,
      root as Record<string, unknown>,
      ctx,
    );
    await syncToCollab(args.dashboardId, root as Record<string, unknown>);

    return {
      id: args.dashboardId,
      dashboardId: args.dashboardId,
      name: typeof root.name === "string" ? root.name : args.dashboardId,
      urlPath: `/adhoc/${args.dashboardId}`,
      message:
        `Dashboard "${args.dashboardId}" updated. ` +
        `Applied ${details.length} op(s): ${details.join("; ")}. ` +
        `Call refresh-screen to update the UI.`,
    };
  },
});
