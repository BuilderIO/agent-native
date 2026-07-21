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
  const revisionId = `dashrev-${Date.now()}-${randomUUID()}`;
  const changed = await db.transaction(async (tx: any) => {
    const updated = await tx
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

    await tx.insert(schema.dashboardRevisions).values({
      id: revisionId,
      dashboardId: row.id,
      kind: row.kind,
      title: row.title,
      config: row.config,
      createdAt: repairedAt,
      createdBy: null,
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
    });
    const revisions = await tx
      .select({ id: schema.dashboardRevisions.id })
      .from(schema.dashboardRevisions)
      .where(eq(schema.dashboardRevisions.dashboardId, row.id))
      .orderBy(
        desc(schema.dashboardRevisions.createdAt),
        desc(schema.dashboardRevisions.id),
      );
    const retainedRevisionIds = new Set([revisionId]);
    for (const revision of revisions) {
      if (retainedRevisionIds.size >= 50) break;
      retainedRevisionIds.add(revision.id);
    }
    for (const revision of revisions) {
      if (retainedRevisionIds.has(revision.id)) continue;
      await tx
        .delete(schema.dashboardRevisions)
        .where(eq(schema.dashboardRevisions.id, revision.id));
    }
    return true;
  });
  if (!changed) return false;

  try {
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
  } catch (err) {
    console.warn(
      "[db] Canonical dashboard repair committed without a live change event:",
      err instanceof Error ? err.message : err,
    );
  }
  return true;
}
