import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

import { isRecordingExpiredForViewer } from "./recording-page-access.js";

export async function assertCommentWritingAccess(
  recordingId: string,
): Promise<void> {
  const access = await assertAccess("recording", recordingId, "viewer");
  const recording = access.resource as {
    enableComments: boolean;
    expiresAt?: string | null;
  };

  if (
    isRecordingExpiredForViewer({
      expiresAt: recording.expiresAt,
      viewerIsOwner: access.role === "owner",
    })
  ) {
    throw new ForbiddenError("Recording has expired");
  }
  if (!recording.enableComments) {
    throw new ForbiddenError();
  }
}
