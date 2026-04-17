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

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseSpaceIds } from "../server/lib/recordings.js";
import { resolveAccess, ForbiddenError } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Fetch everything the player page needs for a recording: metadata, transcript, comments, reactions, chapters, CTAs, and the caller's effective role.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
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

    let transcriptSegments: { startMs: number; endMs: number; text: string }[] =
      [];
    if (transcript?.segmentsJson) {
      try {
        const parsed = JSON.parse(transcript.segmentsJson);
        if (Array.isArray(parsed)) transcriptSegments = parsed;
      } catch {}
    }

    // Normalize the dev-fallback videoUrl:
    //   1. Rewrite legacy `/api/uploads/:id/blob` to `/api/video/:id` so old
    //      rows keep playing after the route move.
    //   2. Non-owner viewers hitting a password-protected recording get the
    //      password appended so `<video>` can fetch through the blob route's
    //      password gate. Owners skip — the blob route bypasses the gate
    //      for them. Real provider URLs (R2/S3/Builder) are left untouched.
    let resolvedVideoUrl = rec.videoUrl ?? null;
    if (resolvedVideoUrl) {
      const legacyMatch = resolvedVideoUrl.match(
        /^\/api\/uploads\/([^/]+)\/blob$/,
      );
      if (legacyMatch) {
        resolvedVideoUrl = `/api/video/${legacyMatch[1]}`;
      }
      if (
        rec.password &&
        access.role !== "owner" &&
        resolvedVideoUrl.startsWith("/api/video/")
      ) {
        const sep = resolvedVideoUrl.includes("?") ? "&" : "?";
        resolvedVideoUrl =
          resolvedVideoUrl +
          sep +
          "password=" +
          encodeURIComponent(rec.password);
      }
    }

    return {
      role: access.role,
      recording: {
        id: rec.id,
        workspaceId: rec.workspaceId,
        title: rec.title,
        description: rec.description,
        thumbnailUrl: rec.thumbnailUrl,
        animatedThumbnailUrl: rec.animatedThumbnailUrl,
        durationMs: rec.durationMs,
        videoUrl: resolvedVideoUrl,
        videoFormat: rec.videoFormat,
        width: rec.width,
        height: rec.height,
        hasAudio: Boolean(rec.hasAudio),
        hasCamera: Boolean(rec.hasCamera),
        status: rec.status,
        password: rec.password,
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
            status: transcript.status,
            language: transcript.language,
            fullText: transcript.fullText,
            failureReason: transcript.failureReason,
            segments: transcriptSegments,
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
    };
  },
});
