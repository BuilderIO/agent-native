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

/**
 * Share URL for a recording the signed-in visitor just finished. Unlike the
 * reshare dialog, which must check the viewer's role, the recorder always owns
 * the row they just created, so no ownership check is needed. Omitting the
 * session drops `via`, and with it `referrer_user` on the signup.
 */
export function freshRecordingShareUrl(
  recordingId: string,
  session: { userId?: string | null } | null | undefined,
): string {
  return recordingShareUrl(recordingId, session?.userId ?? undefined);
}

/** Copy variant of {@link freshRecordingShareUrl}. */
export async function copyFreshRecordingShareLink(
  recordingId: string,
  session: { userId?: string | null } | null | undefined,
): Promise<boolean> {
  return writeClipboardText(freshRecordingShareUrl(recordingId, session));
}
