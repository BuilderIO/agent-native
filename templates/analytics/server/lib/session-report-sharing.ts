import { getRequestOrgId } from "@agent-native/core/server";
import { ForbiddenError } from "@agent-native/core/sharing";

import { isSessionRecordingOpenToOrg } from "./session-replay.js";

type SharingChange =
  | { kind: "visibility"; visibility: "private" | "org" | "public" }
  | { kind: "grant" };

/**
 * The framework's share email and sharing responses carry a report's title
 * before any report read checks its recording, so a report opens to its
 * organization or to a person only while that whole organization can open the
 * recording, by the same rule report reads use. Making it private is always
 * allowed.
 */
export async function assertSessionReportSharingChange(
  resource: { orgId?: string | null; recordingId: string },
  change: SharingChange,
): Promise<void> {
  if (change.kind === "visibility" && change.visibility === "private") return;
  // Opening a report that has no organization to one attaches the caller's
  // active organization, and this check first sees the row from before that.
  const orgId =
    resource.orgId ??
    (change.kind === "visibility" ? getRequestOrgId() : undefined);
  if (
    !orgId ||
    !(await isSessionRecordingOpenToOrg(resource.recordingId, orgId))
  ) {
    throw new ForbiddenError(
      "A session report can be shared only while its recording is open to the whole organization.",
    );
  }
}
