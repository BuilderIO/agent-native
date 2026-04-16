import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getOrgSetting,
  getSetting,
  getUserSetting,
  putOrgSetting,
  putSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import { dryRunQuery } from "../server/lib/bigquery";

const KEY_PREFIX = "sql-dashboard-";
const LOCAL_EMAIL = "local@localhost";

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
  const validSources = new Set(["bigquery", "app-db"]);
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i] as Record<string, unknown> | null;
    if (!p || typeof p !== "object") {
      return `panel[${i}] must be an object`;
    }
    const required = [
      "id",
      "title",
      "sql",
      "source",
      "chartType",
      "width",
    ] as const;
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
    if (!validSources.has(p.source as string)) {
      return `panel[${i}].source must be 'bigquery' or 'app-db' (got '${p.source}'). source selects the backend — put the table name in sql, not here.`;
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
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i] as Record<string, unknown>;
    if (p.source !== "bigquery") continue;
    const sql = typeof p.sql === "string" ? p.sql : "";
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
  const orgId = process.env.AGENT_ORG_ID || null;
  const email = process.env.AGENT_USER_EMAIL || LOCAL_EMAIL;
  return { orgId, email };
}

async function readScoped(
  scope: { orgId: string | null; email: string },
  key: string,
): Promise<{
  value: Record<string, unknown>;
  scope: "org" | "user" | "global";
} | null> {
  if (scope.orgId) {
    const v = await getOrgSetting(scope.orgId, key);
    if (v) return { value: v, scope: "org" };
  }
  if (scope.email && scope.email !== LOCAL_EMAIL) {
    const v = await getUserSetting(scope.email, key);
    if (v) return { value: v, scope: "user" };
  }
  const v = await getSetting(key);
  return v ? { value: v, scope: "global" } : null;
}

async function writeScoped(
  scope: { orgId: string | null; email: string },
  key: string,
  value: Record<string, unknown>,
  resolvedScope: "org" | "user" | "global",
): Promise<void> {
  // Write back to the SAME scope we read from so we don't create drift.
  if (resolvedScope === "org" && scope.orgId) {
    await putOrgSetting(scope.orgId, key, value);
    return;
  }
  if (resolvedScope === "user" && scope.email && scope.email !== LOCAL_EMAIL) {
    await putUserSetting(scope.email, key, value);
    return;
  }
  await putSetting(key, value);
}

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
        z.record(z.unknown()),
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
    const key = `${KEY_PREFIX}${args.dashboardId}`;

    if (args.config) {
      const validation = validateDashboardConfig(args.config);
      if (validation) return `Error: ${validation}`;
      const sqlError = await validatePanelSql(args.config);
      if (sqlError) return `Error: ${sqlError}`;
      const existing = await readScoped(scope, key);
      const resolvedScope = existing?.scope ?? (scope.orgId ? "org" : "user");
      await writeScoped(scope, key, args.config, resolvedScope as any);
      return `Dashboard "${args.dashboardId}" replaced (scope: ${resolvedScope}).`;
    }

    const existing = await readScoped(scope, key);
    if (!existing) {
      return `Error: dashboard "${args.dashboardId}" not found in org, user, or global scope.`;
    }

    const root = existing.value as any;
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

    await writeScoped(scope, key, root, existing.scope);

    return (
      `Dashboard "${args.dashboardId}" updated (scope: ${existing.scope}). ` +
      `Applied ${details.length} op(s): ${details.join("; ")}. ` +
      `Call refresh-screen to update the UI.`
    );
  },
});
