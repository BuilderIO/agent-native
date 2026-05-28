import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseStatus,
} from "h3";
import { readBody } from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import {
  getDashboard,
  listDashboards,
  upsertDashboard,
  removeDashboard,
  archiveDashboard,
  unarchiveDashboard,
  type DashboardArchiveFilter,
} from "../lib/dashboards-store";

async function ctxFromEvent(event: any) {
  const ctx = await getOrgContext(event);
  return { email: ctx.email, orgId: ctx.orgId ?? null };
}

function parseArchivedFilter(raw: unknown): DashboardArchiveFilter {
  if (raw === "1" || raw === "true" || raw === "only" || raw === "archived")
    return "archived";
  if (raw === "all") return "all";
  return "active";
}

export const listExplorerDashboards = defineEventHandler(async (event) => {
  try {
    const ctx = await ctxFromEvent(event);
    const archived = parseArchivedFilter(getQuery(event).archived);
    const rows = await listDashboards(ctx, { kind: "explorer", archived });
    const dashboards = rows.map((d) => ({
      id: d.id,
      ...(d.config as Record<string, unknown>),
      ownerEmail: d.ownerEmail,
      orgId: d.orgId,
      visibility: d.visibility,
      archivedAt: d.archivedAt,
    }));
    return { dashboards };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const getExplorerDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    const dash = await getDashboard(id, ctx);
    if (!dash || dash.kind !== "explorer") {
      setResponseStatus(event, 404);
      return { error: "Dashboard not found" };
    }
    return {
      id,
      ...(dash.config as Record<string, unknown>),
      ownerEmail: dash.ownerEmail,
      orgId: dash.orgId,
      visibility: dash.visibility,
      role: dash.role,
      canEdit: dash.canEdit,
      canManage: dash.canManage,
      archivedAt: dash.archivedAt,
    };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const saveExplorerDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const body = (await readBody(event)) as Record<string, unknown>;
    const ctx = await ctxFromEvent(event);
    await upsertDashboard(id, "explorer", body, ctx);
    return { id, success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const deleteExplorerDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    await removeDashboard(id, ctx);
    return { id, success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const archiveExplorerDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    const dash = await archiveDashboard(id, ctx);
    if (!dash) {
      setResponseStatus(event, 404);
      return { error: "Dashboard not found" };
    }
    return { id, archivedAt: dash.archivedAt, success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const unarchiveExplorerDashboard = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing dashboard id" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    const dash = await unarchiveDashboard(id, ctx);
    if (!dash) {
      setResponseStatus(event, 404);
      return { error: "Dashboard not found" };
    }
    return { id, archivedAt: dash.archivedAt, success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});
