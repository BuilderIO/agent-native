import { defineAction } from "@agent-native/core/action";
import {
  accessFilter,
  resolveAccess,
  roleSatisfies,
} from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  recordCalendarFetchError,
  resolveCalendarAccessToken,
} from "../server/lib/calendar-event-meetings.js";
import { listCalendarChoices } from "../server/lib/calendar-sources.js";

const accountCalendarsSchema = z.object({
  accountId: z.string(),
  email: z.string().nullable(),
  status: z.enum(["connected", "needs-reauth", "disconnected"]),
  canChange: z.boolean(),
  calendars: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().nullable(),
      primary: z.boolean(),
      enabled: z.boolean(),
    }),
  ),
  error: z.string().optional(),
});

const resultSchema = z.object({ accounts: z.array(accountCalendarsSchema) });

export default defineAction({
  description:
    'List the calendars in each connected Google account and whether Clips reads each one (enabled). Only an account\'s main calendar ("primary") is on until changed with set-calendar-enabled; list-meetings shows events from the calendars that are on. Callers who cannot change an account see only its calendars that are on.',
  schema: z.object({
    accountId: z
      .string()
      .optional()
      .describe("calendar_accounts.id; omit for every connected account"),
  }),
  outputSchema: resultSchema,
  http: { method: "GET" },
  mcpTool: false,
  run: async (args): Promise<z.infer<typeof resultSchema>> => {
    const db = getDb();
    const where = [
      accessFilter(schema.calendarAccounts, schema.calendarAccountShares),
      eq(schema.calendarAccounts.provider, "google"),
    ];
    if (args.accountId) {
      where.push(eq(schema.calendarAccounts.id, args.accountId));
    }
    const accounts = await db
      .select()
      .from(schema.calendarAccounts)
      .where(and(...where))
      .orderBy(desc(schema.calendarAccounts.createdAt));

    const results = await Promise.all(
      accounts.map(async (account) => {
        const base = {
          accountId: account.id,
          email: account.email,
          status: account.status,
        };
        if (account.status !== "connected") {
          return { ...base, canChange: false, calendars: [] };
        }
        const access = await resolveAccess("calendar-account", account.id);
        const canChange = !!access && roleSatisfies(access.role, "editor");

        let accessToken: string | null;
        try {
          accessToken = await resolveCalendarAccessToken(account);
        } catch (err) {
          return {
            ...base,
            canChange,
            calendars: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
        if (!accessToken) {
          const failure = await recordCalendarFetchError(
            account,
            new Error("Token refresh failed"),
            { needsReauth: true },
          );
          return { ...base, canChange, calendars: [], error: failure.error };
        }

        try {
          const calendars = await listCalendarChoices({ account, accessToken });
          return {
            ...base,
            canChange,
            calendars: canChange
              ? calendars
              : calendars.filter((calendar) => calendar.enabled),
          };
        } catch (err) {
          return {
            ...base,
            canChange,
            calendars: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    return { accounts: results };
  },
});
