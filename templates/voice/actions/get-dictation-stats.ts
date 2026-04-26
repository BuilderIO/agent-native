/**
 * Get usage statistics.
 *
 * Usage:
 *   pnpm action get-dictation-stats
 *   pnpm action get-dictation-stats --days=30
 */

import { defineAction } from "@agent-native/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

export default defineAction({
  description:
    "Get usage statistics for the current user including total words dictated, session count, and streak information.",
  schema: z.object({
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Number of days to look back"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    // Get stats rows for the date range
    const cutoff = new Date(
      Date.now() - args.days * 24 * 60 * 60 * 1000,
    ).toISOString().slice(0, 10);

    const rows = await db
      .select()
      .from(schema.dictationStats)
      .where(
        and(
          eq(schema.dictationStats.ownerEmail, ownerEmail),
          sql`${schema.dictationStats.date} >= ${cutoff}`,
        ),
      )
      .orderBy(desc(schema.dictationStats.date));

    const totalWords = rows.reduce((sum, r) => sum + r.totalWords, 0);
    const totalSessions = rows.reduce((sum, r) => sum + r.sessionsCount, 0);
    const currentStreak = rows.length > 0 ? rows[0].streak : 0;

    return {
      days: args.days,
      totalWords,
      totalSessions,
      currentStreak,
      dailyStats: rows.map((r) => ({
        date: r.date,
        words: r.totalWords,
        sessions: r.sessionsCount,
        streak: r.streak,
      })),
    };
  },
});
