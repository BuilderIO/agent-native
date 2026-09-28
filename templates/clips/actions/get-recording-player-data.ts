import { defineAction, embedApp } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess, ForbiddenError } from "@agent-native/core/sharing";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isAgentRecordingCaller } from "../server/lib/agent-recording-access.js";
import { countRecordingAgentViews } from "../server/lib/agent-views.js";
import { isMediaVerificationPending } from "../server/lib/media-verification-state.js";
import { isHeldForRedaction } from "../server/lib/pending-redactions.js";
import { resolvePlayerThumbnailUrl } from "../server/lib/player-thumbnail-url.js";
import { resolvePlayerVideoUrl } from "../server/lib/player-video-url.js";
import {
  canOpenDirectRecordingPage,
  isRecordingExpiredForViewer,
} from "../server/lib/recording-page-access.js";
import { hasExplicitRecordingShare } from "../server/lib/recording-share-grant.js";
import {
  countRecordingViews,
  parseSpaceIds,
} from "../server/lib/recordings.js";
import { isSeekableRepairPending } from "../server/lib/seekable-media-state.js";
import { hydrateCommentAuthorNames } from "../server/lib/user-identities.js";
import { parseBrowserDiagnosticsRow } from "../shared/browser-diagnostics.js";
import {
  CLIPS_BUILDER_CREDITS_STATE_KEY,
  normalizeBuilderCreditsStatus,
} from "../shared/builder-credits.js";
import { displayCommentMentions } from "../shared/comment-mentions.js";
import {
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../shared/transcript-segments.js";
import { resolveTranscriptPresentation } from "../shared/transcript-status.js";
import { boundTranscriptForAgent } from "./lib/transcript-preview.js";

function safeJsonObject(raw: string | null | undefined) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function mapBugReport(row: typeof schema.recordingBugReports._.inferSelect) {
  return {
    recordingId: row.recordingId,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    severity: row.severity,
    sourceUrl: row.sourceUrl,
    pageTitle: row.pageTitle,
    appVersion: row.appVersion,
    environment: row.environment,
    reporterEmail: row.reporterEmail,
    reporterName: row.reporterName,
    reporterId: row.reporterId,
    metadata: safeJsonObject(row.metadataJson),
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function recordingDeepLink(recordingId: string): string {
  return buildDeepLink({
    app: "clips",
    view: "recording",
    params: { recordingId },
    to: `/r/${encodeURIComponent(recordingId)}`,
  });
}

export default defineAction({
  description:
    "Fetch everything the player page needs for a recording: metadata, transcript, comments, reactions, chapters, tags, CTAs, the counted-view total, and the caller's effective role. Agent calls receive a bounded transcript chunk; pass transcriptOffset from nextFullTextOffset until it is null to read the complete transcript. Browser player calls receive the full transcript.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    transcriptOffset: z.coerce.number().int().min(0).optional(),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Clip player",
      description: "Open this recording in the real Clips player.",
      iframeTitle: "Agent-Native Clips",
      openLabel: "Open clip",
      height: 680,
    }),
  },
  http: { method: "GET" },
  run: async (args, ctx) => {
    const access = await resolveAccess("recording", args.recordingId);
    if (!access) {
      throw new ForbiddenError(`No access to recording ${args.recordingId}`);
    }

    const db = getDb();
    const rec: any = access.resource;

    if (
      isRecordingExpiredForViewer({
        expiresAt: rec.expiresAt,
        viewerIsOwner: access.role === "owner",
      })
    ) {
      throw new ForbiddenError("Recording has expired");
    }

    const hasExplicitShare = await hasExplicitRecordingShare({
      recordingId: args.recordingId,
      role: access.role,
      visibility: rec.visibility,
      hasPassword: Boolean(rec.password),
      isAgentCaller: isAgentRecordingCaller(ctx?.caller),
    });

    if (
      !canOpenDirectRecordingPage({
        role: access.role,
        visibility: rec.visibility,
        hasPassword: Boolean(rec.password),
        hasExplicitShare,
      })
    ) {
      throw new ForbiddenError(
        "Open this recording from its share link instead of the direct recording URL",
      );
    }

    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);
    const canEditRecording =
      access.role === "owner" ||
      access.role === "admin" ||
      access.role === "editor";
    const canCommentRecording = true;
    const [
      cleanupStateRaw,
      builderCreditsRaw,
      verificationPending,
      seekableRepairPending,
      viewCount,
      agentViewCount,
    ] = await Promise.all([
      readAppState(`transcript-cleanup-${args.recordingId}`).catch(() => null),
      canEditRecording
        ? readAppState(CLIPS_BUILDER_CREDITS_STATE_KEY).catch(() => null)
        : Promise.resolve(null),
      isMediaVerificationPending({
        ownerEmail: rec.ownerEmail,
        recordingId: args.recordingId,
        recordingStatus: rec.status,
      }),
      isSeekableRepairPending({
        ownerEmail: rec.ownerEmail,
        recordingId: args.recordingId,
        recordingStatus: rec.status,
        videoUrl: rec.videoUrl,
      }),
      countRecordingViews(args.recordingId).catch(() => 0),
      countRecordingAgentViews(args.recordingId).catch(() => 0),
    ]);
    const cleanupState =
      cleanupStateRaw && typeof cleanupStateRaw === "object"
        ? (cleanupStateRaw as Record<string, unknown>)
        : null;
    const builderCredits = canEditRecording
      ? normalizeBuilderCreditsStatus(builderCreditsRaw)
      : null;

    const comments = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.recordingId, args.recordingId))
      .orderBy(
        asc(schema.recordingComments.videoTimestampMs),
        asc(schema.recordingComments.createdAt),
      );
    const hydratedComments = await hydrateCommentAuthorNames(comments);

    const reactions = await db
      .select()
      .from(schema.recordingReactions)
      .where(eq(schema.recordingReactions.recordingId, args.recordingId))
      .orderBy(asc(schema.recordingReactions.createdAt));

    const ctas = await db
      .select()
      .from(schema.recordingCtas)
      .where(eq(schema.recordingCtas.recordingId, args.recordingId))
      .orderBy(asc(schema.recordingCtas.createdAt));

    const tagRows = await db
      .selectDistinct({ tag: schema.recordingTags.tag })
      .from(schema.recordingTags)
      .where(eq(schema.recordingTags.recordingId, args.recordingId))
      .orderBy(asc(schema.recordingTags.tag));
    const tags = tagRows.map((row) => row.tag);

    const [browserDiagnosticsRow] = await db
      .select()
      .from(schema.recordingBrowserDiagnostics)
      .where(
        eq(schema.recordingBrowserDiagnostics.recordingId, args.recordingId),
      )
      .limit(1);
    const browserDiagnostics = parseBrowserDiagnosticsRow(
      browserDiagnosticsRow,
    );
    const canInspectSensitiveContext =
      access.role === "owner" ||
      access.role === "admin" ||
      access.role === "editor";
    const [bugReportRow] = await db
      .select()
      .from(schema.recordingBugReports)
      .where(eq(schema.recordingBugReports.recordingId, args.recordingId))
      .limit(1);

    let meeting: { id: string; title: string } | null = null;
    try {
      const [linkedMeeting] = await db
        .select({
          id: schema.meetings.id,
          title: schema.meetings.title,
        })
        .from(schema.meetings)
        .where(eq(schema.meetings.recordingId, args.recordingId))
        .limit(1);
      if (linkedMeeting) {
        meeting = { id: linkedMeeting.id, title: linkedMeeting.title };
      }
    } catch (err) {
      console.warn(
        "[get-recording-player-data] meeting lookup failed:",
        (err as Error)?.message ?? err,
      );
    }

    let chapters: { startMs: number; title: string }[] = [];
    try {
      const parsed = JSON.parse(rec.chaptersJson ?? "[]");
      if (Array.isArray(parsed)) {
        chapters = parsed.filter(
          (c: any) =>
            typeof c?.startMs === "number" && typeof c?.title === "string",
        );
      }
    } catch {}

    const transcriptSegments = normalizeTranscriptSegments({
      segments: parseTranscriptSegments(transcript?.segmentsJson),
      fullText: transcript?.fullText,
      durationMs: rec.durationMs,
    });
    const transcriptReadyButEmpty =
      transcript?.status === "ready" &&
      !transcript.fullText?.trim() &&
      transcriptSegments.length === 0;
    const transcriptPresentation = resolveTranscriptPresentation(transcript);
    const agentTranscript =
      ctx?.caller === "tool" || ctx?.caller === "mcp" || ctx?.caller === "a2a"
        ? boundTranscriptForAgent({
            fullText: transcript?.fullText,
            segments: transcriptSegments,
            fullTextOffset: args.transcriptOffset,
          })
        : null;

    const resolvedVideoUrl = resolvePlayerVideoUrl(rec, {
      addPasswordToken: access.role !== "owner",
      proxyRemoteMedia: true,
    });

    return {
      role: access.role,
      canComment: canCommentRecording,
      viewCount,
      agentViewCount,
      recording: {
        id: rec.id,
        organizationId: rec.organizationId,
        title: rec.title,
        description: rec.description,
        thumbnailUrl: resolvePlayerThumbnailUrl(rec),
        animatedThumbnailUrl: rec.animatedThumbnailUrl
          ? resolvePlayerThumbnailUrl(rec, { animated: true })
          : null,
        filmstripUrl: isHeldForRedaction(rec.editsJson, access.role)
          ? null
          : (rec.filmstripUrl ?? null),
        filmstripFrameCount: rec.filmstripFrameCount ?? 0,
        filmstripColumns: rec.filmstripColumns ?? 0,
        filmstripRows: rec.filmstripRows ?? 0,
        filmstripFrameWidth: rec.filmstripFrameWidth ?? 0,
        filmstripFrameHeight: rec.filmstripFrameHeight ?? 0,
        sourceAppName: rec.sourceAppName,
        sourceWindowTitle: rec.sourceWindowTitle,
        durationMs: rec.durationMs,
        editsJson: rec.editsJson,
        videoUrl: resolvedVideoUrl,
        videoFormat: rec.videoFormat,
        videoSizeBytes: rec.videoSizeBytes ?? null,
        mediaUpdatedAt: rec.mediaUpdatedAt ?? null,
        width: rec.width,
        height: rec.height,
        hasAudio: Boolean(rec.hasAudio),
        hasCamera: Boolean(rec.hasCamera),
        status: rec.status,
        verificationPending,
        seekableRepairPending,
        uploadProgress: rec.uploadProgress,
        failureReason: rec.failureReason,
        ...(canEditRecording
          ? {
              uploadAttemptId: rec.uploadAttemptId ?? null,
              uploadGenerationId: rec.uploadGenerationId ?? null,
            }
          : {}),
        hasPassword: !!rec.password,
        expiresAt: rec.expiresAt,
        enableComments: Boolean(rec.enableComments),
        enableReactions: Boolean(rec.enableReactions),
        enableDownloads: Boolean(rec.enableDownloads),
        defaultSpeed: rec.defaultSpeed,
        animatedThumbnailEnabled: Boolean(rec.animatedThumbnailEnabled),
        visibility: rec.visibility,
        ownerEmail: rec.ownerEmail,
        folderId: rec.folderId,
        spaceIds: parseSpaceIds(rec.spaceIds),
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        trashedAt: rec.trashedAt,
      },
      transcript: transcript
        ? {
            status: transcriptReadyButEmpty
              ? "failed"
              : transcriptPresentation.status,
            language: transcript.language,
            fullText: agentTranscript?.fullText ?? transcript.fullText,
            ...(agentTranscript
              ? {
                  fullTextLength: agentTranscript.fullTextLength,
                  fullTextOffset: agentTranscript.fullTextOffset,
                  nextFullTextOffset: agentTranscript.nextFullTextOffset,
                  segmentCount: agentTranscript.segmentCount,
                  previewTruncated: agentTranscript.previewTruncated,
                  note: agentTranscript.note,
                }
              : {}),
            failureReason: transcriptReadyButEmpty
              ? "No speech was detected by transcription. Check microphone and speech permissions, then retry transcription."
              : transcriptPresentation.failureReason,
            segments: agentTranscript?.segments ?? transcriptSegments,
            cleanup: cleanupState
              ? {
                  status:
                    typeof cleanupState.status === "string"
                      ? cleanupState.status
                      : "unknown",
                  provider:
                    typeof cleanupState.provider === "string"
                      ? cleanupState.provider
                      : null,
                  failureReason:
                    typeof cleanupState.failureReason === "string"
                      ? cleanupState.failureReason
                      : null,
                  updatedAt:
                    typeof cleanupState.updatedAt === "string"
                      ? cleanupState.updatedAt
                      : null,
                }
              : null,
          }
        : null,
      builderCredits,
      comments: hydratedComments.map((c) => ({
        id: c.id,
        recordingId: c.recordingId,
        threadId: c.threadId,
        parentId: c.parentId,
        authorEmail: c.authorEmail,
        authorName: c.authorName,
        content: c.content,
        mentions: displayCommentMentions(c.mentionsJson),
        videoTimestampMs: c.videoTimestampMs,
        emojiReactionsJson: c.emojiReactionsJson,
        resolved: Boolean(c.resolved),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      reactions: reactions.map((r) => ({
        id: r.id,
        emoji: r.emoji,
        videoTimestampMs: r.videoTimestampMs,
        viewerEmail: r.viewerEmail,
        viewerName: r.viewerName,
        createdAt: r.createdAt,
      })),
      chapters,
      tags,
      ctas: ctas.map((c) => ({
        id: c.id,
        label: c.label,
        url: c.url,
        color: c.color,
        placement: c.placement,
      })),
      browserDiagnostics: browserDiagnostics
        ? canInspectSensitiveContext
          ? browserDiagnostics
          : { summary: browserDiagnostics.summary }
        : null,
      bugReport:
        bugReportRow && canInspectSensitiveContext
          ? mapBugReport(bugReportRow)
          : null,
      meeting,
    };
  },
  link: ({ args }) => {
    return {
      url: recordingDeepLink(args.recordingId),
      label: "Open clip in Clips",
      view: "recording",
    };
  },
});
