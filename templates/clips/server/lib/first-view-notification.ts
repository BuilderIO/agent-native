/**
 * One-time "it landed" email to a recording's owner, sent the first time any
 * viewer's countedView flips to true for that recording (5s / 75% / end-scrub
 * rule, same as the analytics counting rule). Best-effort, never throws into
 * the caller — `view-event.post.ts` fires this without awaiting.
 */

import { getDbExec } from "@agent-native/core/db";
import {
  emailStrong,
  getAppProductionUrl,
  isEmailConfigured,
  renderEmail,
  sendEmail,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { isSyntheticQaEmail } from "@agent-native/core/sharing/actions/share-resource";

import {
  CLIPS_EMAIL_FROM,
  CLIPS_LOGO_LABEL,
  resolveClipsLogoUrl,
} from "../db/index.js";

const HIGH_COMPLETION_PCT = 95;

export interface FirstViewRecording {
  id: string;
  title: string;
  ownerEmail: string;
  thumbnailUrl?: string | null;
}

export async function notifyOwnerOfFirstView(params: {
  recording: FirstViewRecording;
  viewerEmail: string | null;
  viewerName: string | null;
  completedPct: number;
}): Promise<void> {
  const { recording, viewerEmail, viewerName, completedPct } = params;
  if (!recording.ownerEmail) return;
  if (viewerEmail && viewerEmail === recording.ownerEmail) return;
  if (isSyntheticQaEmail(recording.ownerEmail)) return;
  if (!(await isEmailConfigured())) return;

  const claimedAt = new Date().toISOString();
  const claim = await getDbExec().execute({
    sql: `UPDATE recordings SET first_view_notified_at = ? WHERE id = ? AND first_view_notified_at IS NULL`,
    args: [claimedAt, recording.id],
  });
  if (claim.rowsAffected !== 1) return;

  const isAnonymous = !viewerEmail;
  const viewerLabel = isAnonymous ? "Someone" : viewerName || viewerEmail!;
  const subject = isAnonymous
    ? `Someone just watched "${recording.title}"`
    : `${viewerLabel} just watched "${recording.title}"`;

  const watchedVerb =
    completedPct >= HIGH_COMPLETION_PCT
      ? "watched the whole thing"
      : "watched enough of it to count as a real view";
  const watchedLine = isAnonymous
    ? `Someone opened ${emailStrong(recording.title)} and ${watchedVerb}.`
    : `${emailStrong(viewerLabel)} opened ${emailStrong(recording.title)} and ${watchedVerb}.`;

  const rawAppUrl = getAppProductionUrl().replace(/\/+$/, "");
  const appUrl = withConfiguredAppBasePath(rawAppUrl);
  const insightsUrl = `${appUrl}/r/${recording.id}?panel=insights`;

  const { html, text } = renderEmail({
    preheader: subject,
    logoUrl: resolveClipsLogoUrl(rawAppUrl),
    logoLabel: CLIPS_LOGO_LABEL,
    imageUrl: recording.thumbnailUrl ?? undefined,
    heading: "It landed.",
    paragraphs: [
      watchedLine,
      "This is the first time anyone's watched this one — nice work getting it in front of someone.",
    ],
    cta: { label: "See who's watching", url: insightsUrl },
    footer:
      "You'll only get this once per recording — for the first view. Everything else lives in your Insights tab.",
  });

  await sendEmail({
    to: recording.ownerEmail,
    subject,
    html,
    text,
    from: CLIPS_EMAIL_FROM,
  });
}
