import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { serializePlanContent } from "../server/plan-content.js";
import { isLocalPlanRuntime } from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import {
  createPlanVersionSnapshot,
  parsePlanVersionSnapshot,
} from "../server/lib/plan-versions.js";
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

    await db
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
      .where(eq(schema.plans.id, planId));

    await db
      .update(schema.planComments)
      .set({ sectionId: null, updatedAt: now })
      .where(eq(schema.planComments.planId, planId));

    await db
      .delete(schema.planSections)
      .where(eq(schema.planSections.planId, planId));

    if (snapshot.sections.length > 0) {
      await db.insert(schema.planSections).values(
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

    await db.insert(schema.planEvents).values({
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
