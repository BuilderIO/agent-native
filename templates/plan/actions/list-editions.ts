import { defineAction } from "@agent-native/core";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertEditionsLabEnabled } from "../server/lib/editions-lab.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { planPath } from "../server/plans.js";

export default defineAction({
  description:
    "List editions of the engineering newspaper, newest first — the back-issue archive.",
  schema: z.object({
    limit: z.coerce.number().int().positive().max(200).optional().default(30),
    series: z
      .string()
      .trim()
      .optional()
      .describe("Only list issues of this series. Omit for every series."),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "List Editions",
    description:
      "List editions of the engineering newspaper, newest first — the back-issue archive.",
  },
  run: async (args) => {
    await assertEditionsLabEnabled();
    const db = getDb();
    // Deliberately projected: `markdown` holds the whole rendered paper and the
    // archive only needs the masthead line for each issue.
    const rows = await db
      .select({
        id: schema.plans.id,
        title: schema.plans.title,
        brief: schema.plans.brief,
        issueNumber: schema.plans.editionIssueNumber,
        series: schema.plans.editionSeries,
        dateKey: schema.plans.editionDateKey,
        windowStart: schema.plans.editionWindowStart,
        windowEnd: schema.plans.editionWindowEnd,
        timezone: schema.plans.editionTimezone,
        updatedAt: schema.plans.updatedAt,
      })
      .from(schema.plans)
      .where(
        and(
          accessFilter(
            schema.plans,
            schema.planShares,
            resolvePlanAccessContext(currentAccess()),
          ),
          isNull(schema.plans.deletedAt),
          eq(schema.plans.kind, "edition"),
          ...(args.series
            ? [
                sql`coalesce(${schema.plans.editionSeries}, 'daily') = ${args.series}`,
              ]
            : []),
        ),
      )
      .orderBy(desc(schema.plans.editionDateKey), desc(schema.plans.updatedAt))
      .limit(args.limit);

    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const grouped = await db
        .select({
          editionId: schema.planEditionStories.editionId,
          storyCount: sql<number>`count(*)::int`,
        })
        .from(schema.planEditionStories)
        .where(
          inArray(
            schema.planEditionStories.editionId,
            rows.map((row) => row.id),
          ),
        )
        .groupBy(schema.planEditionStories.editionId);
      for (const group of grouped) {
        counts.set(group.editionId, group.storyCount);
      }
    }

    return {
      editions: rows.map((row) => ({
        ...row,
        series: row.series ?? "daily",
        storyCount: counts.get(row.id) ?? 0,
        url: planPath(row.id, "edition"),
      })),
    };
  },
});
