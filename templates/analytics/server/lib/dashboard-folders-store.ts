import { recordChange } from "@agent-native/core/server";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { desc, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { type DashboardRecord, getDashboard } from "./dashboards-store.js";

export type DashboardFolderScope = "personal" | "shared";

export interface DashboardFolderContext {
  email: string;
  orgId: string | null;
}

export interface DashboardFolderRecord {
  id: string;
  name: string;
  scope: DashboardFolderScope;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toFolder(row: any): DashboardFolderRecord {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listDashboardFolders(
  ctx: DashboardFolderContext,
): Promise<DashboardFolderRecord[]> {
  const rows = await (getDb() as any)
    .select()
    .from(schema.dashboardFolders)
    .where(
      accessFilter(schema.dashboardFolders, schema.dashboardFolderShares, {
        userEmail: ctx.email,
        orgId: ctx.orgId ?? undefined,
      }),
    )
    .orderBy(desc(schema.dashboardFolders.updatedAt));
  return rows.map(toFolder);
}

export async function createDashboardFolder(
  name: string,
  scope: DashboardFolderScope,
  ctx: DashboardFolderContext,
): Promise<DashboardFolderRecord> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("folder name is required");
  if (scope === "shared" && !ctx.orgId) {
    throw new Error("an active organization is required for shared folders");
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  const folderOrgId = scope === "shared" ? ctx.orgId : null;
  await (getDb() as any).insert(schema.dashboardFolders).values({
    id,
    name: trimmedName,
    scope,
    createdAt: now,
    updatedAt: now,
    ownerEmail: ctx.email,
    orgId: folderOrgId,
    visibility: scope === "shared" ? "org" : "private",
  });
  recordChange({
    source: "dashboard-folders",
    type: "change",
    key: id,
    ...(scope === "shared" && ctx.orgId
      ? { orgId: ctx.orgId }
      : { owner: ctx.email }),
  });
  return {
    id,
    name: trimmedName,
    scope,
    ownerEmail: ctx.email,
    orgId: folderOrgId,
    visibility: scope === "shared" ? "org" : "private",
    createdAt: now,
    updatedAt: now,
  };
}

async function getFolder(
  id: string,
  ctx: DashboardFolderContext,
): Promise<DashboardFolderRecord> {
  await assertAccess("dashboard-folder", id, "viewer", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  const [row] = await (getDb() as any)
    .select()
    .from(schema.dashboardFolders)
    .where(eq(schema.dashboardFolders.id, id))
    .limit(1);
  if (!row) throw new Error("dashboard folder not found");
  return toFolder(row);
}

export async function assignDashboardToFolder(
  dashboardId: string,
  folderId: string | null,
  ctx: DashboardFolderContext,
): Promise<DashboardRecord> {
  const dashboard = await getDashboard(dashboardId, ctx);
  if (!dashboard) throw new Error("dashboard not found or inaccessible");
  await assertAccess("dashboard", dashboardId, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });

  if (folderId) {
    const folder = await getFolder(folderId, ctx);
    if (folder.scope === "personal") {
      if (
        dashboard.visibility !== "private" ||
        dashboard.ownerEmail.toLowerCase() !== ctx.email.toLowerCase()
      ) {
        throw new Error("personal folders require an owned private dashboard");
      }
    } else if (
      dashboard.visibility !== "org" ||
      !ctx.orgId ||
      dashboard.orgId !== ctx.orgId ||
      folder.orgId !== ctx.orgId
    ) {
      throw new Error("shared folders require an org-visible dashboard");
    }
  }

  await (getDb() as any)
    .update(schema.dashboards)
    .set({ folderId, updatedAt: nowIso(), updatedBy: ctx.email })
    .where(eq(schema.dashboards.id, dashboardId));
  recordChange({
    source: "dashboards",
    type: "change",
    key: dashboardId,
    ...((dashboard.visibility === "org" && dashboard.orgId
      ? { orgId: dashboard.orgId }
      : { owner: dashboard.ownerEmail }) as {
      owner?: string;
      orgId?: string;
    }),
  });
  const updated = await getDashboard(dashboardId, ctx);
  if (!updated) throw new Error("dashboard disappeared after folder update");
  return updated;
}
