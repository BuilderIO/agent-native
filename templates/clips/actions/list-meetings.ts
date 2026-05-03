/**
 * List meetings visible to the current user.
 *
 * Filtering:
 *   - view='upcoming' — scheduled_start in the future, not trashed
 *   - view='past'     — actual_end OR scheduled_end in the past, not trashed
 *   - view='all'      — every visible meeting (excluding trashed)
 *   - view='trash'    — trashed_at is not null
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  isNull,
  isNotNull,
  lt,
  gte,
  or,
  sql,
} from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "List meetings (Granola-style) the current user has access to. Use view='upcoming' / 'past' / 'all' / 'trash' to filter by lifecycle.",
  schema: z.object({
    view: z
      .enum(["upcoming", "past", "all", "trash"])
      .default("upcoming")
      .describe("Which list to show"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const nowIso = new Date().toISOString();

    const whereClauses = [accessFilter(schema.meetings, schema.meetingShares)];

    if (args.view === "trash") {
      whereClauses.push(isNotNull(schema.meetings.trashedAt));
    } else {
      whereClauses.push(isNull(schema.meetings.trashedAt));
    }

    if (args.view === "upcoming") {
      // Scheduled in the future and not yet finished.
      whereClauses.push(
        and(
          isNotNull(schema.meetings.scheduledStart),
          gte(schema.meetings.scheduledStart, nowIso),
          isNull(schema.meetings.actualEnd),
        )!,
      );
    } else if (args.view === "past") {
      // Either completed (actualEnd set) or scheduled-end in the past.
      whereClauses.push(
        or(
          isNotNull(schema.meetings.actualEnd),
          and(
            isNotNull(schema.meetings.scheduledEnd),
            lt(schema.meetings.scheduledEnd, nowIso),
          )!,
        )!,
      );
    }

    const orderBy =
      args.view === "upcoming"
        ? [asc(schema.meetings.scheduledStart)]
        : [
            desc(
              sql`COALESCE(${schema.meetings.actualStart}, ${schema.meetings.scheduledStart}, ${schema.meetings.createdAt})`,
            ),
          ];

    const rows = await db
      .select()
      .from(schema.meetings)
      .where(and(...whereClauses))
      .orderBy(...orderBy)
      .limit(args.limit)
      .offset(args.offset);

    // Add a derived `summaryPreview` (first ~100 chars of summaryMd) so the
    // Granola-style cards can render a one-liner without re-parsing markdown.
    const meetings = rows.map((m) => {
      const summary = (m.summaryMd ?? "").trim();
      const preview = summary
        ? summary.replace(/\s+/g, " ").slice(0, 100)
        : null;
      return { ...m, summaryPreview: preview };
    });

    return { meetings };
  },
});
