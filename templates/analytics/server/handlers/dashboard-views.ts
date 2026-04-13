import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import {
  getOrgSetting,
  putOrgSetting,
  getSetting,
  putSetting,
} from "@agent-native/core/settings";
import { getOrgContext } from "@agent-native/core/org";

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
  ctx: { orgId: string | null },
  dashboardId: string,
): Promise<ViewsData> {
  const key = `${KEY_PREFIX}${dashboardId}`;
  let data: Record<string, unknown> | null = null;
  if (ctx.orgId) {
    data = await getOrgSetting(ctx.orgId, key);
  }
  if (!data) {
    data = await getSetting(key);
  }
  return (data as unknown as ViewsData) ?? { views: [] };
}

async function putViewsData(
  ctx: { orgId: string | null },
  dashboardId: string,
  data: ViewsData,
): Promise<void> {
  const key = `${KEY_PREFIX}${dashboardId}`;
  if (ctx.orgId) {
    await putOrgSetting(
      ctx.orgId,
      key,
      data as unknown as Record<string, unknown>,
    );
  } else {
    await putSetting(key, data as unknown as Record<string, unknown>);
  }
}

export const listDashboardViews = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  if (!dashboardId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId" };
  }
  const ctx = await getOrgContext(event);
  const data = await getViewsData(ctx, dashboardId);
  return { views: data.views };
});

export const saveDashboardView = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  if (!dashboardId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId" };
  }
  const ctx = await getOrgContext(event);
  const body = await readBody(event);
  const { id, name, filters } = body as DashboardView;
  if (!id || !name) {
    setResponseStatus(event, 400);
    return { error: "Missing id or name" };
  }

  const data = await getViewsData(ctx, dashboardId);
  const existing = data.views.findIndex((v) => v.id === id);
  const view: DashboardView = {
    id,
    name,
    filters: filters ?? {},
    createdBy: ctx.email,
    createdAt:
      existing >= 0 ? data.views[existing].createdAt : new Date().toISOString(),
  };

  if (existing >= 0) {
    data.views[existing] = view;
  } else {
    data.views.push(view);
  }

  await putViewsData(ctx, dashboardId, data);
  return { success: true, view };
});

export const deleteDashboardView = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  const viewId = getRouterParam(event, "viewId");
  if (!dashboardId || !viewId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId or viewId" };
  }
  const ctx = await getOrgContext(event);
  const data = await getViewsData(ctx, dashboardId);
  data.views = data.views.filter((v) => v.id !== viewId);
  await putViewsData(ctx, dashboardId, data);
  return { success: true };
});
