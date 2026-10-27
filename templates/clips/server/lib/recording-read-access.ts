import { ForbiddenError } from "@agent-native/core/sharing";

import {
  isRecordingExpiredForViewer,
  isRecordingExpiredForEmail,
} from "./recording-page-access.js";

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

export function assertRecordingNotExpiredForEmail(
  recording: {
    ownerEmail: string | null | undefined;
    expiresAt: string | null | undefined;
  },
  viewerEmail: string | null | undefined,
): void {
  if (isRecordingExpiredForEmail(recording, viewerEmail))
    throw new ForbiddenError();
}
