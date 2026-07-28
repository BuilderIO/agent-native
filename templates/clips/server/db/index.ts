import { createGetDb, getDbExec } from "@agent-native/core/db";
import { getAppProductionUrl } from "@agent-native/core/server";
import { registerShareableResource } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema, getDbExec };

/**
 * Resolve the sharing org's brand logo as an absolute URL for share emails.
 * Returns undefined so `renderEmail` falls back to the Agent Native logo when
 * the org has no logo set.
 */
async function orgBrandLogoUrl(
  organizationId: string | undefined,
): Promise<string | undefined> {
  if (!organizationId) return undefined;
  const [row] = await getDb()
    .select({ brandLogoUrl: schema.organizationSettings.brandLogoUrl })
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.organizationId, organizationId))
    .limit(1);
  const logo = row?.brandLogoUrl?.trim();
  if (!logo) return undefined;
  return logo.startsWith("/") ? `${getAppProductionUrl()}${logo}` : logo;
}

registerShareableResource({
  type: "recording",
  resourceTable: schema.recordings,
  sharesTable: schema.recordingShares,
  displayName: "Recording",
  titleColumn: "title",
  getResourcePath: (recording) => `/r/${recording.id}`,
  getShareEmailLogoUrl: (recording) =>
    orgBrandLogoUrl(recording.organizationId),
  getDb,
  ownerAccessIgnoresOrg: true,
});

registerShareableResource({
  type: "meeting",
  resourceTable: schema.meetings,
  sharesTable: schema.meetingShares,
  displayName: "Meeting",
  titleColumn: "title",
  getResourcePath: (meeting) => `/meetings/${meeting.id}`,
  getDb,
});

registerShareableResource({
  type: "calendar-account",
  resourceTable: schema.calendarAccounts,
  sharesTable: schema.calendarAccountShares,
  displayName: "Calendar account",
  titleColumn: "displayName",
  getDb,
});

registerShareableResource({
  type: "dictation",
  resourceTable: schema.dictations,
  sharesTable: schema.dictationShares,
  displayName: "Dictation",
  // Dictations don't have a meaningful title field — fall back to id.
  titleColumn: "id",
  getDb,
});
