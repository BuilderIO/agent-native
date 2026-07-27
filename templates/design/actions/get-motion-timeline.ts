import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  extractManagedMotionCss,
  hashCss,
  parse,
  parseFirstAnimationDurationMs,
  parsePlaybackMode,
  parseTimelineSpanMs,
} from "../shared/motion-compiler.js";
import type {
  MotionPlaybackMode,
  MotionTrack,
} from "../shared/motion-timeline.js";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  readTimelinePlaybackMode,
} from "../shared/motion-timeline.js";

type TimelineSource = "stored" | "recovered-css" | "stored-css-drift";

interface TimelineResult {
  id: string | null;
  designId: string;
  sourceRef: string | null;
  filePath: string | null;
  tracks: unknown;
  durationMs: number;
  /**
   * Timeline playback mode: from the tracks JSON stamp for stored rows,
   * recovered from animation-iteration-count/direction for CSS-recovered
   * timelines, "once" for timelines that predate the field.
   */
  playbackMode: MotionPlaybackMode;
  defaultEase: string;
  compiledHash: string | null;
  cssHash?: string | null;
  source: TimelineSource;
  createdAt: string | null;
  updatedAt: string | null;
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
}): Promise<{
  css: string;
  hash: string;
  tracks: MotionTrack[];
  durationMs: number | null;
  playbackMode: MotionPlaybackMode | null;
} | null> {
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

  // Read the managed block from the SQL content, NOT a live collab snapshot:
  // apply-motion-edit persists the managed <style> block to SQL only, so a
  // live collab session's text lags the freshest motion CSS. Comparing the
  // stored compiledHash against stale collab CSS would flag phantom
  // "stored-css-drift" right after every save and replace fresh tracks with
  // stale CSS-parsed ones. SQL is the motion block's source of truth.
  const content = file.content ?? "";
  const css = extractManagedMotionCss(content);
  if (!css) return null;

  const tracks = parse(css).filter(
    (track) =>
      track.keyframes.length > 0 &&
      track.keyframes.every((keyframe) => keyframe.value.trim().length > 0),
  );
  if (tracks.length === 0) return null;

  return {
    css,
    hash: hashCss(css),
    tracks,
    // Timeline span (max delay + duration) is robust when tracks carry
    // per-track offsets/durations; fall back to the first duration.
    durationMs: parseTimelineSpanMs(css) ?? parseFirstAnimationDurationMs(css),
    playbackMode: parsePlaybackMode(css),
  };
}

export default defineAction({
  description:
    "Read one or all motion timelines for a design. " +
    "Returns timeline metadata (id, sourceRef, filePath, durationMs, " +
    "playbackMode [loop|once|ping-pong], defaultEase, compiledHash) and the " +
    "full tracks array (each track has targetNodeId, property, keyframes " +
    "with per-segment easing incl. spring(...)/linear(...), and optional " +
    "delayMs/durationMs start-offset timing). If sourceRef points at a " +
    "design file and the metadata is missing or stale, recovers editable " +
    "tracks (incl. offsets and playback mode) from the managed " +
    "<style data-agent-native-motion> block. Read-only.",
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
      const parsedTracks = parseTrackJson(row.tracks);
      return {
        id: row.id,
        designId: row.designId,
        sourceRef: row.sourceRef ?? null,
        filePath: row.filePath ?? null,
        tracks: parsedTracks,
        durationMs: row.durationMs,
        playbackMode:
          readTimelinePlaybackMode(parsedTracks) ??
          MOTION_DEFAULT_PLAYBACK_MODE,
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
          // Recover the compiled animation-duration instead of inventing a
          // default the next save would silently persist.
          durationMs: managedCss.durationMs ?? 1000,
          playbackMode: managedCss.playbackMode ?? MOTION_DEFAULT_PLAYBACK_MODE,
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
          // In the drift case the CSS is the runtime truth — surface its
          // compiled duration alongside its recovered tracks.
          durationMs: managedCss.durationMs ?? first.durationMs,
          playbackMode: managedCss.playbackMode ?? first.playbackMode,
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
