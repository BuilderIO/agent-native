/**
 * List people (contacts) from meeting attendees.
 *
 * Usage:
 *   pnpm action list-people
 *   pnpm action list-people --search="alice"
 */

import { defineAction } from "@agent-native/core";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getActiveOrganizationId } from "../server/lib/meetings.js";

export default defineAction({
  description:
    "List people (contacts) built from meeting attendees. Supports search and sorting by meeting count or name.",
  schema: z.object({
    search: z.string().optional().describe("Name or email substring match"),
    sort: z
      .enum(["name", "recent", "meetings"])
      .default("recent")
      .describe("Sort order"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const orgId = await getActiveOrganizationId();

    const conditions: any[] = [];
    if (orgId) {
      conditions.push(eq(schema.people.organizationId, orgId));
    }

    if (args.search) {
      const pat = `%${args.search.toLowerCase()}%`;
      conditions.push(
        sql`(LOWER(${schema.people.name}) LIKE ${pat} OR LOWER(${schema.people.email}) LIKE ${pat})`,
      );
    }

    const orderBy =
      args.sort === "name"
        ? asc(schema.people.name)
        : args.sort === "meetings"
          ? desc(schema.people.meetingCount)
          : desc(schema.people.lastSeenAt);

    const whereClause = conditions.length
      ? sql`${sql.join(conditions, sql` AND `)}`
      : undefined;

    const rows = await db
      .select()
      .from(schema.people)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(args.limit)
      .offset(args.offset);

    return {
      people: rows.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        title: p.title,
        companyId: p.companyId,
        avatarUrl: p.avatarUrl,
        lastSeenAt: p.lastSeenAt,
        meetingCount: p.meetingCount,
      })),
    };
  },
});
