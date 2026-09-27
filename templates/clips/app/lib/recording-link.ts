import { appBasePath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  buildRecordingShareUrl,
  recordingSharePath,
} from "@shared/recording-link";

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

export async function copyRecordingShareLink(
  recordingId: string,
  ownerId?: string | null,
): Promise<boolean> {
  return writeClipboardText(recordingShareUrl(recordingId, ownerId));
}

export function freshRecordingShareUrl(
  recordingId: string,
  session: { userId?: string | null } | null | undefined,
): string {
  return recordingShareUrl(recordingId, session?.userId ?? undefined);
}

export async function copyFreshRecordingShareLink(
  recordingId: string,
  session: { userId?: string | null } | null | undefined,
): Promise<boolean> {
  return writeClipboardText(freshRecordingShareUrl(recordingId, session));
}
