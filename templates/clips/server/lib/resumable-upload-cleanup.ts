import { readAppState } from "@agent-native/core/application-state";
import type { FileUploadProvider } from "@agent-native/core/file-upload";

import {
  deleteResumableSession,
  getResumableSession,
  type StoredResumableSession,
} from "./resumable-session.js";
import { resolveResumableUploadProvider } from "./resumable-upload-provider.js";

export async function abortResumableUploadSession(
  session: StoredResumableSession,
  options: {
    provider?: FileUploadProvider | null;
    label?: string;
  } = {},
): Promise<boolean> {
  const label = options.label ?? "resumable upload";
  let provider = options.provider;
  if (provider === undefined) {
    try {
      provider = await resolveResumableUploadProvider(session.providerId);
    } catch (error) {
      console.warn(`[${label}] provider lookup failed:`, error);
      return false;
    }
  }

  if (!provider?.resumable?.abortSession) {
    console.warn(
      `[${label}] provider ${session.providerId} cannot abort the resumable session`,
    );
    return false;
  }

  try {
    await provider.resumable.abortSession({
      sessionId: session.sessionId,
      meta: session.meta,
    });
    return true;
  } catch (error) {
    console.warn(`[${label}] provider session cleanup failed:`, error);
    return false;
  }
}

/**
 * Aborts the recording's stored resumable session, if it has one, and drops
 * the stored handle only after the provider confirms. A session whose upload
 * is past "uploading" with no persisted media URL may have completed its
 * object, so aborting the old handle proves nothing and is refused. A failure
 * keeps the handle so the cleanup can be retried.
 */
export async function abortRecordingResumableSession(
  recordingId: string,
  generationId: string | null,
  options: { hasPersistedMediaUrl: boolean; label?: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await getResumableSession(recordingId, generationId);
  if (!session) return { ok: true };
  if (!options.hasPersistedMediaUrl) {
    const uploadState = await readAppState(`recording-upload-${recordingId}`);
    const state =
      uploadState && typeof uploadState === "object"
        ? (uploadState as Record<string, unknown>)
        : {};
    if (state.status !== "uploading" && state.aborted !== true) {
      return {
        ok: false,
        reason: "upload may have completed without a persisted media URL",
      };
    }
  }
  if (!(await abortResumableUploadSession(session, options))) {
    return { ok: false, reason: "resumable upload session was not aborted" };
  }
  await deleteResumableSession(recordingId, generationId);
  return { ok: true };
}
