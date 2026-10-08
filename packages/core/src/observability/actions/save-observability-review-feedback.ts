import { randomUUID } from "node:crypto";

import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getTraceSummary, insertFeedback } from "../store.js";
import type { FeedbackEntry } from "../types.js";
import {
  authorizeObservabilityOrgAdmin,
  getObservabilityOrgAdminAccess,
} from "./authorization.js";

export default defineAction({
  description:
    "Save an organization admin's vote or text note on an agent output for human review.",
  schema: z
    .object({
      runId: z.string().trim().min(1).max(200),
      feedbackType: z.enum(["thumbs_up", "thumbs_down", "text"]),
      value: z.string().trim().max(4_000).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.feedbackType === "text" && !value.value) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "A text note is required for text feedback.",
        });
      }
    }),
  agentTool: false,
  authorize: authorizeObservabilityOrgAdmin,
  run: async (args, ctx) => {
    const { userId, orgId } = getObservabilityOrgAdminAccess(ctx);
    const summary = await getTraceSummary(args.runId, { orgId });
    if (!summary)
      fail("That agent output is no longer available.", { statusCode: 404 });
    const entry: FeedbackEntry = {
      id: `review-${randomUUID()}`,
      runId: summary.runId,
      threadId: summary.threadId,
      messageSeq: null,
      feedbackType: args.feedbackType,
      value: args.value ?? "",
      userId,
      orgId,
      source: "human_review",
      createdAt: Date.now(),
    };
    await insertFeedback(entry);
    return entry;
  },
});
