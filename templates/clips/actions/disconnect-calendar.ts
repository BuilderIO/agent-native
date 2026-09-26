
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { deleteAppSecret, readAppSecret } from "@agent-native/core/secrets";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { lockCalendarAccount } from "../server/lib/calendar-event-meetings.js";
import { revokeToken } from "../server/lib/google-calendar-client.js";

export default defineAction({
  description:
    "Disconnect a calendar account. Revokes the Google tokens (best-effort), deletes secrets, and removes synced events.",
  schema: z.object({
    id: z.string().describe("calendar_accounts.id"),
  }),
  run: async (args) => {
    await assertAccess("calendar-account", args.id, "admin");
    const db = getDb();
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Not authenticated.");
    }

    const [account] = await db
      .select()
      .from(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, args.id));
    if (!account) throw new Error(`Calendar account not found: ${args.id}`);

    // else's account must still hit the right (scope, scopeId, key) row.
    const secretScopeEmail = account.ownerEmail;

    try {
      if (account.refreshTokenSecretRef) {
        const ref = await readAppSecret({
          key: account.refreshTokenSecretRef,
          scope: "user",
          scopeId: secretScopeEmail,
        });
        if (ref?.value) await revokeToken(ref.value);
      } else if (account.accessTokenSecretRef) {
        const ref = await readAppSecret({
          key: account.accessTokenSecretRef,
          scope: "user",
          scopeId: secretScopeEmail,
        });
        if (ref?.value) {
          try {
            const parsed = JSON.parse(ref.value) as { accessToken?: string };
            if (parsed.accessToken) await revokeToken(parsed.accessToken);
          } catch {
            await revokeToken(ref.value);
          }
        }
      }
    } catch {
      // Non-fatal — we still want to delete the row.
    }

    if (account.accessTokenSecretRef) {
      await deleteAppSecret({
        key: account.accessTokenSecretRef,
        scope: "user",
        scopeId: secretScopeEmail,
      }).catch(() => {});
    }
    if (account.refreshTokenSecretRef) {
      await deleteAppSecret({
        key: account.refreshTokenSecretRef,
        scope: "user",
        scopeId: secretScopeEmail,
      }).catch(() => {});
    }

    await db.transaction(async (tx) => {
      if (!(await lockCalendarAccount(tx, args.id, account.ownerEmail))) {
        throw new Error(`Calendar account not found: ${args.id}`);
      }

      const syncedEvents = await tx
        .select({
          id: schema.calendarEvents.id,
          meetingId: schema.calendarEvents.meetingId,
        })
        .from(schema.calendarEvents)
        .where(eq(schema.calendarEvents.calendarAccountId, args.id));
      const syncedCalendarEventIds = syncedEvents.map((event) => event.id);
      const syncedMeetingIds = syncedEvents
        .map((event) => event.meetingId)
        .filter((meetingId): meetingId is string => Boolean(meetingId));
      if (syncedCalendarEventIds.length > 0 || syncedMeetingIds.length > 0) {
        await tx
          .update(schema.meetings)
          .set({ trashedAt: new Date().toISOString() })
          .where(
            and(
              or(
                syncedMeetingIds.length > 0
                  ? inArray(schema.meetings.id, syncedMeetingIds)
                  : undefined,
                syncedCalendarEventIds.length > 0
                  ? inArray(
                      schema.meetings.calendarEventId,
                      syncedCalendarEventIds,
                    )
                  : undefined,
              )!,
              isNull(schema.meetings.recordingId),
              isNull(schema.meetings.trashedAt),
            ),
          );
      }

      await tx
        .delete(schema.calendarEvents)
        .where(eq(schema.calendarEvents.calendarAccountId, args.id));

      await tx
        .delete(schema.calendarAccounts)
        .where(eq(schema.calendarAccounts.id, args.id));
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id, disconnected: true };
  },
});
