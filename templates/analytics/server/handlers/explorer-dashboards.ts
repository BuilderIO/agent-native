import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import {
  deleteScopedSettingRecord,
  getScopedSettingRecord,
  listScopedSettingRecords,
  putScopedSettingRecord,
  resolveSettingsScope,
} from "../lib/scoped-settings";

const KEY_PREFIX = "dashboard-";

export const listExplorerDashboards = defineEventHandler(async (event) => {
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

export const getExplorerDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  try {
    const scope = await resolveSettingsScope(event);
    const data = await getScopedSettingRecord(scope, `${KEY_PREFIX}${id}`);
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

export const saveExplorerDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  try {
    const body = await readBody(event);
    const scope = await resolveSettingsScope(event);
    await putScopedSettingRecord(
      scope,
      `${KEY_PREFIX}${id}`,
      body as Record<string, unknown>,
    );
    return { id, success: true };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const deleteExplorerDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const scope = await resolveSettingsScope(event);
  await deleteScopedSettingRecord(scope, `${KEY_PREFIX}${id}`);
  return { id, success: true };
});
