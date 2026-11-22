import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import resolveReviewThread from "@agent-native/core/review/actions/resolve-review-thread";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { z } from "zod";

import { assertCommentAccess } from "../server/lib/comment-access.js";
import {
  findRecordingComment,
  RECORDING_REVIEW_RESOURCE,
  recordingReviewContext,
} from "../server/lib/recording-comments.js";
import { sameOwnerEmail } from "../server/lib/recordings.js";

const cliBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "Resolve or reopen the thread a comment is in. If --resolved is omitted, toggles the thread's current state.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    resolved: z
      .union([z.boolean(), cliBoolean])
      .optional()
      .describe("Explicit resolved value. Omit to toggle."),
  }),
  mcpTool: "search",
  run: async (args, ctx) => {
    const existing = await findRecordingComment(args.id);
    if (!existing) throw new Error(`Comment not found: ${args.id}`);

    const reviewCtx = recordingReviewContext(ctx);
    const userEmail = reviewCtx.userEmail;
    if (!userEmail) {
      throw new Error("Sign in required to resolve comments.");
    }

    await assertCommentAccess(
      existing.resourceId,
      "write",
      ctx?.requestHeaders,
    );

    const thread = existing.parentCommentId
      ? await findRecordingComment(existing.threadId)
      : existing;
    if (!thread) {
      fail(`Comment not found: ${existing.threadId}`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    if (!sameOwnerEmail(thread.authorEmail, userEmail)) {
      try {
        await assertAccess("recording", existing.resourceId, "editor");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          throw new ForbiddenError(
            "Only the comment author or a recording editor can resolve this comment.",
          );
        }
        throw err;
      }
    }

    const next = args.resolved ?? thread.status !== "resolved";
    await resolveReviewThread.run(
      {
        resourceType: RECORDING_REVIEW_RESOURCE,
        resourceId: existing.resourceId,
        threadId: existing.threadId,
        status: next ? "resolved" : "open",
      },
      reviewCtx,
    );

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Comment ${args.id} ${next ? "resolved" : "unresolved"}`);
    return { id: args.id, resolved: next };
  },
});
