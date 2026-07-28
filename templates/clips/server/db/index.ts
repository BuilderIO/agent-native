import { createGetDb, getDbExec } from "@agent-native/core/db";
import { organizations } from "@agent-native/core/org";
import { getAppProductionUrl } from "@agent-native/core/server";
import { registerShareableResource } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema, getDbExec };

/** Make a stored URL absolute for use in emails (relative paths won't load). */
function absoluteUrl(url: string | null | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("/")
    ? `${getAppProductionUrl()}${trimmed}`
    : trimmed;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the share-email preview for a recording: a 16:9 thumbnail with a
 * centered play badge, linking to the clip. Uses the background-image + VML
 * technique so the badge stays centered across clients, including Outlook. The
 * play badge is served from Clips' own public assets.
 */
function recordingShareHeroHtml(
  recording: { thumbnailUrl?: string | null },
  ctx: { href: string; alt?: string },
): string | undefined {
  const thumb = absoluteUrl(recording.thumbnailUrl);
  if (!thumb) return undefined;
  const url = escapeAttr(thumb);
  const href = escapeAttr(ctx.href);
  const title = escapeAttr(ctx.alt ?? "Play video");
  const badge = escapeAttr(`${getAppProductionUrl()}/play-badge.png`);
  const W = 488;
  const H = 275;
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0 0;">
        <tr>
          <td>
            <a href="${href}" style="display:block; text-decoration:none;" title="${title}">
              <!--[if mso]>
              <v:image xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${W}px;height:${H}px;" src="${url}" />
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="false" stroke="false" style="position:absolute;width:${W}px;height:${H}px;">
              <v:textbox inset="0,0,0,0"><center>
              <![endif]-->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${W}" height="${H}" background="${url}" style="width:100%; max-width:${W}px; height:${H}px; background-image:url('${url}'); background-size:cover; background-position:center; background-color:#141417; border-radius:12px;">
                <tr>
                  <td align="center" valign="middle" height="${H}" style="height:${H}px;">
                    <img src="${badge}" alt="Play video" width="64" height="64" style="width:64px; height:64px; border:0; display:inline-block;" />
                  </td>
                </tr>
              </table>
              <!--[if mso]></center></v:textbox></v:rect><![endif]-->
            </a>
          </td>
        </tr>
      </table>`;
}

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
