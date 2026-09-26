import { createGetDb, getDbExec } from "@agent-native/core/db";
import { organizations, registerIdentityColumns } from "@agent-native/core/org";
import { registerShareableResource } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  CLIPS_MEETING_AGENT_CONTEXT_ENDPOINT,
  CLIPS_MEETING_AGENT_RESOURCE_KIND,
} from "../../shared/meeting-agent-access.js";
import { usesOrganizationLogoRoute } from "../../shared/organization-logo.js";
import { recordingSharePath } from "../../shared/recording-link.js";
import { organizationLogoAbsoluteUrl } from "../lib/organization-logo.js";
import {
  absoluteUrl,
  recordingShareEmailExtras,
  recordingShareHeroHtml,
} from "../lib/share-email-hero.js";
import * as schema from "./schema.js";

type ClipsDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export const getDb = createGetDb(schema) as () => ClipsDatabase;
export { schema, getDbExec };

/**
 * Resolve the sharing org's brand logo as an absolute URL for share emails.
 * Returns undefined so `renderEmail` falls back to the Agent-Native logo when
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
  const stored = row?.brandLogoUrl?.trim();
  if (!stored) return undefined;
  return usesOrganizationLogoRoute(stored)
    ? organizationLogoAbsoluteUrl(organizationId)
    : absoluteUrl(stored);
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
  getResourcePath: (recording) => recordingSharePath(recording.id),
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

// Share tables are recognized from their shape; these are the rest.
registerIdentityColumns([
  {
    table: "space_members",
    column: "email",
    emailChange: "rekey",
    offboard: "delete",
    orgScope: {
      column: "space_id",
      references: { table: "spaces", column: "id", orgColumn: "workspace_id" },
    },
    reason: "Space membership grants access, so it ends with the membership.",
  },
  {
    table: "workspace_members",
    column: "email",
    emailChange: "rekey",
    offboard: "delete",
    orgScope: { column: "workspace_id" },
    reason:
      "Legacy workspace membership that the org migration copies into org_members.",
  },
  {
    table: "invites",
    column: "email",
    emailChange: "rekey",
    offboard: "delete",
    orgScope: { column: "workspace_id" },
    reason:
      "Legacy workspace invitation that the org migration copies into org_invitations.",
  },
  {
    table: "invites",
    column: "invited_by",
    emailChange: "rekey",
    offboard: "retain",
    reason: "Inviter attribution, rekeyed like org_invitations.invited_by.",
  },
  {
    table: "slack_installations",
    column: "secret_scope_id",
    mode: "secret-scope",
    emailChange: "rekey",
    offboard: "delete",
    reason:
      "User-scoped Slack install whose bot token is a user-scoped app secret.",
  },
  {
    table: "recording_comments",
    column: "author_email",
    emailChange: "rekey",
    offboard: "retain",
    reason: "Authorizes resolving your own comments; comments stay as history.",
  },
  {
    table: "recording_reactions",
    column: "viewer_email",
    emailChange: "rekey",
    offboard: "retain",
    reason: "Reaction attribution; reactions stay as history.",
  },
  {
    table: "recording_viewers",
    column: "viewer_email",
    emailChange: "retain",
    offboard: "retain",
    reason: "View analytics history keyed by viewer_key.",
  },
  {
    table: "recording_views",
    column: "viewer_email",
    emailChange: "retain",
    offboard: "retain",
    reason: "Append-only view log keyed by viewer_key.",
  },
  {
    table: "recording_playback_positions",
    column: "viewer_email",
    emailChange: "retain",
    offboard: "retain",
    reason: "Resume position keyed by viewer_key; grants no access.",
  },
  {
    table: "recording_bug_reports",
    column: "reporter_email",
    emailChange: "retain",
    offboard: "retain",
    reason: "Reporter contact supplied by the capture client, not a principal.",
  },
  {
    table: "recording_browser_diagnostics",
    column: "session_id",
    emailChange: "retain",
    offboard: "retain",
    reason: "Browser capture session id, not an identity.",
  },
  {
    table: "meeting_participants",
    column: "email",
    emailChange: "retain",
    offboard: "retain",
    reason: "Attendee address copied from the calendar provider.",
  },
  {
    table: "meeting_action_items",
    column: "assignee_email",
    emailChange: "retain",
    offboard: "retain",
    reason: "Attendee address inside meeting notes; grants no access.",
  },
  {
    table: "calendar_accounts",
    column: "email",
    emailChange: "retain",
    offboard: "retain",
    reason: "Address of the connected provider account, not the member.",
  },
  {
    table: "calendar_events",
    column: "organizer_email",
    emailChange: "retain",
    offboard: "retain",
    reason: "Organizer address copied from the calendar provider.",
  },
]);
