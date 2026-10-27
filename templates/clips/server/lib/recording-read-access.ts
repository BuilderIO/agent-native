import { ForbiddenError } from "@agent-native/core/sharing";

import { isRecordingExpiredForViewer } from "./recording-page-access.js";

export function assertRecordingNotExpired<
  T extends {
    role: string;
    resource: { expiresAt: string | null | undefined };
  },
>(access: T): T {
  if (
    isRecordingExpiredForViewer({
      expiresAt: access.resource.expiresAt,
      viewerIsOwner: access.role === "owner",
    })
  ) {
    throw new ForbiddenError();
  }
  return access;
}
