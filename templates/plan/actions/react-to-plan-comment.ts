import { defineAction } from "@agent-native/core/action";
import { ensureReviewTables } from "@agent-native/core/review";
import {
  ForbiddenError,
  currentAccess,
  resolveAccess,
  roleSatisfies,
} from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import {
  planReactionActor,
  reactToPlanComment,
} from "../server/lib/plan-comments.js";

export default defineAction({
  description:
    "Add or remove a reaction, such as an emoji, on a comment in an Agent-Native Plan. Your reactions are kept apart from those of the person you work for.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    commentId: z.string().describe("ID of the comment to react to"),
    reaction: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .describe("The reaction, such as an emoji"),
    active: z
      .boolean()
      .describe("true to add the reaction, false to remove it"),
  }),
  outputSchema: z.object({
    planId: z.string(),
    commentId: z.string(),
    reaction: z.string(),
    active: z.boolean(),
    reactions: z.array(
      z.object({
        reaction: z.string(),
        count: z.number().int(),
        reactedByMe: z.boolean(),
      }),
    ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    title: "React to Plan Comment",
    description:
      "Add or remove a reaction on a comment in an Agent-Native Plan.",
  },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  mcpApp: {
    compactCatalog: true,
  },
  changeResource: (input) =>
    input.planId ? { resourceType: "plan", resourceId: input.planId } : null,
  run: async (args, ctx) => {
    const actorEmail = planReactionActor(ctx);
    if (!actorEmail) {
      throw new ForbiddenError(
        "Reacting to a comment requires an account. Sign in to react.",
      );
    }
    const access = await resolveAccess(
      "plan",
      args.planId,
      resolvePlanAccessContext(currentAccess()),
    );
    if (
      !access ||
      (access.resource as typeof schema.plans.$inferSelect).deletedAt
    ) {
      throw new ForbiddenError(`Plan ${args.planId} not found`);
    }
    if (!roleSatisfies(access.role, "commenter")) {
      throw new ForbiddenError(
        "Reacting to a comment on this plan requires commenter access or higher.",
      );
    }

    await ensureReviewTables();
    const reactions = await getDb().transaction((tx) =>
      reactToPlanComment(tx, args.planId, {
        commentId: args.commentId,
        actorEmail,
        reaction: args.reaction,
        active: args.active,
      }),
    );
    return {
      planId: args.planId,
      commentId: args.commentId,
      reaction: args.reaction,
      active: args.active,
      reactions,
    };
  },
});
