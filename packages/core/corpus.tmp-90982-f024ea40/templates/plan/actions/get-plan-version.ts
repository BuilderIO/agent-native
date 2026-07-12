import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parsePlanVersionSnapshot,
  summarizePlanVersion,
} from "../server/lib/plan-versions.js";
import {
  assertPlanEditor,
  buildPlanHtml,
  summarizePlan,
} from "../server/plans.js";
import type { Plan, PlanBundle } from "../shared/types.js";

export default defineAction({
  description:
    "Get one saved Agent-Native Plan history snapshot, including full plan content for preview before restore.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    versionId: z.string().describe("Version snapshot ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Plan Version",
    description: "Read one saved version of a visual plan.",
  },
  run: async ({ planId, versionId }) => {
    const access = await assertPlanEditor(planId);

    const ownerEmail = access.resource.ownerEmail as string;
    const [version] = await getDb()
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

    const snapshot = parsePlanVersionSnapshot(version.snapshotJson);
    const current = access.resource as typeof schema.plans.$inferSelect;
    const plan: Plan = {
      id: planId,
      title: snapshot.plan.title,
      brief: snapshot.plan.brief,
      // kind is a property of the plan, not of the versioned snapshot content.
      kind: current.kind ?? "plan",
      status: snapshot.plan.status,
      source: snapshot.plan.source,
      repoPath: snapshot.plan.repoPath,
      currentFocus: snapshot.plan.currentFocus,
      hostedPlanId: current.hostedPlanId,
      hostedPlanUrl: current.hostedPlanUrl,
      html: snapshot.plan.html,
      markdown: snapshot.plan.markdown,
      content: snapshot.plan.content,
      createdAt: current.createdAt,
      updatedAt: version.createdAt,
      approvedAt: snapshot.plan.approvedAt,
    };
    const sections = snapshot.sections.map((section) => ({
      ...section,
      planId,
    }));
    const bundle: PlanBundle = {
      plan,
      sections,
      comments: [],
      events: [],
      summary: summarizePlan(sections, []),
    };

    return {
      ...summarizePlanVersion(version),
      snapshot: { ...snapshot, sections },
      plan,
      sections,
      html: buildPlanHtml(bundle),
      markdown: snapshot.plan.markdown,
    };
  },
});
