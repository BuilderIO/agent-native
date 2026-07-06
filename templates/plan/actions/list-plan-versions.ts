import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { summarizePlanVersionRow } from "../server/lib/plan-versions.js";
import { assertPlanEditor } from "../server/plans.js";

export default defineAction({
  description:
    "List saved history snapshots for an Agent-Native Plan. Use this before inspecting or restoring a plan to an earlier version.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "List Plan Versions",
    description: "List saved version history for a visual plan.",
  },
  run: async ({ planId, limit }) => {
    const access = await assertPlanEditor(planId);

    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    // Project only the small columns + denormalized summary columns instead of
    // `.select()`-ing every row's full `snapshot_json` (the entire plan +
    // sections blob) just to JSON.parse it for a list view. Rows written
    // before the summary columns existed have `blockCount === null`; for
    // those (and only those) we fetch + parse `snapshot_json` below.
    const versions = await db
      .select({
        id: schema.planVersions.id,
        planId: schema.planVersions.planId,
        title: schema.planVersions.title,
        changeLabel: schema.planVersions.changeLabel,
        createdBy: schema.planVersions.createdBy,
        createdAt: schema.planVersions.createdAt,
        status: schema.planVersions.status,
        source: schema.planVersions.source,
        blockCount: schema.planVersions.blockCount,
        sectionCount: schema.planVersions.sectionCount,
        hasCanvas: schema.planVersions.hasCanvas,
        hasPrototype: schema.planVersions.hasPrototype,
        previewText: schema.planVersions.previewText,
      })
      .from(schema.planVersions)
      .where(
        and(
          eq(schema.planVersions.planId, planId),
          eq(schema.planVersions.ownerEmail, ownerEmail),
        ),
      )
      .orderBy(desc(schema.planVersions.createdAt))
      .limit(limit);

    const legacyIds = versions
      .filter((version) => version.blockCount == null)
      .map((version) => version.id);
    const legacySnapshots = legacyIds.length
      ? await db
          .select({
            id: schema.planVersions.id,
            snapshotJson: schema.planVersions.snapshotJson,
          })
          .from(schema.planVersions)
          .where(inArray(schema.planVersions.id, legacyIds))
      : [];
    const legacySnapshotById = new Map(
      legacySnapshots.map((row) => [row.id, row.snapshotJson]),
    );

    return {
      planId,
      count: versions.length,
      versions: versions.map((version) =>
        summarizePlanVersionRow({
          ...version,
          snapshotJson: legacySnapshotById.get(version.id) ?? null,
        }),
      ),
    };
  },
});
