import { createGetDb, getDbExec } from "@agent-native/core/db";
import {
  getAppProductionUrl,
  signShortLivedToken,
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

export const CLIPS_EMAIL_FROM = "Clips <clips@agent-native.com>";
const AI_SUMMARY_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export function aiSummaryTokenResourceId(recordingId: string): string {
  return `clip-ai-summary:${recordingId}`;
}

async function getRecordingSummaryCta(
  recording: typeof schema.recordings.$inferSelect,
  ctx: { recipientEmail: string },
): Promise<{ label: string; url: string } | undefined> {
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
  const appUrl = getAppProductionUrl().replace(/\/+$/, "");
  return {
    label: "Summarize with AI",
    url: `${appUrl}/r/${recording.id}?ai=summarize&token=${encodeURIComponent(token)}`,
  };
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
  getThumbnailUrl: (recording) => recording.thumbnailUrl ?? undefined,
  getSecondaryCta: getRecordingSummaryCta,
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
