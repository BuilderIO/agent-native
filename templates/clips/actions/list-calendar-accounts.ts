/**
 * list-calendar-accounts
 *
 * Returns the calendar accounts the current user can see. Uses the
 * framework `accessFilter` so org-shared accounts surface but accounts
 * owned by other users in other orgs do not.
 *
 * Tokens are NEVER returned — only display fields.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { getActiveOrganizationId } from "../server/lib/recordings.js";

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
    const orgId = await getActiveOrganizationId().catch(() => undefined);
    if (orgId) {
      where.push(eq(schema.calendarAccounts.orgId, orgId));
    }
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
