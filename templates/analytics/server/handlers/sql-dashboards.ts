import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import {
  getSetting,
  putSetting,
  deleteSetting,
  getAllSettings,
  getOrgSetting,
  putOrgSetting,
  deleteOrgSetting,
  listOrgSettings,
} from "@agent-native/core/settings";
import { getOrgContext } from "@agent-native/core/org";

const KEY_PREFIX = "sql-dashboard-";

/**
 * Dashboards are scoped to the user's active org. When a user has no org
 * (solo / dev mode), we fall back to the global key for backwards compatibility
 * with dashboards seeded before org scoping landed.
 */

export const listSqlDashboards = defineEventHandler(async (event) => {
  try {
    const ctx = await getOrgContext(event);

    // Always include legacy global dashboards as a fallback so pre-org rows
    // remain visible. Org rows take precedence on id collisions. Keys with
    // u: or o: prefixes are filtered out by the sql-dashboard- prefix check.
    const all = await getAllSettings();
    const byId = new Map<string, Record<string, unknown>>();
    for (const [key, data] of Object.entries(all)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      byId.set(key.slice(KEY_PREFIX.length), data);
    }

    if (ctx.orgId) {
      const orgRows = await listOrgSettings(ctx.orgId, KEY_PREFIX);
      for (const [key, data] of Object.entries(orgRows)) {
        byId.set(key.slice(KEY_PREFIX.length), data);
      }
    }

    const dashboards = Array.from(byId.entries()).map(([id, data]) => ({
      id,
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
    const ctx = await getOrgContext(event);
    const key = `${KEY_PREFIX}${id}`;
    let data = ctx.orgId ? await getOrgSetting(ctx.orgId, key) : null;
    if (!data) {
      // Fallback to global (legacy) so pre-org dashboards keep loading
      data = await getSetting(key);
    }
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
    const body = await readBody(event);
    const ctx = await getOrgContext(event);
    const key = `${KEY_PREFIX}${id}`;
    if (ctx.orgId) {
      await putOrgSetting(ctx.orgId, key, body);
    } else {
      await putSetting(key, body);
    }
    return { id, success: true };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const deleteSqlDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  const ctx = await getOrgContext(event);
  const key = `${KEY_PREFIX}${id}`;
  if (ctx.orgId) {
    await deleteOrgSetting(ctx.orgId, key);
    // Also wipe any pre-org legacy global row, otherwise list/get fallback
    // logic will resurrect the dashboard after refresh.
    await deleteSetting(key);
  } else {
    await deleteSetting(key);
  }
  return { id, success: true };
});
