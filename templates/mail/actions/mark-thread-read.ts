import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { markThreadRead } from "../server/lib/email-state.js";
import { GmailQuotaCooldownError } from "../server/lib/google-api.js";

export default defineAction({
  description:
    'Mark one conversation thread as read or unread. For broad unread cleanup across many threads, call mark-read once with scope "all-unread" instead of looping this action.',
  schema: z.object({
    threadId: z.string().describe("Thread ID to mark read/unread"),
    unread: z.coerce
      .boolean()
      .optional()
      .describe("Set to true to mark the thread as unread instead of read"),
    accountEmail: z
      .string()
      .optional()
      .describe("Specific connected account to use"),
  }),
  run: async (args) => {
    if (!args.threadId) throw new Error("--threadId is required");
    const isRead = args.unread !== true;

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    try {
      await markThreadRead({
        threadId: args.threadId,
        ownerEmail,
        isRead,
        accountEmail: args.accountEmail,
      });
    } catch (error) {
      if (error instanceof GmailQuotaCooldownError) {
        fail("Gmail is temporarily limiting requests.", {
          statusCode: 429,
          errorCode: "gmail_quota_cooldown",
          details: {
            retryAfterSeconds: Math.min(
              Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
              300,
            ),
          },
        });
      }
      throw error;
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const action = isRead ? "read" : "unread";
    return `Marked thread ${args.threadId} as ${action}`;
  },
});
