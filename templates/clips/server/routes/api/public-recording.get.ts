/**
 * GET /api/public-recording?id=<recordingId>[&password=<pw>]
 *
 * Public read endpoint for share/:id and embed/:id pages — lets unauthenticated
 * viewers fetch a recording's player data without going through the
 * authenticated `/_agent-native/actions/get-recording-player-data` route.
 *
 * Only returns data when:
 *   - recording.visibility === 'public', AND
 *   - either no password is set, or the provided password matches
 *
 * For `org` or `private` visibility, returns 401 (viewer must sign in and use
 * the authenticated player route).
 */

import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import { parseSpaceIds } from "../../lib/recordings.js";

export default defineEventHandler(async (event) => {
  const q = getQuery(event) as { id?: string; password?: string };
  const recordingId = q.id;
  const password = typeof q.password === "string" ? q.password : "";

  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "id is required" };
  }

  const db = getDb();
  const [rec] = await db
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);

  if (!rec) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  if (rec.visibility !== "public") {
    setResponseStatus(event, 401);
    return {
      error: "Not publicly shared",
      visibility: rec.visibility,
    };
  }

  // Expiry check
  if (rec.expiresAt) {
    const expires = new Date(rec.expiresAt).getTime();
    if (isFinite(expires) && expires < Date.now()) {
      setResponseStatus(event, 410);
      return { error: "Recording has expired", expired: true };
    }
  }

  // Password check
  if (rec.password) {
    if (!password || password !== rec.password) {
      setResponseStatus(event, 401);
      return { error: "Password required", passwordRequired: true };
    }
  }

  const [transcript] = await db
    .select()
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId))
    .limit(1);

  const comments = rec.enableComments
    ? await db
        .select()
        .from(schema.recordingComments)
        .where(eq(schema.recordingComments.recordingId, recordingId))
        .orderBy(
          asc(schema.recordingComments.videoTimestampMs),
          asc(schema.recordingComments.createdAt),
        )
    : [];

  const reactions = rec.enableReactions
    ? await db
        .select()
        .from(schema.recordingReactions)
        .where(eq(schema.recordingReactions.recordingId, recordingId))
        .orderBy(asc(schema.recordingReactions.createdAt))
    : [];

  const ctas = await db
    .select()
    .from(schema.recordingCtas)
    .where(eq(schema.recordingCtas.recordingId, recordingId))
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

  let transcriptSegments: {
    startMs: number;
    endMs: number;
    text: string;
  }[] = [];
  if (transcript?.segmentsJson) {
    try {
      const parsed = JSON.parse(transcript.segmentsJson);
      if (Array.isArray(parsed)) transcriptSegments = parsed;
    } catch {}
  }

  // Normalize the dev-fallback videoUrl:
  //   1. Rewrite the legacy `/api/uploads/:id/blob` shape to the current
  //      `/api/video/:id` endpoint so old rows keep playing after the move.
  //   2. For password-protected recordings, bake the already-validated
  //      password into the query string so the <video> element's background
  //      fetch sails through the blob route's password gate. Real provider
  //      URLs (R2/S3/Builder) are left untouched; they're already signed.
  let resolvedVideoUrl = rec.videoUrl ?? null;
  if (resolvedVideoUrl) {
    const legacyMatch = resolvedVideoUrl.match(
      /^\/api\/uploads\/([^/]+)\/blob$/,
    );
    if (legacyMatch) {
      resolvedVideoUrl = `/api/video/${legacyMatch[1]}`;
    }
    if (rec.password && resolvedVideoUrl.startsWith("/api/video/")) {
      const sep = resolvedVideoUrl.includes("?") ? "&" : "?";
      resolvedVideoUrl =
        resolvedVideoUrl + sep + "password=" + encodeURIComponent(rec.password);
    }
  }

  return {
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
      // Don't leak the password to clients; just indicate whether one was set.
      hasPassword: !!rec.password,
      expiresAt: rec.expiresAt,
      enableComments: Boolean(rec.enableComments),
      enableReactions: Boolean(rec.enableReactions),
      enableDownloads: Boolean(rec.enableDownloads),
      defaultSpeed: rec.defaultSpeed,
      animatedThumbnailEnabled: Boolean(rec.animatedThumbnailEnabled),
      visibility: rec.visibility,
      spaceIds: parseSpaceIds(rec.spaceIds),
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    },
    transcript: transcript
      ? {
          status: transcript.status,
          language: transcript.language,
          fullText: transcript.fullText,
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
});
