/**
 * Fetch all data the player page needs in one call:
 *   - recording fields
 *   - visibility + access role
 *   - transcript
 *   - comments (flat list — UI groups into threads)
 *   - reactions
 *   - chapters (parsed from recording.chaptersJson)
 *   - CTAs
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
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolvePlayerVideoUrl } from "../server/lib/player-video-url.js";
import { parseSpaceIds } from "../server/lib/recordings.js";
import { parseBrowserDiagnosticsRow } from "../shared/browser-diagnostics.js";
import {
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../shared/transcript-segments.js";

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
    "Fetch everything the player page needs for a recording: metadata, transcript, comments, reactions, chapters, CTAs, and the caller's effective role.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
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
  run: async (args) => {
    const access = await resolveAccess("recording", args.recordingId);
    if (!access) {
      throw new ForbiddenError(`No access to recording ${args.recordingId}`);
    }

    const db = getDb();
    const rec: any = access.resource;

    const [transcript] = await db
      .select()
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);
    const cleanupStateRaw = await readAppState(
      `transcript-cleanup-${args.recordingId}`,
    ).catch(() => null);
    const cleanupState =
      cleanupStateRaw && typeof cleanupStateRaw === "object"
        ? (cleanupStateRaw as Record<string, unknown>)
        : null;

    const comments = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.recordingId, args.recordingId))
      .orderBy(
        asc(schema.recordingComments.videoTimestampMs),
        asc(schema.recordingComments.createdAt),
      );

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
    //      for them, so they don't need the token. Non-Loom provider URLs
    //      (R2/S3/Builder) are left untouched; those are already signed.
    const resolvedVideoUrl = resolvePlayerVideoUrl(rec, {
      addPasswordToken: access.role !== "owner",
    });

    return {
      role: access.role,
      recording: {
        id: rec.id,
        organizationId: rec.organizationId,
        title: rec.title,
        description: rec.description,
        thumbnailUrl: rec.thumbnailUrl,
        animatedThumbnailUrl: rec.animatedThumbnailUrl,
        sourceAppName: rec.sourceAppName,
        sourceWindowTitle: rec.sourceWindowTitle,
        durationMs: rec.durationMs,
        editsJson: rec.editsJson,
        videoUrl: resolvedVideoUrl,
        videoFormat: rec.videoFormat,
        width: rec.width,
        height: rec.height,
        hasAudio: Boolean(rec.hasAudio),
        hasCamera: Boolean(rec.hasCamera),
        status: rec.status,
        uploadProgress: rec.uploadProgress,
        failureReason: rec.failureReason,
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
        spaceIds: parseSpaceIds(rec.spaceIds),
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      },
      transcript: transcript
        ? {
            status: transcriptReadyButEmpty ? "failed" : transcript.status,
            language: transcript.language,
            fullText: transcript.fullText,
            failureReason: transcriptReadyButEmpty
              ? "No speech was detected by transcription. Check microphone and speech permissions, then retry transcription."
              : transcript.failureReason,
            segments: transcriptSegments,
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
      comments: comments.map((c) => ({
        id: c.id,
        recordingId: c.recordingId,
        threadId: c.threadId,
        parentId: c.parentId,
        authorEmail: c.authorEmail,
        authorName: c.authorName,
        content: c.content,
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
