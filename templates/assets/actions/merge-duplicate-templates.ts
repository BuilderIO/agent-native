import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { parseJson } from "../server/lib/json.js";
import {
  assertOrgAdmin,
  ForbiddenAuditError,
} from "../server/lib/org-admin.js";

type Candidate = {
  id: string;
  createdAt: string;
  updatedAt: string;
  settings: string;
};

function ownedTemplateScope(ownerEmail: string, orgId: string | undefined) {
  return and(
    eq(schema.assetTemplates.ownerEmail, ownerEmail),
    orgId
      ? eq(schema.assetTemplates.orgId, orgId)
      : isNull(schema.assetTemplates.orgId),
  );
}

export async function listMigrationOrphansForAuditAdmin(
  db: any,
): Promise<Array<{ id: string }>> {
  let scope;
  try {
    scope = await assertOrgAdmin();
  } catch (error) {
    // Merging a caller's own default templates is not an audit operation. A
    // non-admin simply must not receive cross-owner migration diagnostics.
    if (error instanceof ForbiddenAuditError) return [];
    throw error;
  }
  if (!scope.orgId) return [];
  return db
    .select({ id: schema.assetTemplates.id })
    .from(schema.assetTemplates)
    .where(
      and(
        eq(schema.assetTemplates.ownerEmail, "migration-orphan@invalid.local"),
        eq(schema.assetTemplates.orgId, scope.orgId),
      ),
    );
}

export default defineAction({
  description:
    "Explicitly merge untouched duplicate default templates for the current owner. Referenced templates are kept and reported.",
  schema: z.object({ dryRun: z.boolean().default(false) }),
  run: async ({ dryRun }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Not authenticated");
    const orgId = getRequestOrgId();
    const db = getDb();
    const rows = (await db
      .select()
      .from(schema.assetTemplates)
      .where(ownedTemplateScope(ownerEmail, orgId))) as Candidate[];
    const groups = new Map<string, Candidate[]>();
    for (const row of rows) {
      const settings = parseJson<{ seedId?: unknown; source?: unknown }>(
        row.settings,
        {},
      );
      if (
        typeof settings.seedId !== "string" ||
        settings.source !== "default-generation-preset" ||
        row.createdAt !== row.updatedAt
      ) {
        continue;
      }
      groups.set(settings.seedId, [
        ...(groups.get(settings.seedId) ?? []),
        row,
      ]);
    }
    const merged: Array<{ keptId: string; deletedIds: string[] }> = [];
    const kept: Array<{ id: string; reason: string }> = [];
    for (const candidates of groups.values()) {
      if (candidates.length < 2) continue;
      const sorted = [...candidates].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      const [winner, ...duplicates] = sorted;
      const referencedIds = duplicates.map((row) => row.id);
      const [sessionReferences, runReferences, shareReferences] =
        referencedIds.length
          ? await Promise.all([
              db
                .select({ presetId: schema.assetGenerationSessions.presetId })
                .from(schema.assetGenerationSessions)
                .where(
                  inArray(
                    schema.assetGenerationSessions.presetId,
                    referencedIds,
                  ),
                ),
              db
                .select({ presetId: schema.assetGenerationRuns.presetId })
                .from(schema.assetGenerationRuns)
                .where(
                  inArray(schema.assetGenerationRuns.presetId, referencedIds),
                ),
              db
                .select({ resourceId: schema.assetTemplateShares.resourceId })
                .from(schema.assetTemplateShares)
                .where(
                  inArray(schema.assetTemplateShares.resourceId, referencedIds),
                ),
            ])
          : [[], [], []];
      const generationReferencedIds = new Set(
        [...sessionReferences, ...runReferences]
          .map((row) => row.presetId)
          .filter((id): id is string => typeof id === "string"),
      );
      const sharedIds = new Set(
        shareReferences
          .map((row) => row.resourceId)
          .filter((id): id is string => typeof id === "string"),
      );
      const protectedIds = new Set([...generationReferencedIds, ...sharedIds]);
      const deletable = duplicates.filter((row) => !protectedIds.has(row.id));
      for (const row of duplicates) {
        if (generationReferencedIds.has(row.id)) {
          kept.push({
            id: row.id,
            reason: "Referenced by a generation run or session.",
          });
        } else if (sharedIds.has(row.id)) {
          kept.push({ id: row.id, reason: "Has explicit shares." });
        }
      }
      if (!deletable.length) continue;
      if (!dryRun) {
        await db
          .update(schema.assetTemplates)
          .set({ libraryId: null, collectionId: null })
          .where(
            and(
              eq(schema.assetTemplates.id, winner.id),
              ownedTemplateScope(ownerEmail, orgId),
            ),
          );
        await db.delete(schema.assetTemplates).where(
          and(
            ownedTemplateScope(ownerEmail, orgId),
            inArray(
              schema.assetTemplates.id,
              deletable.map((row) => row.id),
            ),
          ),
        );
      }
      merged.push({
        keptId: winner.id,
        deletedIds: deletable.map((row) => row.id),
      });
    }
    const migrationOrphans = await listMigrationOrphansForAuditAdmin(db);
    return {
      dryRun,
      merged,
      kept,
      migrationOrphans: migrationOrphans.map((row) => row.id),
    };
  },
});
