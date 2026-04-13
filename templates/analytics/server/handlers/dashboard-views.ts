import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import {
  getScopedSettingRecord,
  putScopedSettingRecord,
  resolveSettingsScope,
} from "../lib/scoped-settings";

const KEY_PREFIX = "dashboard-views-";

export interface DashboardView {
  id: string;
  name: string;
  /** Filter params to apply (e.g. { "f_recentOnly": "2026-01-01" }) */
  filters: Record<string, string>;
  createdBy?: string;
  createdAt?: string;
}

interface ViewsData {
  views: DashboardView[];
}

async function getViewsData(
  scope: { email: string; orgId: string | null },
  dashboardId: string,
): Promise<ViewsData> {
  const key = `${KEY_PREFIX}${dashboardId}`;
  const data = await getScopedSettingRecord(scope, key);
  return (data as unknown as ViewsData) ?? { views: [] };
}

async function putViewsData(
  scope: { email: string; orgId: string | null },
  dashboardId: string,
  data: ViewsData,
): Promise<void> {
  const key = `${KEY_PREFIX}${dashboardId}`;
  await putScopedSettingRecord(
    scope,
    key,
    data as unknown as Record<string, unknown>,
  );
}

export const listDashboardViews = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  if (!dashboardId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId" };
  }
  const scope = await resolveSettingsScope(event);
  const data = await getViewsData(scope, dashboardId);
  return { views: data.views };
});

export const saveDashboardView = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  if (!dashboardId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId" };
  }
  const scope = await resolveSettingsScope(event);
  const body = await readBody(event);
  const { id, name, filters } = body as DashboardView;
  if (!id || !name) {
    setResponseStatus(event, 400);
    return { error: "Missing id or name" };
  }

  const data = await getViewsData(scope, dashboardId);
  const existing = data.views.findIndex((v) => v.id === id);
  const view: DashboardView = {
    id,
    name,
    filters: filters ?? {},
    createdBy: scope.email,
    createdAt:
      existing >= 0 ? data.views[existing].createdAt : new Date().toISOString(),
  };

  if (existing >= 0) {
    data.views[existing] = view;
  } else {
    data.views.push(view);
  }

  await putViewsData(scope, dashboardId, data);
  return { success: true, view };
});

export const deleteDashboardView = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  const viewId = getRouterParam(event, "viewId");
  if (!dashboardId || !viewId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId or viewId" };
  }
  const scope = await resolveSettingsScope(event);
  const data = await getViewsData(scope, dashboardId);
  data.views = data.views.filter((v) => v.id !== viewId);
  await putViewsData(scope, dashboardId, data);
  return { success: true };
});
