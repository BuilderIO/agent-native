import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Read one or all motion timelines for a design. " +
    "Returns timeline metadata (id, sourceRef, filePath, durationMs, " +
    "defaultEase, compiledHash) and the full tracks array (each track has " +
    "targetNodeId, property, and keyframes). Read-only.",
  readOnly: true,
  http: { method: "GET" },
  schema: z.object({
    designId: z.string().describe("Design project ID to read timelines for."),
    timelineId: z
      .string()
      .optional()
      .describe(
        "If provided, return only this specific timeline row. " +
          "Omit to list all timelines for the design.",
      ),
    sourceRef: z
      .string()
      .optional()
      .describe(
        "Filter by source ref (fileId for inline designs, routeId for " +
          "localhost/fusion). Ignored when timelineId is provided.",
      ),
  }),
  run: async ({ designId, timelineId, sourceRef }) => {
    const db = getDb();

    const conditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.motionTimeline.designId, designId),
    ];

    if (timelineId) {
      conditions.push(eq(schema.motionTimeline.id, timelineId));
    } else if (sourceRef) {
      conditions.push(eq(schema.motionTimeline.sourceRef, sourceRef));
    }

    const rows = await db
      .select({
        id: schema.motionTimeline.id,
        designId: schema.motionTimeline.designId,
        sourceRef: schema.motionTimeline.sourceRef,
        filePath: schema.motionTimeline.filePath,
        tracks: schema.motionTimeline.tracks,
        durationMs: schema.motionTimeline.durationMs,
        defaultEase: schema.motionTimeline.defaultEase,
        compiledHash: schema.motionTimeline.compiledHash,
        createdAt: schema.motionTimeline.createdAt,
        updatedAt: schema.motionTimeline.updatedAt,
      })
      .from(schema.motionTimeline)
      .innerJoin(
        schema.designs,
        eq(schema.motionTimeline.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(timelineId ? 1 : 100);

    const timelines = rows.map((row) => {
      let tracks: unknown = [];
      try {
        tracks = JSON.parse(row.tracks ?? "[]");
      } catch {
        tracks = [];
      }
      return {
        id: row.id,
        designId: row.designId,
        sourceRef: row.sourceRef ?? null,
        filePath: row.filePath ?? null,
        tracks,
        durationMs: row.durationMs,
        defaultEase: row.defaultEase,
        compiledHash: row.compiledHash ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    if (timelineId) {
      if (timelines.length === 0) {
        throw new Error(`Motion timeline not found: ${timelineId}`);
      }
      return { timeline: timelines[0] };
    }

    return { designId, timelines, count: timelines.length };
  },
});
