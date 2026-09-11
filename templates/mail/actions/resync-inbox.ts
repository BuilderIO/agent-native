import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { ensureInboxFresh, resetInboxSync } from "../server/lib/inbox-sync.js";

export default defineAction({
  description:
    "Force the synced inbox store to resync from Gmail right now, ignoring the normal freshness window. list-inbox-threads already keeps the store fresh on its own (resyncs any account stale by more than 15s), so only call this when the inbox tabs or counts look stale or inconsistent despite that — not before every read.",
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
    const accounts = await ensureInboxFresh(ownerEmail, {
      accountEmails: args.accountEmail ? [args.accountEmail] : undefined,
      maxAgeMs: 0,
      budgetMs: 8_000,
    });
    return { accounts };
  },
});
