import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import {
  deleteScopedSettingRecord,
  getScopedSettingRecord,
  listScopedSettingRecords,
  putScopedSettingRecord,
  resolveSettingsScope,
} from "../lib/scoped-settings";

const KEY_PREFIX = "sql-dashboard-";

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
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i] as Record<string, unknown> | null;
      if (!p || typeof p !== "object") return `panel[${i}] must be an object`;
      for (const field of requiredStrings) {
        const v = p[field];
        if (typeof v !== "string" || v.trim().length === 0) {
          return `panel[${i}].${field} is required`;
        }
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
