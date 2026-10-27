import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

import { canReadRecordingComments } from "../../shared/comment-access.js";
import {
  isRecordingExpiredForViewer,
  isRecordingTrashedForViewer,
} from "./recording-page-access.js";

export async function assertCommentAccess(
  recordingId: string,
  operation: "read" | "write" = "write",
): Promise<void> {
  const access = await assertAccess("recording", recordingId, "viewer");
  const recording = access.resource as {
    enableComments: boolean;
    expiresAt?: string | null;
    trashedAt?: string | null;
  };

  if (
    isRecordingTrashedForViewer({
      trashedAt: recording.trashedAt,
      viewerIsOwner: access.role === "owner",
    })
  ) {
    throw new ForbiddenError();
  }

  if (
    isRecordingExpiredForViewer({
      expiresAt: recording.expiresAt,
      viewerIsOwner: access.role === "owner",
    })
  ) {
    throw new ForbiddenError("Recording has expired");
  }
  if (
    operation === "read"
      ? !canReadRecordingComments({
          enableComments: recording.enableComments,
          viewerIsOwner: access.role === "owner",
        })
      : !recording.enableComments
  ) {
    throw new ForbiddenError();
  }
}
