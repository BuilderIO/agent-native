import { randomUUID } from "node:crypto";

import { recordChange } from "@agent-native/core/server";
import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  FIRST_PARTY_DASHBOARD_ID,
  repairFirstPartyRecurringUserPanels,
} from "./first-party-metric-catalog";

export async function repairPersistedFirstPartyDashboardQueries(): Promise<boolean> {
  // guard:allow-unscoped — startup repair targets one fixed canonical dashboard
  // and only replaces the exact shipped legacy SQL under an optimistic fence.
  const db = getDb() as any;
  const [row] = await db
    .select({
      id: schema.dashboards.id,
      config: schema.dashboards.config,
      kind: schema.dashboards.kind,
      title: schema.dashboards.title,
      updatedAt: schema.dashboards.updatedAt,
      ownerEmail: schema.dashboards.ownerEmail,
      orgId: schema.dashboards.orgId,
      visibility: schema.dashboards.visibility,
    })
    .from(schema.dashboards)
    .where(eq(schema.dashboards.id, FIRST_PARTY_DASHBOARD_ID));
  if (!row || row.kind !== "sql" || typeof row.config !== "string") {
    return false;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    return false;
  }
  const repaired = repairFirstPartyRecurringUserPanels(config);
  if (!repaired.changed) return false;

  const repairedAt = new Date().toISOString();
  const updated = await db
    .update(schema.dashboards)
    .set({
      config: JSON.stringify(repaired.config),
      updatedAt: repairedAt,
      updatedBy: null,
    })
    .where(
      and(
        eq(schema.dashboards.id, FIRST_PARTY_DASHBOARD_ID),
        eq(schema.dashboards.config, row.config),
        eq(schema.dashboards.updatedAt, row.updatedAt),
      ),
    )
    .returning({ id: schema.dashboards.id });
  if (updated.length !== 1) return false;

  await db.insert(schema.dashboardRevisions).values({
    id: `dashrev-${Date.now()}-${randomUUID()}`,
    dashboardId: row.id,
    kind: row.kind,
    title: row.title,
    config: row.config,
    createdAt: repairedAt,
    createdBy: null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
  });
  const revisions = await db
    .select({ id: schema.dashboardRevisions.id })
    .from(schema.dashboardRevisions)
    .where(eq(schema.dashboardRevisions.dashboardId, row.id))
    .orderBy(desc(schema.dashboardRevisions.createdAt));
  for (const revision of revisions.slice(50)) {
    await db
      .delete(schema.dashboardRevisions)
      .where(eq(schema.dashboardRevisions.id, revision.id));
  }

  recordChange({
    source: "dashboards",
    type: "change",
    key: row.id,
    ...(row.visibility === "public"
      ? {}
      : row.visibility === "org" && row.orgId
        ? { orgId: row.orgId }
        : { owner: row.ownerEmail }),
  });
  return true;
}
