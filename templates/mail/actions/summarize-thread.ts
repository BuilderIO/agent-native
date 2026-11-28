import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  conversationSummarySchema,
  summarizeThread,
} from "../server/lib/thread-summary.js";
import type { EmailMessage } from "../shared/types.js";
import getThread from "./get-thread.js";

const errors = defineActionErrors(
  "unauthenticated",
  "thread_not_found",
  "nothing_to_summarize",
  "no_ai_model",
  "summary_failed",
  "summary_unreadable",
);

const STATUS_FOR = {
  nothing_to_summarize: 422,
  no_ai_model: 424,
  summary_failed: 502,
  summary_unreadable: 502,
} as const;

export default defineAction({
  description:
    "Summarize one email thread in a sentence and up to four points, using Mail's low-cost text model, and store the result. Returns the stored summary (cached: true) without calling the model when it already covers the thread's newest message. Model use is billed and shows in Settings → Usage as Mail's summary workflow. Fails with no_ai_model when no AI provider is connected. Changes no mail.",
  schema: z.object({
    accountEmail: z
      .union([z.string().email(), z.literal("local")])
      .describe(
        'Connected account email, or "local" for the synthetic mailbox',
      ),
    threadId: z.string().min(1).describe("Provider-scoped email thread ID"),
  }),
  outputSchema: z.object({
    summary: conversationSummarySchema,
    cached: z.boolean(),
  }),
  errors,
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  run: async ({ accountEmail, threadId }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      return errors.fail("Sign in to summarize email.", "unauthenticated", {
        statusCode: 401,
      });
    }
    let messages: EmailMessage[];
    try {
      messages = (await getThread.run({
        accountEmail,
        id: threadId,
      })) as EmailMessage[];
    } catch (error) {
      if (error instanceof Error && error.message === "Thread not found.") {
        return errors.fail("Thread not found.", "thread_not_found", {
          statusCode: 404,
        });
      }
      throw error;
    }
    const outcome = await summarizeThread({
      ownerEmail,
      accountEmail,
      threadId,
      messages,
    });
    if (!outcome.ok) {
      return errors.fail(outcome.message, outcome.code, {
        statusCode: STATUS_FOR[outcome.code],
      });
    }
    return { summary: outcome.summary, cached: outcome.cached };
  },
});
