import type { FileUploadProvider } from "@agent-native/core/file-upload";

import type { StoredResumableSession } from "./resumable-session.js";
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
