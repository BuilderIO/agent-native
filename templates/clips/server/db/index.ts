import { createGetDb, getDbExec } from "@agent-native/core/db";
import {
  getAppProductionUrl,
  signShortLivedToken,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { registerShareableResource } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import {
  CLIPS_USER_PREFS_KEY,
  isIncludeFullVideoInAiEnabled,
  type ClipsUserPrefs,
} from "../../shared/clips-ai-prefs.js";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema, getDbExec };

export const CLIPS_EMAIL_FROM = "Agent-Native Clips <clips@agent-native.com>";
// PNG, not SVG — several major email clients (Outlook, some webmail) don't
// render inline SVG at all, which silently dropped this logo before.
export const CLIPS_LOGO_PATH = "/agent-native-icon-dark.png";
export const CLIPS_LOGO_LABEL = "Clips";
const CLIPS_TAGLINE =
  "Clips is a 100% free, open-source, Agent-Native app for sharing screengrabs with friends and colleagues. No download required.";
const AI_SUMMARY_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export function aiSummaryTokenResourceId(recordingId: string): string {
  return `clip-ai-summary:${recordingId}`;
}

type RecordingRow = typeof schema.recordings.$inferSelect;

async function getRecordingSummaryCta(
  recording: RecordingRow,
  ctx: { recipientEmail: string },
): Promise<
  { label: string; url: string; tagline?: string } | undefined
> {
  if (recording.status !== "ready") return undefined;

  let prefs: ClipsUserPrefs | null = null;
  if (recording.ownerEmail) {
    try {
      prefs = (await getUserSetting(
        recording.ownerEmail,
        CLIPS_USER_PREFS_KEY,
      )) as ClipsUserPrefs | null;
    } catch {
      prefs = null;
    }
  }
  const includeFullVideoInAi = isIncludeFullVideoInAiEnabled(prefs);

  if (!includeFullVideoInAi) {
    const [transcript] = await getDb()
      .select({
        status: schema.recordingTranscripts.status,
        fullText: schema.recordingTranscripts.fullText,
      })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, recording.id))
      .limit(1);
    if (transcript?.status !== "ready" || !transcript.fullText?.trim()) {
      return undefined;
    }
  }

  const token = signShortLivedToken({
    resourceId: aiSummaryTokenResourceId(recording.id),
    viewerEmail: ctx.recipientEmail,
    ttlSeconds: AI_SUMMARY_TOKEN_TTL_SECONDS,
  });
  const appUrl = withConfiguredAppBasePath(
    getAppProductionUrl().replace(/\/+$/, ""),
  );
  return {
    label: "Summarize with AI",
    url: `${appUrl}/r/${recording.id}?ai=summarize&token=${encodeURIComponent(token)}`,
    tagline: CLIPS_TAGLINE,
  };
}

function getRecordingEmailThumbnailUrl(
  recording: RecordingRow,
): string | undefined {
  if (!recording.thumbnailUrl) return undefined;
  const appUrl = withConfiguredAppBasePath(
    getAppProductionUrl().replace(/\/+$/, ""),
  );
  return `${appUrl}/api/email-thumbnail/${recording.id}`;
}

const PREHEADER_MIN = 80;
const PREHEADER_MAX = 120;

function truncatePreheader(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= PREHEADER_MAX) return clean;
  const truncated = clean.slice(0, PREHEADER_MAX - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut =
    lastSpace > PREHEADER_MIN - 10 ? truncated.slice(0, lastSpace) : truncated;
  return `${cut}…`;
}

/**
 * Builds an 80-120 character preheader summarizing the recording's actual
 * content (not the generic "X shared ... with you" subject) so the inbox
 * preview line tells the recipient what's in the video before they open it.
 * Prefers the recording description, then falls back to a transcript
 * snippet, then the title alone.
 */
async function getRecordingPreheader(
  recording: RecordingRow,
): Promise<string | undefined> {
  const title = recording.title?.trim() || "";
  const description = recording.description?.trim();

  let source = description;
  if (!source) {
    const [transcript] = await getDb()
      .select({
        status: schema.recordingTranscripts.status,
        fullText: schema.recordingTranscripts.fullText,
      })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, recording.id))
      .limit(1);
    if (transcript?.status === "ready" && transcript.fullText?.trim()) {
      source = transcript.fullText.trim();
    }
  }

  const base = source ? (title ? `${title}: ${source}` : source) : title;
  if (!base) return undefined;
  return truncatePreheader(base);
}

registerShareableResource({
  type: "recording",
  resourceTable: schema.recordings,
  sharesTable: schema.recordingShares,
  displayName: "Recording",
  titleColumn: "title",
  getResourcePath: (recording) => `/r/${recording.id}`,
  getDb,
  ownerAccessIgnoresOrg: true,
  fromAddress: CLIPS_EMAIL_FROM,
  logoPath: CLIPS_LOGO_PATH,
  logoLabel: CLIPS_LOGO_LABEL,
  getThumbnailUrl: getRecordingEmailThumbnailUrl,
  getSecondaryCta: getRecordingSummaryCta,
  getPreheader: getRecordingPreheader,
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
