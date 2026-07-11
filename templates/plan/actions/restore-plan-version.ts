import { defineAction } from "@agent-native/core";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isLocalPlanRuntime } from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import {
  createPlanVersionSnapshot,
  parsePlanVersionSnapshot,
} from "../server/lib/plan-versions.js";
import { serializePlanContent } from "../server/plan-content.js";
import {
  assertPlanEditor,
  buildPlanHtml,
  loadPlanBundle,
  newId,
  nowIso,
  planDeepLink,
  planPath,
} from "../server/plans.js";

export default defineAction({
  description:
    "Restore an Agent-Native Plan to a saved history snapshot. The current plan is snapshotted first, so restore is reversible.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    versionId: z.string().describe("Version snapshot ID to restore"),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Restore Plan Version",
    description: "Restore a visual plan from saved version history.",
  },
  run: async ({ planId, versionId }) => {
    const access = await assertPlanEditor(planId);
    const ownerEmail = access.resource.ownerEmail as string;
    // Optimistic-concurrency fence, mirroring the versionAtLoad/updatedAt
    // pattern in update-visual-plan.ts: captured before any restore work
    // starts, then used to guard the leading `plans` UPDATE below so a
    // restore racing a concurrent edit fails cleanly instead of silently
    // clobbering it or interleaving writes.
    const versionAtLoad = (access.resource as typeof schema.plans.$inferSelect)
      .updatedAt;
    const db = getDb();

    const [version] = await db
      .select()
      .from(schema.planVersions)
      .where(
        and(
          eq(schema.planVersions.id, versionId),
          eq(schema.planVersions.planId, planId),
          eq(schema.planVersions.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    if (!version) throw new Error(`Plan version not found: ${versionId}`);

    await createPlanVersionSnapshot(planId, {
      force: true,
      label: "Before restore",
      createdBy: "agent",
    });

    const snapshot = parsePlanVersionSnapshot(version.snapshotJson);
    const now = nowIso();

    // The destructive part of the restore (plans update, comment sectionId
    // nulling, section delete/re-insert, comment re-anchor, and the restore
    // event) runs as a single atomic transaction. Without this, a
    // mid-sequence failure could leave the plan with zero sections and
    // permanently detached comments. better-sqlite3's normally-sync-only
    // transaction() is patched to support async callbacks in
    // packages/core/src/db/create-get-db.ts (patchBetterSqliteTransactions,
    // wired into createGetDb for local sqlite urls), so this is safe on the
    // local driver as well as libsql/Postgres.
    await db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(schema.plans)
        .set({
          title: snapshot.plan.title,
          brief: snapshot.plan.brief,
          status: snapshot.plan.status,
          source: snapshot.plan.source,
          repoPath: snapshot.plan.repoPath ?? null,
          currentFocus: snapshot.plan.currentFocus ?? null,
          html: snapshot.plan.html ?? null,
          markdown: snapshot.plan.markdown ?? null,
          content: snapshot.plan.content
            ? serializePlanContent(snapshot.plan.content)
            : null,
          approvedAt: snapshot.plan.approvedAt ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.plans.id, planId),
            eq(schema.plans.updatedAt, versionAtLoad),
          ),
        )
        .returning({ id: schema.plans.id });

      if (updatedRows.length === 0) {
        throw new Error(
          "This plan was updated by someone else while the restore was being prepared. Reload the plan and try restoring again.",
        );
      }

      // Preserve comment anchors for sections whose ids survive in the snapshot.
      // Strategy: capture comment→sectionId pairs for surviving sections first,
      // then null ALL sectionIds (required to satisfy FK before section deletion),
      // delete and re-insert sections, then re-anchor the surviving comments.
      const survivingSectionIds = new Set(snapshot.sections.map((s) => s.id));
      const commentAnchorMap = new Map<string, string>(); // commentId → sectionId
      if (survivingSectionIds.size > 0) {
        const anchored = await tx
          .select({
            id: schema.planComments.id,
            sectionId: schema.planComments.sectionId,
          })
          .from(schema.planComments)
          .where(
            and(
              eq(schema.planComments.planId, planId),
              inArray(
                schema.planComments.sectionId,
                Array.from(survivingSectionIds),
              ),
            ),
          );
        for (const row of anchored) {
          if (row.sectionId) commentAnchorMap.set(row.id, row.sectionId);
        }
      }

      // Null ALL comment anchors so the section delete below doesn't violate FK.
      await tx
        .update(schema.planComments)
        .set({ sectionId: null, updatedAt: now })
        .where(eq(schema.planComments.planId, planId));

      await tx
        .delete(schema.planSections)
        .where(eq(schema.planSections.planId, planId));

      if (snapshot.sections.length > 0) {
        await tx.insert(schema.planSections).values(
          snapshot.sections.map((section, index) => ({
            id: section.id,
            planId,
            type: section.type,
            title: section.title,
            body: section.body,
            html: section.html ?? null,
            order: section.order ?? index,
            createdBy: section.createdBy,
            createdAt: section.createdAt || now,
            updatedAt: section.updatedAt || now,
          })),
        );
      }

      // Re-anchor comments that were pointing to sections present in the snapshot.
      // These sections now exist again, so the FK is satisfied and the comment
      // threads remain navigable. Comments on sections that did not survive stay
      // detached (sectionId = null).
      if (commentAnchorMap.size > 0) {
        const anchorGroups = new Map<string, string[]>(); // sectionId → commentIds
        for (const [commentId, sectionId] of commentAnchorMap) {
          const ids = anchorGroups.get(sectionId) ?? [];
          ids.push(commentId);
          anchorGroups.set(sectionId, ids);
        }
        for (const [sectionId, commentIds] of anchorGroups) {
          await tx
            .update(schema.planComments)
            .set({ sectionId, updatedAt: now })
            .where(
              and(
                eq(schema.planComments.planId, planId),
                inArray(schema.planComments.id, commentIds),
              ),
            );
        }
      }

      await tx.insert(schema.planEvents).values({
        id: newId("evt"),
        planId,
        type: "plan.version.restored",
        message: "Restored plan from version history.",
        payload: JSON.stringify({
          restoredVersionId: version.id,
          restoredVersionCreatedAt: version.createdAt,
        }),
        createdBy: "agent",
        createdAt: now,
      });
    });

    const bundle = await loadPlanBundle(planId);
    const local = isLocalPlanRuntime()
      ? await writePlanLocalFiles({
          planId: bundle.plan.id,
          title: bundle.plan.title,
          brief: bundle.plan.brief,
          content: bundle.plan.content,
          url: planPath(bundle.plan.id, bundle.plan.kind),
        })
      : null;

    return {
      ...bundle,
      planId: bundle.plan.id,
      restoredVersionId: version.id,
      html: buildPlanHtml(bundle),
      path: planPath(bundle.plan.id, bundle.plan.kind),
      url: planPath(bundle.plan.id, bundle.plan.kind),
      ...(local?.written ? { localFiles: local } : {}),
    };
  },
  link: ({ args }) => ({
    url: planDeepLink(args.planId),
    label: "Open Restored Plan",
    view: "plan",
  }),
});
