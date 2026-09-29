import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { resetInboxSync, syncInbox } from "../server/lib/inbox-sync.js";

export default defineAction({
  description:
    "Reset the selected account's inbox sync cursor and run one bounded Gmail sync step. The action returns as soon as that step commits or reaches a quota cooldown; call sync-inbox again to continue. list-inbox-threads is a fast SQL read and never syncs Gmail.",
  schema: z.object({
    accountEmail: z
      .string()
      .email()
      .optional()
      .describe(
        "Resync only this connected account; omit to resync every connected account",
      ),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    await resetInboxSync(ownerEmail, args.accountEmail);
    return syncInbox(ownerEmail, {
      accountEmails: args.accountEmail ? [args.accountEmail] : undefined,
    });
  },
});
