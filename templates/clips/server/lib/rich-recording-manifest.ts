import { z } from "zod";

import {
  RICH_RECORDING_FORMAT,
  RICH_RECORDING_VERSION,
  RICH_TRACK_IDS,
  richTrackFamily,
  richTrackFile,
  type RichTrackFamily,
  type RichTrackId,
} from "../../shared/rich-recording.js";

const MAX_RECORDING_MS = 24 * 60 * 60 * 1000;

const ms = z.number().int().min(0).max(MAX_RECORDING_MS);
const label = z.string().trim().min(1).max(200);
const rect = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});
const sync = z
  .array(z.tuple([z.number().finite(), ms]))
  .max(10_000)
  .optional();

// A track's kind-specific fields. Anything a recorder sends beyond these is
// dropped, so the manifest only ever says what this version understands.
const TRACK_META_SCHEMAS: Record<
  RichTrackFamily,
  z.ZodType<Record<string, unknown>>
> = {
  video: z.object({
    initBytes: z.number().int().min(0).optional(),
    codec: label.optional(),
    widthPx: z.number().int().min(0).optional(),
    heightPx: z.number().int().min(0).optional(),
    scale: z.number().finite().min(0).optional(),
    maxFps: z.number().finite().min(0).max(1000).optional(),
    cursor: z.enum(["hidden", "in-pixels", "in-pixels-when-moving"]).optional(),
    sync,
  }),
  audio: z.object({
    initBytes: z.number().int().min(0).optional(),
    codec: label.optional(),
    sampleRate: z.number().int().min(0).optional(),
    channels: z.number().int().min(1).max(8).optional(),
    sync,
  }),
  events: z.object({
    space: z.enum(["screen-px"]).optional(),
    moveIntervalMs: z.number().int().min(0).optional(),
    covers: z.enum(["global", "page"]).optional(),
    rrweb: label.optional(),
    checkoutMs: z.number().int().min(0).optional(),
    sync,
  }),
  transcript: z.object({
    provider: label.optional(),
    language: label.optional(),
  }),
};

const finalizeTrackSchema = z
  .object({
    id: z.enum(RICH_TRACK_IDS),
    startMs: ms,
    endMs: ms,
    complete: z.boolean(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((track) => track.endMs >= track.startMs, {
    message: "A track can't end before it starts.",
  });

export const finalizeRichRecordingSchema = z.object({
  uploadGenerationId: z.string().min(1).max(128).nullish(),
  status: z.enum(["complete", "recovered"]).default("complete"),
  startedAt: z.string().datetime({ offset: true }),
  durationMs: ms,
  segmentMs: z.number().int().min(0).optional(),
  fragmentMs: z.number().int().min(0).optional(),
  writer: z.object({
    surface: z.enum(["web", "extension", "desktop-macos", "desktop-windows"]),
    app: label,
    version: label,
    os: label,
  }),
  clock: z.object({
    host: z.enum([
      "performance.now",
      "mach-host-time",
      "query-performance-counter",
    ]),
    pauses: z
      .array(z.object({ atMs: ms, wallMs: z.number().int().min(0) }))
      .max(10_000)
      .default([]),
  }),
  capture: z.object({
    kind: z.enum(["display", "window", "tab", "region", "camera"]),
    displays: z
      .array(
        z.object({
          id: label,
          widthPx: z.number().int().min(0),
          heightPx: z.number().int().min(0),
          scale: z.number().finite().min(0),
          boundsPt: rect,
        }),
      )
      .max(32)
      .default([]),
    areaPt: rect.optional(),
  }),
  compat: z.object({
    offsetMs: z.number().int().min(-MAX_RECORDING_MS).max(MAX_RECORDING_MS),
    cursor: z.enum(["in-pixels", "none"]),
    camera: z.enum(["bubble", "none"]),
  }),
  privacy: z.object({
    keys: z.enum(["shortcuts", "all", "none"]),
    pageInputs: z.enum(["masked", "visible"]),
  }),
  tracks: z
    .array(finalizeTrackSchema)
    .min(1)
    .max(RICH_TRACK_IDS.length)
    .refine(
      (tracks) =>
        new Set(tracks.map((track) => track.id)).size === tracks.length,
      { message: "Each track is listed once." },
    ),
});

export type FinalizeRichRecordingInput = z.infer<
  typeof finalizeRichRecordingSchema
>;

/** The track's kind-specific fields this version keeps, or `{}`. */
export function sanitizeTrackMeta(
  track: RichTrackId,
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const parsed = TRACK_META_SCHEMAS[richTrackFamily(track)].safeParse(
    meta ?? {},
  );
  return parsed.success ? parsed.data : {};
}

export interface ManifestTrackRow {
  track: string;
  contentType: string;
  bytes: number;
  startMs: number;
  endMs: number;
  complete: boolean;
  metaJson: string;
}

/**
 * The manifest a rich recording's readers get. Written by the server from what
 * it stored, so a recorder that crashed can't leave a wrong one behind. Track
 * files are named relative to the manifest; Clips maps them to storage itself
 * and never puts a storage URL in the file.
 */
export function buildRichRecordingManifest(
  recordingId: string,
  input: Omit<FinalizeRichRecordingInput, "tracks" | "uploadGenerationId">,
  rows: ManifestTrackRow[],
) {
  const tracks = rows
    .filter((row): row is ManifestTrackRow & { track: RichTrackId } =>
      (RICH_TRACK_IDS as readonly string[]).includes(row.track),
    )
    .sort(
      (a, b) =>
        RICH_TRACK_IDS.indexOf(a.track) - RICH_TRACK_IDS.indexOf(b.track),
    )
    .map((row) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = sanitizeTrackMeta(row.track, JSON.parse(row.metaJson));
      } catch {
        meta = {};
      }
      return {
        ...meta,
        id: row.track,
        kind: row.track,
        startMs: row.startMs,
        endMs: row.endMs,
        file: richTrackFile(row.track, row.contentType),
        bytes: row.bytes,
        complete: row.complete,
      };
    });
  return {
    format: RICH_RECORDING_FORMAT,
    version: RICH_RECORDING_VERSION,
    recordingId,
    status: input.status,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    ...(input.segmentMs !== undefined ? { segmentMs: input.segmentMs } : {}),
    ...(input.fragmentMs !== undefined ? { fragmentMs: input.fragmentMs } : {}),
    writer: input.writer,
    clock: input.clock,
    capture: input.capture,
    tracks,
    compat: input.compat,
    privacy: input.privacy,
  };
}
