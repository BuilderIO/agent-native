import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  conversationSummarySchema,
  readThreadSummary,
} from "../server/lib/thread-summary.js";

const errors = defineActionErrors("unauthenticated");

export default defineAction({
  description:
    "Read the stored summary of one email thread, if summarize-thread made one. Returns summary: null when the thread has never been summarized. lastMessageId is the newest message the summary covers; when the thread has a newer one, the summary is out of date and summarize-thread refreshes it. Changes nothing and never calls a model.",
  schema: z.object({
    accountEmail: z
      .union([z.string().email(), z.literal("local")])
      .describe(
        'Connected account email, or "local" for the synthetic mailbox',
      ),
    threadId: z.string().min(1).describe("Provider-scoped email thread ID"),
  }),
  outputSchema: z.object({ summary: conversationSummarySchema.nullable() }),
  errors,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: "search",
  run: async ({ accountEmail, threadId }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      return errors.fail("Sign in to read summaries.", "unauthenticated", {
        statusCode: 401,
      });
    }
    return {
      summary: await readThreadSummary(ownerEmail, accountEmail, threadId),
    };
  },
});
