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
    const body = await readBody(event);
    const scope = await resolveSettingsScope(event);
    const key = `${KEY_PREFIX}${id}`;
    await putScopedSettingRecord(scope, key, body as Record<string, unknown>);
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
  const scope = await resolveSettingsScope(event);
  const key = `${KEY_PREFIX}${id}`;
  await deleteScopedSettingRecord(scope, key);
  return { id, success: true };
});
