import { registerReviewableResource } from "@agent-native/core/review";
import { defineNitroPlugin } from "@agent-native/core/server";

import {
  PLAN_ANCHOR,
  PLAN_REVIEW_RESOURCE,
  planCommentAnchorSchema,
} from "../lib/plan-comment-mirror.js";

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
    commentsWrittenByApp:
      "Plan comments are written with update-visual-plan, reply-to-plan-comment, resolve-plan-comment, consume-plan-feedback and delete-plan-comment.",
  });
});
