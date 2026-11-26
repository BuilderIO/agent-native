/**
 * A rich recording keeps one recording's sources as separate tracks on one
 * clock, in recording milliseconds, beside the flattened video every other
 * feature plays. The flattened video stays at `video_url`; the tracks are
 * owner-only files described by a `manifest.json` the server writes at
 * finalize.
 */

export const RICH_RECORDING_FORMAT = "clips.rich-recording";
export const RICH_RECORDING_VERSION = 1;

export const RICH_TRACK_IDS = [
  "screen",
  "camera",
  "mic",
  "system",
  "input",
  "page",
  "transcript",
] as const;

export type RichTrackId = (typeof RICH_TRACK_IDS)[number];

/** The manifest's own file, served by the same owner-only route as a track. */
export const RICH_MANIFEST_FILE = "manifest";

export type RichTrackFamily = "video" | "audio" | "events" | "transcript";

interface RichTrackSpec {
  family: RichTrackFamily;
  /** The file's name in the manifest, relative to it. */
  file: string;
  /** Content types a recorder may send for this track, without parameters. */
  contentTypes: readonly string[];
}

const RICH_TRACK_SPECS: Record<RichTrackId, RichTrackSpec> = {
  screen: {
    family: "video",
    file: "screen.mp4",
    contentTypes: ["video/mp4", "video/webm"],
  },
  camera: {
    family: "video",
    file: "camera.mp4",
    contentTypes: ["video/mp4", "video/webm"],
  },
  mic: {
    family: "audio",
    file: "mic.mp4",
    contentTypes: ["audio/mp4", "audio/webm"],
  },
  system: {
    family: "audio",
    file: "system.mp4",
    contentTypes: ["audio/mp4", "audio/webm"],
  },
  input: {
    family: "events",
    file: "input.jsonl.gz",
    contentTypes: ["application/gzip"],
  },
  page: {
    family: "events",
    file: "page.jsonl.gz",
    contentTypes: ["application/gzip"],
  },
  transcript: {
    family: "transcript",
    file: "transcript.json",
    contentTypes: ["application/json"],
  },
};

export function isRichTrackId(value: unknown): value is RichTrackId {
  return (
    typeof value === "string" &&
    (RICH_TRACK_IDS as readonly string[]).includes(value)
  );
}

export function richTrackFamily(track: RichTrackId): RichTrackFamily {
  return RICH_TRACK_SPECS[track].family;
}

/** The manifest's relative name for a track's file. */
export function richTrackFile(track: RichTrackId, contentType: string): string {
  const spec = RICH_TRACK_SPECS[track];
  if (contentType.endsWith("/webm")) return `${track}.webm`;
  return spec.file;
}

/** The track's content type without parameters, or null when it isn't one the track takes. */
export function normalizeRichTrackContentType(
  track: RichTrackId,
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const base = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return RICH_TRACK_SPECS[track].contentTypes.includes(base) ? base : null;
}
