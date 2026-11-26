import {
  registerReviewableResource,
  type ReviewResourceAccess,
  type ReviewResourceContext,
} from "@agent-native/core/review";
import { defineNitroPlugin } from "@agent-native/core/server";
import { resolveAccess, type AccessContext } from "@agent-native/core/sharing";

import type { schema } from "../db/index.js";
import {
  PLAN_ANCHOR,
  PLAN_REVIEW_RESOURCE,
  planCommentAnchorSchema,
} from "../lib/plan-comment-mirror.js";

function sharingContext(ctx: ReviewResourceContext): AccessContext {
  return {
    ...(ctx.userEmail ? { userEmail: ctx.userEmail } : {}),
    ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
    ...(ctx.transaction
      ? {
          transaction: ctx.transaction as NonNullable<
            AccessContext["transaction"]
          >,
        }
      : {}),
  };
}

async function resolvePlanReviewAccess(
  planId: string,
  ctx?: ReviewResourceContext,
): Promise<ReviewResourceAccess | null> {
  const access = await resolveAccess(
    "plan",
    planId,
    ctx ? sharingContext(ctx) : undefined,
  );
  const plan = access?.resource as typeof schema.plans.$inferSelect | undefined;
  if (!access || !plan || plan.deletedAt) return null;
  return {
    role: access.role as ReviewResourceAccess["role"],
    ownerEmail: plan.ownerEmail,
    orgId: plan.orgId ?? null,
    visibility: plan.visibility,
    resource: plan,
  };
}

export default defineNitroPlugin(() => {
  registerReviewableResource({
    type: PLAN_REVIEW_RESOURCE,
    displayName: "Plan",
    anchorKinds: {
      [PLAN_ANCHOR]: {
        version: 1,
        parse: (anchor) => planCommentAnchorSchema.parse(anchor),
      },
    },
    resolveAccess: resolvePlanReviewAccess,
    commentsWrittenByApp:
      "Plan comments are written with update-visual-plan, reply-to-plan-comment, resolve-plan-comment, consume-plan-feedback, react-to-plan-comment and delete-plan-comment.",
  });
});
