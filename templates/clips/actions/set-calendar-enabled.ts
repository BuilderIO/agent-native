import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  lockCalendarAccount,
  resolveCalendarAccessToken,
} from "../server/lib/calendar-event-meetings.js";
import {
  enabledCalendarIds,
  listCalendarChoices,
  PRIMARY_CALENDAR_ID,
} from "../server/lib/calendar-sources.js";
import { booleanParam } from "./lib/cli-params.js";

const resultSchema = z.object({
  accountId: z.string(),
  calendarId: z.string(),
  enabled: z.boolean(),
  enabledCalendarIds: z.array(z.string()),
});

function failAccountNotFound(accountId: string): never {
  fail(`Calendar account not found: ${accountId}`, {
    errorCode: "calendar_account_not_found",
    statusCode: 404,
  });
}

export default defineAction({
  description:
    'Turn one calendar of a connected Google account on or off in Clips. list-meetings and meeting reminders read only the calendars that are on. Turning one off drops its upcoming events from Clips; meetings already opened from it keep their notes and recordings. Take calendar ids from list-calendars; the main calendar is "primary".',
  schema: z.object({
    accountId: z.string().describe("calendar_accounts.id"),
    calendarId: z
      .string()
      .min(1)
      .max(1024)
      .describe('Calendar id from list-calendars; "primary" for the main one'),
    enabled: booleanParam,
  }),
  outputSchema: resultSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  mcpTool: false,
  run: async (args): Promise<z.infer<typeof resultSchema>> => {
    await assertAccess("calendar-account", args.accountId, "editor");
    const db = getDb();
    const accounts = await db
      .select()
      .from(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, args.accountId))
      .limit(1);
    const account = accounts.find((row) => row.provider === "google");
    if (!account) failAccountNotFound(args.accountId);

    if (args.enabled) {
      const accessToken = await resolveCalendarAccessToken(account);
      if (!accessToken) {
        fail("Google Calendar needs to be reconnected.", {
          errorCode: "calendar_needs_reconnect",
          statusCode: 424,
        });
      }
      const calendars = await listCalendarChoices({ account, accessToken });
      if (!calendars.some((calendar) => calendar.id === args.calendarId)) {
        fail(
          `This Google account has no calendar Clips can read with id ${args.calendarId}.`,
          { errorCode: "calendar_not_readable", statusCode: 404 },
        );
      }
    }

    const enabled = await db.transaction(async (tx) => {
      if (!(await lockCalendarAccount(tx, account.id, account.ownerEmail))) {
        failAccountNotFound(args.accountId);
      }
      const rows = await tx
        .select({
          enabledCalendarIdsJson:
            schema.calendarAccounts.enabledCalendarIdsJson,
        })
        .from(schema.calendarAccounts)
        .where(eq(schema.calendarAccounts.id, account.id))
        .limit(1);
      const current = rows.length > 0 ? rows[0] : undefined;
      const ids = enabledCalendarIds(current ?? {});
      const next = args.enabled
        ? [...new Set([...ids, args.calendarId])]
        : ids.filter((id) => id !== args.calendarId);
      await tx
        .update(schema.calendarAccounts)
        .set({
          enabledCalendarIdsJson: JSON.stringify(next),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.calendarAccounts.id, account.id));

      if (!args.enabled) {
        await tx
          .delete(schema.calendarEvents)
          .where(
            and(
              eq(schema.calendarEvents.calendarAccountId, account.id),
              isNull(schema.calendarEvents.meetingId),
              args.calendarId === PRIMARY_CALENDAR_ID
                ? isNull(schema.calendarEvents.calendarId)
                : eq(schema.calendarEvents.calendarId, args.calendarId),
            ),
          );
      }
      return next;
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      accountId: account.id,
      calendarId: args.calendarId,
      enabled: args.enabled,
      enabledCalendarIds: enabled,
    };
  },
});
