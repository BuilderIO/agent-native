import { defineAction } from "@agent-native/core";
import { getText, hasCollabState } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  extractManagedMotionCss,
  hashCss,
  parse,
} from "../shared/motion-compiler.js";
import type { MotionTrack } from "../shared/motion-timeline.js";

type TimelineSource = "stored" | "recovered-css" | "stored-css-drift";

interface TimelineResult {
  id: string | null;
  designId: string;
  sourceRef: string | null;
  filePath: string | null;
  tracks: unknown;
  durationMs: number;
  defaultEase: string;
  compiledHash: string | null;
  cssHash?: string | null;
  source: TimelineSource;
  createdAt: string | null;
  updatedAt: string | null;
}

async function liveFileContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  try {
    if (await hasCollabState(fileId)) {
      const live = await getText(fileId, "content");
      if (typeof live === "string") return live;
    }
  } catch {
    // Best-effort; SQL is the fallback.
  }
  return storedContent;
}

function parseTrackJson(raw: string | null): MotionTrack[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? (parsed as MotionTrack[]) : [];
  } catch {
    return [];
  }
}

async function readManagedCssForSource(args: {
  designId: string;
  sourceRef?: string;
}): Promise<{ css: string; hash: string; tracks: MotionTrack[] } | null> {
  if (!args.sourceRef) return null;

  const db = getDb();
  const [file] = await db
    .select({
      id: schema.designFiles.id,
      content: schema.designFiles.content,
    })
    .from(schema.designFiles)
    .where(
      and(
        eq(schema.designFiles.designId, args.designId),
        eq(schema.designFiles.id, args.sourceRef),
      ),
    )
    .limit(1);

  if (!file) return null;

  const content = await liveFileContent(file.id, file.content ?? "");
  const css = extractManagedMotionCss(content);
  if (!css) return null;

  const tracks = parse(css).filter(
    (track) =>
      track.keyframes.length > 0 &&
      track.keyframes.every((keyframe) => keyframe.value.trim().length > 0),
  );
  if (tracks.length === 0) return null;

  return { css, hash: hashCss(css), tracks };
}

export default defineAction({
  description:
    "Read one or all motion timelines for a design. " +
    "Returns timeline metadata (id, sourceRef, filePath, durationMs, " +
    "defaultEase, compiledHash) and the full tracks array (each track has " +
    "targetNodeId, property, and keyframes). If sourceRef points at a design " +
    "file and the metadata is missing or stale, recovers editable tracks from " +
    "the managed <style data-agent-native-motion> block. Read-only.",
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
    await assertAccess("design", designId, "viewer");

    const db = getDb();

    const conditions = [eq(schema.motionTimeline.designId, designId)];

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
      .where(and(...conditions))
      .orderBy(desc(schema.motionTimeline.updatedAt))
      .limit(timelineId ? 1 : 100);

    const timelines: TimelineResult[] = rows.map((row) => {
      return {
        id: row.id,
        designId: row.designId,
        sourceRef: row.sourceRef ?? null,
        filePath: row.filePath ?? null,
        tracks: parseTrackJson(row.tracks),
        durationMs: row.durationMs,
        defaultEase: row.defaultEase,
        compiledHash: row.compiledHash ?? null,
        cssHash: null,
        source: "stored",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    const managedCss = timelineId
      ? null
      : await readManagedCssForSource({ designId, sourceRef });

    if (managedCss) {
      const [first] = timelines;
      if (!first) {
        timelines.push({
          id: null,
          designId,
          sourceRef: sourceRef ?? null,
          filePath: null,
          tracks: managedCss.tracks,
          durationMs: 1000,
          defaultEase: "ease",
          compiledHash: managedCss.hash,
          cssHash: managedCss.hash,
          source: "recovered-css",
          createdAt: null,
          updatedAt: null,
        });
      } else if (first.compiledHash !== managedCss.hash) {
        timelines[0] = {
          ...first,
          tracks: managedCss.tracks,
          cssHash: managedCss.hash,
          source: "stored-css-drift",
        };
      } else {
        timelines[0] = {
          ...first,
          cssHash: managedCss.hash,
        };
      }
    }

    if (timelineId) {
      if (timelines.length === 0) {
        throw new Error(`Motion timeline not found: ${timelineId}`);
      }
      return { timeline: timelines[0] };
    }

    return { designId, timelines, count: timelines.length };
  },
});
