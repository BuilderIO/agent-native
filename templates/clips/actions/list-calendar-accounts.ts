
import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "List connected calendar accounts visible to the current user (Google, etc). Tokens are never returned.",
  schema: z.object({
    provider: z.enum(["google", "icloud", "microsoft"]).optional(),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const where = [
      accessFilter(schema.calendarAccounts, schema.calendarAccountShares),
    ];
    if (args.provider) {
      where.push(eq(schema.calendarAccounts.provider, args.provider));
    }
    const rows = await db
      .select({
        id: schema.calendarAccounts.id,
        provider: schema.calendarAccounts.provider,
        externalAccountId: schema.calendarAccounts.externalAccountId,
        displayName: schema.calendarAccounts.displayName,
        email: schema.calendarAccounts.email,
        status: schema.calendarAccounts.status,
        lastSyncedAt: schema.calendarAccounts.lastSyncedAt,
        lastSyncError: schema.calendarAccounts.lastSyncError,
        createdAt: schema.calendarAccounts.createdAt,
        ownerEmail: schema.calendarAccounts.ownerEmail,
      })
      .from(schema.calendarAccounts)
      .where(and(...where))
      .orderBy(desc(schema.calendarAccounts.createdAt));

    return { accounts: rows };
  },
});
