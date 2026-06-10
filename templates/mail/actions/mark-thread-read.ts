import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { writeAppState } from "@agent-native/core/application-state";
import { markThreadRead } from "../server/lib/email-state.js";
import { z } from "zod";

export default defineAction({
  description:
    "Mark all messages in a thread as read or unread. Prefer this over mark-read when acting on a whole conversation.",
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

    await markThreadRead({
      threadId: args.threadId,
      ownerEmail,
      isRead,
      accountEmail: args.accountEmail,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    const action = isRead ? "read" : "unread";
    return `Marked thread ${args.threadId} as ${action}`;
  },
});
