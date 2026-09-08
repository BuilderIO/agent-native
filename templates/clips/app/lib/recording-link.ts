import { appBasePath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  buildRecordingShareUrl,
  recordingSharePath,
} from "@shared/recording-link";

/** Absolute, ready-to-paste public share URL for a recording. */
export function recordingShareUrl(
  recordingId: string,
  ownerId?: string | null,
): string {
  if (typeof window === "undefined") return recordingSharePath(recordingId);
  return buildRecordingShareUrl({
    recordingId,
    origin: window.location.origin,
    basePath: appBasePath(),
    ownerId,
  });
}

/**
 * Copy a recording's public share link. Returns whether the write actually
 * landed so callers can tell the user the truth instead of assuming a silent
 * `navigator.clipboard` rejection was a success.
 */
export async function copyRecordingShareLink(
  recordingId: string,
  ownerId?: string | null,
): Promise<boolean> {
  return writeClipboardText(recordingShareUrl(recordingId, ownerId));
}
