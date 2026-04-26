/**
 * List meetings visible to the current user.
 *
 * Supports filtering by status, folder, date range, search, and sort.
 *
 * Usage:
 *   pnpm action list-meetings
 *   pnpm action list-meetings --status=done --sort=recent
 *   pnpm action list-meetings --search="product review"
 */

import { defineAction } from "@agent-native/core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "List meetings visible to the current user. Supports filtering by status, folder, date range, free-text search, and sort order.",
  schema: z.object({
    status: z
      .enum(["scheduled", "recording", "enhancing", "done"])
      .optional()
      .describe("Filter by meeting status"),
    folderId: z
      .string()
      .nullish()
      .describe("Folder id (null = root / unfiled)"),
    startAfter: z
      .string()
      .optional()
      .describe("ISO date — only meetings starting after this time"),
    startBefore: z
      .string()
      .optional()
      .describe("ISO date — only meetings starting before this time"),
    search: z.string().optional().describe("Title substring match"),
    sort: z
      .enum(["recent", "oldest", "start-time"])
      .default("recent")
      .describe("Sort order"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    const whereClauses = [accessFilter(schema.meetings, schema.meetingShares)];

    if (args.status) {
      whereClauses.push(eq(schema.meetings.status, args.status));
    }

    if (args.folderId !== undefined && args.folderId !== null) {
      whereClauses.push(eq(schema.meetings.folderId, args.folderId));
    }

    if (args.startAfter) {
      whereClauses.push(sql`${schema.meetings.startTime} > ${args.startAfter}`);
    }

    if (args.startBefore) {
      whereClauses.push(
        sql`${schema.meetings.startTime} < ${args.startBefore}`,
      );
    }

    if (args.search) {
      const pat = `%${args.search}%`;
      whereClauses.push(sql`${schema.meetings.title} LIKE ${pat}`);
    }

    const orderBy =
      args.sort === "oldest"
        ? asc(schema.meetings.createdAt)
        : args.sort === "start-time"
          ? desc(schema.meetings.startTime)
          : desc(schema.meetings.createdAt);

    const rows = await db
      .select()
      .from(schema.meetings)
      .where(and(...whereClauses))
      .orderBy(orderBy)
      .limit(args.limit)
      .offset(args.offset);

    // Fetch attendee counts
    const ids = rows.map((r) => r.id);
    let attendeeCounts: Record<string, number> = {};
    if (ids.length) {
      for (const id of ids) {
        const countRows = await db
          .select({ count: sql<number>`COUNT(1)` })
          .from(schema.meetingAttendees)
          .where(eq(schema.meetingAttendees.meetingId, id));
        attendeeCounts[id] = Number(countRows[0]?.count ?? 0);
      }
    }

    const meetings = rows.map((r) => ({
      id: r.id,
      title: r.title,
      startTime: r.startTime,
      endTime: r.endTime,
      status: r.status,
      folderId: r.folderId,
      calendarProvider: r.calendarProvider,
      ownerEmail: r.ownerEmail,
      visibility: r.visibility,
      attendeeCount: attendeeCounts[r.id] ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return { meetings };
  },
});
