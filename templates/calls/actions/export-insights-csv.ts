/**
 * Export the viewers table for a call as a CSV string.
 * Columns: viewer_email, first_viewed_at, total_watch_ms, completed_pct,
 * counted_view.
 *
 * Usage:
 *   pnpm action export-insights-csv --callId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { writeAppState, readAppState } from "@agent-native/core/application-state";

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
    "Export the viewers table for a call as a CSV string. Columns: viewer_email, first_viewed_at, total_watch_ms, completed_pct, counted_view. Editor-only.",
  schema: z.object({
    callId: z.string().describe("Call id"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();
    const [call] = await db
      .select({ title: schema.calls.title })
      .from(schema.calls)
      .where(eq(schema.calls.id, args.callId))
      .limit(1);
    if (!call) throw new Error(`Call not found: ${args.callId}`);

    const viewers = await db
      .select()
      .from(schema.callViewers)
      .where(eq(schema.callViewers.callId, args.callId));

    const header = [
      "viewer_email",
      "first_viewed_at",
      "total_watch_ms",
      "completed_pct",
      "counted_view",
    ];
    const lines: string[] = [header.join(",")];
    for (const v of viewers) {
      lines.push(
        [
          v.viewerEmail ?? "",
          v.firstViewedAt ?? "",
          v.totalWatchMs ?? 0,
          v.completedPct ?? 0,
          v.countedView ? "true" : "false",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    const csv = lines.join("\n");
    const filename = `calls-viewers-${args.callId}-${formatDate(new Date())}.csv`;

    return { csv, filename, rows: viewers.length };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void writeAppState;
void readAppState;
void accessFilter;
