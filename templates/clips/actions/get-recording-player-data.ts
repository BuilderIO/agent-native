/**
 * Fetch all data the player page needs in one call:
 *   - recording fields
 *   - visibility + access role
 *   - transcript
 *   - comments (flat list — UI groups into threads)
 *   - reactions
 *   - chapters (parsed from recording.chaptersJson)
 *   - tags
 *   - CTAs
 *   - counted-view total
 *
 * This is the read endpoint the player/:id and share/:id routes use.
 * Access is gated by assertAccess at viewer level — for public-visibility
 * recordings, any signed-in user can view; for password-protected ones, the
 * route enforces the password before invoking this action.
 *
 * Usage:
 *   pnpm action get-recording-player-data --recordingId=<id>
 */

import { defineAction, embedApp } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess, ForbiddenError } from "@agent-native/core/sharing";
import {
  isImageRecording,
  resolveRecordingKind,
} from "@shared/recording-kind.js";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
/**
 * `editsJson` with a screenshot's editing record stripped out — see the
 * matching helper on the public endpoint.
 */
function withoutScreenshotEdits(editsJson: string | null): string {
  try {
    const parsed = JSON.parse(editsJson || "{}") as Record<string, unknown>;
    delete parsed.redactions;
    delete parsed.annotations;
    // Where pending redaction boxes sit says where the secret is.
    delete parsed.overlays;
    delete parsed.crop;
    return JSON.stringify(parsed);
  } catch {
    return "{}";
  }
}

/**
 * The movable marks stored on a screenshot, if any.
 *
 * They live alongside the video editor's own entries in `editsJson`, so this
 * reads defensively: anything unexpected in there is treated as "no marks"
 * rather than handed to the editor.
 */
function screenshotAnnotationsOf(editsJson: string | null): unknown[] {
  try {
    const parsed = JSON.parse(editsJson || "{}");
    const annotations = (parsed as { annotations?: unknown }).annotations;
    return Array.isArray(annotations) ? annotations : [];
  } catch {
    return [];
  }
}


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
    // Reaching this action already requires a signed-in session with at
    // least viewer access to the recording (`resolveAccess` above), so any
    // resolved role qualifies to comment/react — no separate "commenter"
    // tier.
    const canCommentRecording = true;
    // This action is on a 1-3s poll from the player, so every read here shares
    // one Promise.all instead of adding serial round-trips.
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

    // DISTINCT because `recording_tags` carries no unique (recording_id, tag)
    // constraint: `tag-recording` checks-then-inserts, so two editors adding
    // the same tag at once can leave duplicate rows. The player should not
    // render the same tag twice on account of that.
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

    // Reverse-lookup: if a meeting captured this recording, surface it so the
    // player can show a "From meeting: <title>" badge linking back to the
    // meeting detail page. We don't need an FK on recordings — the meetings
    // table already points at recording_id.
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
      // Best-effort — a missing meetings table on a fresh install shouldn't
      // break the player.
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

    // Normalize the dev-fallback videoUrl:
    //   1. Rewrite legacy `/api/uploads/:id/blob` to `/api/video/:id` so old
    //      rows keep playing after the route move.
    //   2. Keep Loom imports behind the same-origin `/api/video/:id` access
    //      gate. Legacy Loom rows render an iframe inside that route; reuploaded
    //      Loom rows proxy their stored provider URL from the server.
    //   3. For password-protected recordings, mint a short-lived HMAC token
    //      bound to this recording id and pass it via `?t=<token>` instead of
    //      the plaintext password. Sticking the password in the URL leaks it
    //      into browser history, CDN logs, the Referer header on outbound
    //      requests, and — most importantly here — into MCP-host tool results
    //      (any MCP client receiving this action's structured output would
    //      otherwise see the plaintext password). The downstream
    //      `/api/video/:id` route accepts either `?t=<token>` (preferred) or
    //      `?password=<pw>` (legacy fallback) so old share pages keep
    //      working during rollout. (audit 11 F-07)
    //      Owners are skipped — the blob route bypasses the password gate
    //      for them, so they don't need the token. Remote provider URLs are
    //      still proxied through same-origin media serving so CORS, range
    //      requests, and signed URL quirks match public share playback.
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
        kind: resolveRecordingKind(rec.kind),
        // A screenshot is served through the thumbnail route, which is the
        // full stored image and already enforces the share password, expiry
        // and visibility — the same gate the video URL goes through.
        imageUrl: isImageRecording(rec) ? resolvePlayerThumbnailUrl(rec) : null,
        // Editing material, for people who can edit. A viewer is served the
        // flattened picture and nothing else — the base is the same image
        // without the movable marks, so there is no reason to hand it out.
        // Proxied like every other media URL: the stored object lives in a
        // private bucket the browser cannot reach directly.
        baseImageUrl:
          isImageRecording(rec) && canEditRecording
            ? (resolvePlayerThumbnailUrl(rec, { base: true }) ??
              resolvePlayerThumbnailUrl(rec))
            : null,
        annotations:
          isImageRecording(rec) && canEditRecording
            ? screenshotAnnotationsOf(rec.editsJson)
            : [],
        thumbnailUrl: resolvePlayerThumbnailUrl(rec),
        animatedThumbnailUrl: rec.animatedThumbnailUrl
          ? resolvePlayerThumbnailUrl(rec, { animated: true })
          : null,
        // The filmstrip is a sheet of unredacted frames, and unlike the
        // video it is fetched straight from storage rather than through a
        // route that can refuse. Held from anyone who cannot finish the burn,
        // the same test every other media path uses.
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
        // Same reasoning as the public endpoint: a viewer of a screenshot has
        // no use for the mark list, and `redactions` would tell them where
        // content was hidden and how much of it there was.
        editsJson:
          isImageRecording(rec) && !canEditRecording
            ? withoutScreenshotEdits(rec.editsJson)
            : rec.editsJson,
        videoUrl: resolvedVideoUrl,
        videoFormat: rec.videoFormat,
        videoSizeBytes: rec.videoSizeBytes ?? null,
        // The version of the stored bytes. A redaction burn or a screenshot
        // edit replaces the file behind a URL that stays the same, so without
        // this the browser keeps showing the copy it already has.
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
        // Don't leak the password to clients (especially to MCP hosts that
        // surface action results to third-party agents); just indicate
        // whether one was set. The videoUrl above already carries a
        // short-lived `?t=<token>` for non-owner viewers, so the player
        // can stream without ever seeing the plaintext password.
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
