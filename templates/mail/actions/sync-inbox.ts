import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { syncInbox } from "../server/lib/inbox-sync.js";

export default defineAction({
  description:
    "Advance one bounded Gmail inbox sync step for each selected connected account, or all connected accounts when omitted. Returns each account's sync status, whether rows changed, the observed and acknowledged push generations, and any exact quota retry delay. Call again while an account is initial, has a pending push, or has backfill pending; each call commits progress synchronously.",
  schema: z.object({
    accountEmails: z
      .array(z.string().email())
      .optional()
      .describe(
        "Connected Gmail accounts to advance; omit to advance all connected accounts",
      ),
  }),
  http: { method: "POST" },
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async ({ accountEmails }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    return syncInbox(ownerEmail, { accountEmails });
  },
});
