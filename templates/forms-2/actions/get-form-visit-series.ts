import { defineAction } from "@agent-native/core/action";
import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { INSIGHT_PERIODS } from "../shared/form-contract.js";
import { formsAccess, formsErrors, orgScope, requireForm } from "./_access.js";
import { periodRange } from "./_form-store.js";

const HOUR_MS = 3_600_000;
const SHORT_PERIODS = new Set(["today", "yesterday", "24h"]);
const MAX_BUCKETS = 120;

export default defineAction({
  description:
    "Visits over time for a form: one count per hour (today, yesterday, 24h) or per day, oldest first, with empty buckets filled in and at most the newest 120.",
  schema: z.object({
    formId: z.string().describe("Form id"),
    period: z
      .enum(INSIGHT_PERIODS)
      .default("all")
      .describe("Same periods as get-form-insights; defaults to all"),
  }),
  outputSchema: z.object({
    unit: z.enum(["hour", "day"]),
    buckets: z.array(z.object({ start: z.string(), visits: z.number() })),
  }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formId, period }) => {
    const access = formsAccess();
    await requireForm(access, formId);
    const { formEvents } = schema;
    const { from, to } = periodRange(period);
    const rows = await getDb()
      .select({ sessionId: formEvents.sessionId, at: formEvents.at })
      .from(formEvents)
      .where(
        and(
          orgScope(formEvents, access.orgId),
          eq(formEvents.formId, formId),
          eq(formEvents.type, "visit"),
          from ? gte(formEvents.at, from) : undefined,
          to ? lt(formEvents.at, to) : undefined,
        ),
      )
      .limit(20000);

    const unit: "hour" | "day" = SHORT_PERIODS.has(period) ? "hour" : "day";
    const size = unit === "hour" ? HOUR_MS : 24 * HOUR_MS;
    const counts = new Map<number, Set<string>>();
    for (const row of rows) {
      const bucket = Math.floor(Date.parse(row.at) / size) * size;
      const sessions = counts.get(bucket) ?? new Set<string>();
      sessions.add(row.sessionId);
      counts.set(bucket, sessions);
    }
    if (counts.size === 0) return { unit, buckets: [] };
    const times = [...counts.keys()];
    const last = Math.max(...times);
    const first = Math.max(Math.min(...times), last - (MAX_BUCKETS - 1) * size);
    const buckets = [];
    for (let start = first; start <= last; start += size)
      buckets.push({
        start: new Date(start).toISOString(),
        visits: counts.get(start)?.size ?? 0,
      });
    return { unit, buckets };
  },
});
