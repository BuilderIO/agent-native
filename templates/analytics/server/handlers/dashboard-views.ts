import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { readBody } from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import {
  listDashboardViews as loadViews,
  saveDashboardView as storeView,
  deleteDashboardView as removeView,
} from "../lib/dashboards-store";

async function ctxFromEvent(event: any) {
  const ctx = await getOrgContext(event);
  return { email: ctx.email, orgId: ctx.orgId ?? null };
}

export interface DashboardView {
  id: string;
  name: string;
  /** Filter params to apply (e.g. { "f_recentOnly": "2026-01-01" }) */
  filters: Record<string, string>;
  createdBy?: string;
  createdAt?: string;
}

export const listDashboardViews = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  if (!dashboardId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    const views = await loadViews(dashboardId, ctx);
    return { views };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const saveDashboardView = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  if (!dashboardId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    const body = await readBody(event);
    const { id, name, filters } = body as DashboardView;
    if (!name) {
      setResponseStatus(event, 400);
      return { error: "Missing name" };
    }
    const view = await storeView(
      dashboardId,
      { id, name, filters: filters ?? {} },
      ctx,
    );
    return { success: true, view };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const deleteDashboardView = defineEventHandler(async (event) => {
  const dashboardId = getRouterParam(event, "dashboardId");
  const viewId = getRouterParam(event, "viewId");
  if (!dashboardId || !viewId) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboardId or viewId" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    await removeView(dashboardId, viewId, ctx);
    return { success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});
