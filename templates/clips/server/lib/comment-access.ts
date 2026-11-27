import { verifyShortLivedToken } from "@agent-native/core/server/short-lived-token";
import {
  assertAccess,
  ForbiddenError,
  type ResolvedAccess,
} from "@agent-native/core/sharing";

import {
  canReadRecordingComments,
  COMMENT_ACCESS_TOKEN_HEADER,
} from "../../shared/comment-access.js";
import { getCommentAccessTokenResourceId } from "./comment-access-token.js";
import {
  isRecordingExpiredForViewer,
  isRecordingTrashedForViewer,
  recordingUsesSharePassword,
} from "./recording-page-access.js";

export type CommentOperation = "read" | "write" | "delete";

export function commentAccessRefusal(
  recordingId: string,
  access: { role: string; resource: unknown },
  operation: CommentOperation,
  requestHeaders?: Headers,
): ForbiddenError | null {
  const recording = access.resource as {
    enableComments: boolean;
    visibility: "private" | "org" | "public";
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
    return new ForbiddenError();
  }

  if (
    isRecordingExpiredForViewer({
      expiresAt: recording.expiresAt,
      viewerIsOwner: access.role === "owner",
    })
  ) {
    return new ForbiddenError("Recording has expired");
  }
  // Turning comments off stops new discussion, not cleanup of saved history.
  if (
    operation === "read"
      ? !canReadRecordingComments({
          enableComments: recording.enableComments,
          viewerIsOwner: access.role === "owner",
        })
      : operation === "write" && !recording.enableComments
  ) {
    return new ForbiddenError();
  }
  if (
    recordingUsesSharePassword(recording.visibility) &&
    recording.password &&
    access.role !== "owner"
  ) {
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
      return new ForbiddenError();
    }
  }
  return null;
}

export async function assertCommentAccess(
  recordingId: string,
  operation: CommentOperation = "write",
  requestHeaders?: Headers,
): Promise<ResolvedAccess> {
  const access = await assertAccess("recording", recordingId, "viewer");
  const refusal = commentAccessRefusal(
    recordingId,
    access,
    operation,
    requestHeaders,
  );
  if (refusal) throw refusal;
  return access;
}
