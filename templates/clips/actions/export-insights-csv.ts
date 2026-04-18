/**
 * Export a CSV of every recording in the organization with view / engagement
 * counts. Returned as `text/csv` with Content-Disposition attachment so the
 * browser downloads it.
 *
 * Usage:
 *   pnpm action export-insights-csv
 *   pnpm action export-insights-csv --organizationId=<id>
 */

import { defineAction } from "@agent-native/core";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getActiveOrganizationId } from "../server/lib/recordings.js";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default defineAction({
  description:
    "Export every recording in the organization with view and engagement counts as a CSV attachment. Uses the active organization when organizationId is omitted.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe("Organization id — defaults to active organization"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();

    const organizationId =
      args.organizationId || (await getActiveOrganizationId());

    const recordings = organizationId
      ? await db
          .select()
          .from(schema.recordings)
          .where(eq(schema.recordings.organizationId, organizationId))
      : [];

    const recordingIds = recordings.map((r) => r.id);

    const viewCountByRec: Record<string, number> = {};
    const totalViewsByRec: Record<string, number> = {};
    if (recordingIds.length) {
      const viewers = await db
        .select()
        .from(schema.recordingViewers)
        .where(inArray(schema.recordingViewers.recordingId, recordingIds));
      for (const v of viewers) {
        totalViewsByRec[v.recordingId] =
          (totalViewsByRec[v.recordingId] ?? 0) + 1;
        if (v.countedView) {
          viewCountByRec[v.recordingId] =
            (viewCountByRec[v.recordingId] ?? 0) + 1;
        }
      }
    }

    const reactionsByRec: Record<string, number> = {};
    if (recordingIds.length) {
      const reactions = await db
        .select({
          recordingId: schema.recordingReactions.recordingId,
          count: sql<number>`COUNT(1)`,
        })
        .from(schema.recordingReactions)
        .where(inArray(schema.recordingReactions.recordingId, recordingIds))
        .groupBy(schema.recordingReactions.recordingId);
      for (const r of reactions) {
        reactionsByRec[r.recordingId] = Number(r.count ?? 0);
      }
    }

    const commentsByRec: Record<string, number> = {};
    if (recordingIds.length) {
      const comments = await db
        .select({
          recordingId: schema.recordingComments.recordingId,
          count: sql<number>`COUNT(1)`,
        })
        .from(schema.recordingComments)
        .where(inArray(schema.recordingComments.recordingId, recordingIds))
        .groupBy(schema.recordingComments.recordingId);
      for (const c of comments) {
        commentsByRec[c.recordingId] = Number(c.count ?? 0);
      }
    }

    const header = [
      "id",
      "title",
      "owner_email",
      "status",
      "visibility",
      "duration_ms",
      "views_counted",
      "views_total",
      "reactions",
      "comments",
      "created_at",
      "updated_at",
    ];

    const lines: string[] = [header.join(",")];
    for (const r of recordings) {
      lines.push(
        [
          r.id,
          r.title,
          r.ownerEmail,
          r.status,
          r.visibility,
          r.durationMs,
          viewCountByRec[r.id] ?? 0,
          totalViewsByRec[r.id] ?? 0,
          reactionsByRec[r.id] ?? 0,
          commentsByRec[r.id] ?? 0,
          r.createdAt,
          r.updatedAt,
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    const csv = lines.join("\n");
    const filename = `clips-insights-${formatDate(new Date())}.csv`;

    return {
      csv,
      filename,
      rows: recordings.length,
    };
  },
});
