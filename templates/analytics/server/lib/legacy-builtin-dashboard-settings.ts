import { createHash } from "node:crypto";

import { table, text } from "@agent-native/core/db/schema";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { SEED_BUILTIN_DASHBOARD_IDS } from "../../shared/builtin-dashboard-ids";
import { normalizeDashboardConfig } from "../../shared/dashboard-config-normalization";
import { getDb, schema } from "../db/index.js";

const legacySettings = table("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
const legacyOrganizations = table("organizations", {
  id: text("id").primaryKey(),
  createdBy: text("created_by").notNull(),
});
const BATCH_SIZE = 200;

export function legacyBuiltinDashboardCopyId(id: string, key: string): string {
  return `${id}-legacy-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

/** Materialize every scoped seed copy before the deploy pass classifies it. */
export async function materializeLegacyBuiltinDashboardSettings(
  options: { dryRun?: boolean } = {},
): Promise<{ scanned: number; materialized: number }> {
  const db = getDb() as any;
  let scanned = 0;
  let materialized = 0;
  let cursor = "";
  for (;;) {
    const batch: Array<{ key: string; value: string }> = await db
      .select()
      .from(legacySettings)
      .where(
        and(
          gt(legacySettings.key, cursor),
          or(
            ...SEED_BUILTIN_DASHBOARD_IDS.map(
              (id) =>
                sql`${legacySettings.key} LIKE ${`%:sql-dashboard-${id}`}`,
            ),
          ),
        ),
      )
      .orderBy(asc(legacySettings.key))
      .limit(BATCH_SIZE);
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].key;
    for (const { key, value } of batch) {
      const scoped = /^([uo]):([^:]+):sql-dashboard-(.+)$/.exec(key);
      if (
        !scoped ||
        !(SEED_BUILTIN_DASHBOARD_IDS as readonly string[]).includes(scoped[3])
      )
        continue;
      scanned++;
      const copyId = legacyBuiltinDashboardCopyId(scoped[3], key);
      const [checked] = await db
        .select({ id: schema.analyticsBuiltinDashboardChecks.dashboardId })
        .from(schema.analyticsBuiltinDashboardChecks)
        .where(eq(schema.analyticsBuiltinDashboardChecks.dashboardId, copyId))
        .limit(1);
      // Retained settings are a backup once classified, including after a saved copy is deleted.
      if (checked) continue;
      const orgId = scoped[1] === "o" ? scoped[2] : null;
      // Older lazy migrations retained settings; their SQL row stays authoritative after visibility changes.
      const [saved] = await db
        .select({ id: schema.dashboards.id })
        .from(schema.dashboards)
        .where(
          and(
            eq(schema.dashboards.id, scoped[3]),
            orgId
              ? eq(schema.dashboards.orgId, orgId)
              : and(
                  eq(schema.dashboards.ownerEmail, scoped[2]),
                  isNull(schema.dashboards.orgId),
                ),
          ),
        )
        .limit(1);
      if (saved) continue;
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Legacy dashboard setting ${key} is not an object.`);
      }
      const config = normalizeDashboardConfig(
        parsed as Record<string, unknown>,
      );
      let ownerEmail = scoped[2];
      if (orgId) {
        const [org] = await db
          .select({ createdBy: legacyOrganizations.createdBy })
          .from(legacyOrganizations)
          .where(eq(legacyOrganizations.id, orgId))
          .limit(1);
        if (!org || typeof org.createdBy !== "string" || !org.createdBy)
          throw new Error(
            `Legacy dashboard setting ${key} references a missing organization.`,
          );
        ownerEmail = org.createdBy;
      }
      if (options.dryRun) continue;
      const createdAt =
        typeof config.createdAt === "string"
          ? config.createdAt
          : new Date().toISOString();
      const updatedAt =
        typeof config.updatedAt === "string" ? config.updatedAt : createdAt;
      // Seed ids were reused in every settings scope; their saved copies need distinct ids.
      const inserted = await db
        .insert(schema.dashboards)
        .values({
          id: copyId,
          kind: "sql",
          title:
            typeof config.name === "string"
              ? config.name
              : typeof config.title === "string"
                ? config.title
                : "Untitled",
          config: JSON.stringify(config),
          ownerEmail,
          orgId,
          visibility: orgId ? "org" : "private",
          createdAt,
          updatedAt,
        })
        .onConflictDoNothing()
        .returning({ id: schema.dashboards.id });
      materialized += inserted.length;
    }
  }
  return { scanned, materialized };
}
