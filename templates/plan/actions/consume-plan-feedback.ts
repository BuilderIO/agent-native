import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertPlanEditor, nowIso, writeEvent } from "../server/plans.js";

export default defineAction({
  description:
    "Mark one or more plan feedback comments as consumed after you have acted on them. Call this after processing get-plan-feedback output and applying the requested changes so the comments are excluded from future get-plan-feedback results. Pass the commentIds of every comment (or thread root) you have addressed.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    commentIds: z
      .array(z.string())
      .min(1)
      .describe(
        "IDs of the comments to mark as consumed. Obtain these from get-plan-feedback.",
      ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Consume Plan Feedback",
    description:
      "Mark plan feedback comments as consumed so they no longer appear as pending work.",
  },
  mcpApp: {
    compactCatalog: true,
  },
  run: async (args) => {
    // Consuming feedback requires editor access — same as authoring changes in
    // update-visual-plan. Viewers can leave feedback but cannot mark it consumed
    // on the agent's behalf.
    await assertPlanEditor(args.planId);

    const db = getDb();
    const now = nowIso();

    await db
      .update(schema.planComments)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.planComments.planId, args.planId),
          inArray(schema.planComments.id, args.commentIds),
          isNull(schema.planComments.deletedAt),
        ),
      );

    await writeEvent({
      planId: args.planId,
      type: "plan.updated",
      message: `Marked ${args.commentIds.length} feedback comment(s) as consumed.`,
      payload: {
        consumedCommentIds: args.commentIds,
      },
      createdBy: "agent",
    });

    return {
      planId: args.planId,
      consumedCommentIds: args.commentIds,
      consumedAt: now,
    };
  },
});
