import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { syncInbox } from "../server/lib/inbox-sync.js";

export default defineAction({
  description:
    "Advance one bounded Gmail inbox sync step for each selected connected account, or all connected accounts when omitted. An account synced within its freshness window returns its cached state without calling Gmail; pass force: true to pull from Gmail now. Pass loadOlder: true to fetch one older inbox page when backfill is pending, or refresh up to 50 older cached classifications. Returns each account's sync status, whether rows changed, the observed and acknowledged push generations, and any exact quota retry delay. Each call commits progress synchronously.",
  automatic: (input) => !input.force && !input.loadOlder,
  schema: z.object({
    accountEmails: z
      .array(z.string().email())
      .optional()
      .describe(
        "Connected Gmail accounts to advance; omit to advance all connected accounts",
      ),
    force: z
      .boolean()
      .optional()
      .describe(
        "Sync now even when the account was synced within its poll window (manual refresh)",
      ),
    loadOlder: z
      .boolean()
      .optional()
      .describe(
        "Load one older inbox page or refresh older cached classifications",
      ),
  }),
  http: { method: "POST" },
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  mcpTool: "search",
  run: async ({ accountEmails, force, loadOlder }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    return syncInbox(ownerEmail, {
      ...(accountEmails !== undefined ? { accountEmails } : {}),
      ...(force !== undefined ? { force } : {}),
      ...(loadOlder !== undefined ? { loadOlder } : {}),
    });
  },
});
