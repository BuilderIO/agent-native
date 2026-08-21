import { createGetDb, getDbExec } from "@agent-native/core/db";
import { organizations } from "@agent-native/core/org";
import { registerShareableResource } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import {
  CLIPS_MEETING_AGENT_CONTEXT_ENDPOINT,
  CLIPS_MEETING_AGENT_RESOURCE_KIND,
} from "../../shared/meeting-agent-access.js";
import {
  absoluteUrl,
  recordingShareEmailExtras,
  recordingShareHeroHtml,
} from "../lib/share-email-hero.js";
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
  return absoluteUrl(row?.brandLogoUrl);
}

/** Show the sharing org's name beside the logo instead of the app name. */
async function orgBrandName(
  organizationId: string | undefined,
): Promise<string | undefined> {
  if (!organizationId) return undefined;
  const [row] = await getDb()
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.name?.trim() || undefined;
}

registerShareableResource({
  type: "recording",
  resourceTable: schema.recordings,
  sharesTable: schema.recordingShares,
  displayName: "Recording",
  titleColumn: "title",
  getResourcePath: (recording) => `/r/${recording.id}`,
  getLogoUrl: (recording) => orgBrandLogoUrl(recording.organizationId),
  getBrandName: (recording) => orgBrandName(recording.organizationId),
  // Replies reach the person who shared the clip; the sending address stays
  // the verified one so SPF/DKIM still pass.
  getSender: (_recording, ctx) => ({
    fromName: `${ctx.sender.name} via Clips`,
    replyTo: ctx.sender.email,
  }),
  getHeroHtml: (recording, ctx) => recordingShareHeroHtml(recording, ctx),
  getShareEmailExtras: (_recording, ctx) =>
    recordingShareEmailExtras({
      href: ctx.href,
      senderEmail: ctx.sender.email,
    }),
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
  agentReadable: {
    resourceKind: CLIPS_MEETING_AGENT_RESOURCE_KIND,
    getContextPath: () => CLIPS_MEETING_AGENT_CONTEXT_ENDPOINT,
    getPagePath: (meeting) =>
      `/share/meeting/${encodeURIComponent(meeting.id)}`,
  },
  getDb,
  ownerAccessIgnoresOrg: true,
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
