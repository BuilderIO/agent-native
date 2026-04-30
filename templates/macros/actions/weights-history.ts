import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { and, gte, lte, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Get weight trend history for a date range",
  schema: z.object({
    startDate: z
      .string()
      .optional()
      .describe("Start date in YYYY-MM-DD format"),
    endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (!args.startDate || !args.endDate) return [];

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) return [];

    const data = await db()
      .select()
      .from(schema.weights)
      .where(
        and(
          gte(schema.weights.date, String(args.startDate)),
          lte(schema.weights.date, String(args.endDate)),
          eq(schema.weights.owner_email, ownerEmail),
        ),
      )
      .orderBy(asc(schema.weights.date), desc(schema.weights.created_at));

    // Group by date, take most recent per date
    const weightByDate = new Map<string, number>();
    for (const entry of data) {
      if (!weightByDate.has(entry.date)) {
        weightByDate.set(entry.date, entry.weight);
      }
    }

    const entries = Array.from(weightByDate.entries())
      .map(([date, weight]) => ({ date, weight }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate 7-day exponential moving average
    const result = entries.map((entry, index) => {
      let trendWeight = entry.weight;
      if (entries.length >= 3) {
        const windowSize = Math.min(7, index + 1);
        const windowEntries = entries.slice(
          Math.max(0, index - windowSize + 1),
          index + 1,
        );
        let weightSum = 0;
        let divisor = 0;
        windowEntries.forEach((e, i) => {
          const w = i + 1;
          weightSum += e.weight * w;
          divisor += w;
        });
        trendWeight = weightSum / divisor;
      }

      return {
        date: entry.date,
        weight: entry.weight,
        trendWeight: Math.round(trendWeight * 10) / 10,
        displayDate: new Date(entry.date + "T12:00:00").toLocaleDateString(
          "en-US",
          {
            month: "short",
            day: "numeric",
          },
        ),
      };
    });

    return result;
  },
});
