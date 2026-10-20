/**
 * What a `recordings` row holds.
 *
 * Clips started video-only, so every historical row is a `video` and the
 * column defaults to it. A `screenshot` row is a single still image: it owns
 * `imageUrl` instead of `videoUrl`, is created already `ready` (there is no
 * chunked upload to wait on), and never acquires a duration, transcript,
 * filmstrip or editable timeline. Anything that derives one of those must
 * skip image rows rather than fail on the missing video file.
 *
 * Everything else — sharing, share passwords, expiry, folders, spaces, tags,
 * comments, search — is deliberately shared with video recordings, which is
 * the whole reason screenshots live in this table.
 */

export const RECORDING_KINDS = ["video", "image"] as const;

export type RecordingKind = (typeof RECORDING_KINDS)[number];

export const DEFAULT_RECORDING_KIND: RecordingKind = "video";

export function isRecordingKind(value: unknown): value is RecordingKind {
  return (
    typeof value === "string" &&
    (RECORDING_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Coerce a stored / transported value to a kind. Null, undefined and anything
 * unrecognised read as `video`: rows written before the column existed have no
 * kind, and a row that isn't explicitly an image is a video.
 */
export function resolveRecordingKind(value: unknown): RecordingKind {
  return isRecordingKind(value) ? value : DEFAULT_RECORDING_KIND;
}

export function isImageRecording(
  recording: { kind?: string | null } | null | undefined,
): boolean {
  return resolveRecordingKind(recording?.kind) === "image";
}

/** The file extension for a downloaded screenshot, from its bytes' type. */
export function screenshotFileExtension(mimeType: string): string {
  const type = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  return "jpg";
}
