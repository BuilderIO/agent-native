import { verifyShortLivedToken } from "@agent-native/core/server/short-lived-token";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";

import {
  canReadRecordingComments,
  COMMENT_ACCESS_TOKEN_HEADER,
} from "../../shared/comment-access.js";
import { getCommentAccessTokenResourceId } from "./comment-access-token.js";
import {
  isRecordingExpiredForViewer,
  isRecordingTrashedForViewer,
} from "./recording-page-access.js";

export async function assertCommentAccess(
  recordingId: string,
  operation: "read" | "write" = "write",
  requestHeaders?: Headers,
): Promise<void> {
  const access = await assertAccess("recording", recordingId, "viewer");
  const recording = access.resource as {
    enableComments: boolean;
    password?: string | null;
    sharePasswordVersion?: string | null;
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
  if (recording.password && access.role !== "owner") {
    const token = requestHeaders?.get(COMMENT_ACCESS_TOKEN_HEADER);
    if (
      !token ||
      !verifyShortLivedToken(
        token,
        getCommentAccessTokenResourceId(
          recordingId,
          recording.password,
          recording.sharePasswordVersion,
        ),
      ).ok
    ) {
      throw new ForbiddenError();
    }
  }
}
