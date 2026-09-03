import { randomUUID } from "node:crypto";

import { getDialect } from "@agent-native/core/db";
import { recordChange } from "@agent-native/core/server";
import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { repairCanonicalFirstPartyDashboardQueries } from "./canonical-first-party-dashboard-repair";
import { FIRST_PARTY_DASHBOARD_ID } from "./first-party-metric-catalog";
import { repairUnboundedFirstPartyPanels } from "./first-party-unbounded-panel-repair.js";

type DashboardRepairRow = {
  id: string;
  config: string;
  kind: string;
  title: string;
  updatedAt: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: string;
};

/**
 * Apply `repairFn` to one already-fetched dashboard row inside a transaction,
 * guarded by an optimistic-concurrency fence on (config, updatedAt) so a
 * concurrent human/agent edit always wins over the repair. Snapshots the
 * pre-repair config into dashboard_revisions (bounded to the 50 most recent)
 * before committing, so any repair is one click away from undo.
 */
async function applyRepairToDashboardRow(
  row: DashboardRepairRow,
  repairFn: (config: Record<string, unknown>) => {
    config: Record<string, unknown>;
    changed: boolean;
  },
): Promise<boolean> {
  const db = getDb() as any;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    return false;
  }
  const repaired = repairFn(config);
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
          eq(schema.dashboards.id, row.id),
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
      "[db] Dashboard repair committed without a live change event:",
      err instanceof Error ? err.message : err,
    );
  }
  return true;
}

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
  return applyRepairToDashboardRow(
    row,
    repairCanonicalFirstPartyDashboardQueries,
  );
}

/**
 * Scan every SQL dashboard (not just the one canonical dashboard above) for
 * first-party panels whose SQL exactly matches a known-unbounded pattern —
 * see first-party-unbounded-panel-repair.ts for how these were found (a
 * full-org audit, 2026-07-25) and why exact-string matching, not a general
 * SQL rewrite, is the safe way to fix panels this repair didn't author.
 * Returns the number of dashboards actually changed.
 */
export async function repairUnboundedFirstPartyPanelsAcrossDashboards(): Promise<number> {
  // guard:allow-unscoped — this explicit operator repair may touch any
  // dashboard's persisted panel SQL. It must never run during server startup:
  // reading every config on each serverless cold start can saturate the
  // database. Exact-string matches and the optimistic (config, updatedAt)
  // fence ensure a concurrent edit always wins.
  const db = getDb() as any;
  const dialect = getDialect();
  const rows = await db
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
    .where(eq(schema.dashboards.kind, "sql"));

  let repairedCount = 0;
  for (const row of rows as DashboardRepairRow[]) {
    if (typeof row.config !== "string") continue;
    try {
      const wasRepaired = await applyRepairToDashboardRow(row, (config) =>
        repairUnboundedFirstPartyPanels(config, dialect),
      );
      if (wasRepaired) repairedCount += 1;
    } catch (err) {
      // One dashboard's malformed config or a lost optimistic-concurrency
      // race must not block repairing every other dashboard.
      console.warn(
        `[db] Unbounded first-party panel repair failed for dashboard "${row.id}" (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return repairedCount;
}
