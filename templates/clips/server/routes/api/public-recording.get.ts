/**
 * GET /api/public-recording?id=<recordingId>[&password=<pw>]
 *
 * Public read endpoint for share/:id and embed/:id pages — lets unauthenticated
 * viewers fetch a recording's player data without going through the
 * authenticated `/_agent-native/actions/get-recording-player-data` route.
 *
 * Only returns data when:
 *   - recording.visibility === 'public' (or the signed-in viewer is owner), AND
 *   - either no password is set, the viewer is owner, or the provided password matches
 *
 * For `org` or `private` visibility, returns 401 (viewer must sign in and use
 * the authenticated player route).
 */

import { getSession, signShortLivedToken } from "@agent-native/core/server";
import { asc, eq } from "drizzle-orm";
import {
  defineEventHandler,
  getHeader,
  getQuery,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
  setCookie,
  type H3Event,
} from "h3";

import {
  agentAccessTokenResourceId,
  buildAgentApiUrls,
} from "../../../shared/agent-context.js";
import {
  normalizeTranscriptSegments,
  parseTranscriptSegments,
} from "../../../shared/transcript-segments.js";
import { getDb, schema } from "../../db/index.js";
import { resolvePlayerVideoUrl } from "../../lib/player-video-url.js";
import { parseSpaceIds, sameOwnerEmail } from "../../lib/recordings.js";
import { verifySharePassword } from "../../lib/share-password.js";

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

function appBasePath(): string {
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}` : "";
}

const PROTECTED_MEDIA_ACCESS_TTL_SECONDS = 6 * 60 * 60;
const PROTECTED_MEDIA_COOKIE_PREFIX = "clips_media_";

function protectedMediaCookieName(recordingId: string): string {
  return `${PROTECTED_MEDIA_COOKIE_PREFIX}${recordingId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function protectedMediaCookiePath(recordingId: string): string {
  return appPath(`/api/video/${encodeURIComponent(recordingId)}`);
}

function isHttpsRequest(event: H3Event): boolean {
  try {
    const xfProto = getHeader(event, "x-forwarded-proto");
    if (xfProto && String(xfProto).split(",")[0].trim() === "https") {
      return true;
    }
    const requestUrl = getRequestURL(event);
    if (requestUrl.protocol === "https:") return true;
    const appUrl = process.env.APP_URL || process.env.BETTER_AUTH_URL || "";
    if (appUrl.startsWith("https://")) return true;
  } catch {
    // keep plain-http dev behavior if request metadata is unavailable
  }
  return false;
}

function setProtectedMediaAccessCookie(
  event: H3Event,
  recordingId: string,
): string {
  const token = signShortLivedToken({
    resourceId: recordingId,
    ttlSeconds: PROTECTED_MEDIA_ACCESS_TTL_SECONDS,
  });
  const secure = isHttpsRequest(event);
  setCookie(event, protectedMediaCookieName(recordingId), token, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    ...(secure ? { partitioned: true } : {}),
    path: protectedMediaCookiePath(recordingId),
    maxAge: PROTECTED_MEDIA_ACCESS_TTL_SECONDS,
  });
  return token;
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function isLocalVideoRoute(value: string): boolean {
  try {
    const parsed = new URL(value, "http://local.test");
    return /(?:^|\/)api\/video\/[^/]+$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function addProtectedMediaTokenFallback(
  videoUrl: string | null,
  token: string | null,
): string | null {
  if (!videoUrl || !token || !isLocalVideoRoute(videoUrl)) return videoUrl;
  return appendQueryParam(videoUrl, "t", token);
}

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

  const session = await getSession(event).catch(() => null);
  const viewerIsOwner = Boolean(
    session?.email && sameOwnerEmail(session.email, rec.ownerEmail),
  );

  if (rec.visibility !== "public" && !viewerIsOwner) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
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
  let protectedMediaToken: string | null = null;
  if (rec.password && !viewerIsOwner) {
    if (!password || !verifySharePassword(password, rec.password)) {
      setResponseStatus(event, 401);
      return { error: "Password required", passwordRequired: true };
    }
    protectedMediaToken = setProtectedMediaAccessCookie(event, recordingId);
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

  const transcriptSegments = normalizeTranscriptSegments({
    segments: parseTranscriptSegments(transcript?.segmentsJson),
    fullText: transcript?.fullText,
    durationMs: rec.durationMs,
  });

  // Normalize the player videoUrl:
  //   1. Rewrite the legacy `/api/uploads/:id/blob` shape to the current
  //      `/api/video/:id` endpoint so old rows keep playing after the move.
  //   2. Keep all Loom imports behind the same-origin `/api/video/:id` access
  //      gate. Legacy Loom rows render an iframe inside that route; reuploaded
  //      Loom rows proxy their stored provider URL from the server.
  //   3. For password-protected public recordings, the password check above
  //      mints a signed media grant cookie scoped to `/api/video/:id`. We also
  //      append the same 6-hour token as a fallback for browsers/embeds that
  //      cannot use the cookie immediately. Sticking the plaintext password in
  //      the URL leaks it into browser history, CDN logs, and Referer headers.
  //      The downstream `/api/video/:id` route accepts `?t=<token>`, the media
  //      cookie, or `?password=<pw>` as a legacy fallback. (audit 11 F-07)
  //      Remote provider URLs (R2/S3/Builder) are kept behind the same-origin
  //      proxy on public pages so CORS, Range support, and fragile signed URLs
  //      fail in one server-controlled place instead of as opaque <video>
  //      errors in the browser.
  const resolvedVideoUrl = resolvePlayerVideoUrl(rec, {
    addPasswordToken: false,
    appPath,
    proxyRemoteMedia: true,
  });
  const playbackVideoUrl = addProtectedMediaTokenFallback(
    resolvedVideoUrl,
    protectedMediaToken,
  );

  const canExposeAgentContext =
    rec.visibility === "public" && !rec.archivedAt && !rec.trashedAt;
  const agentToken =
    canExposeAgentContext && rec.password
      ? signShortLivedToken({
          resourceId: agentAccessTokenResourceId(recordingId),
        })
      : undefined;
  const agentContextUrl = canExposeAgentContext
    ? buildAgentApiUrls(recordingId, {
        origin: getRequestURL(event).origin,
        basePath: appBasePath(),
        token: agentToken,
      }).contextUrl
    : null;

  // Don't leak the URL (which now carries a short-lived token) into the
  // Referer of any outbound link the share page renders.
  setResponseHeader(event, "Referrer-Policy", "no-referrer");

  return {
    recording: {
      id: rec.id,
      title: rec.title,
      description: rec.description,
      thumbnailUrl: rec.thumbnailUrl,
      animatedThumbnailUrl: rec.animatedThumbnailUrl,
      sourceAppName: rec.sourceAppName,
      durationMs: rec.durationMs,
      editsJson: rec.editsJson,
      videoUrl: playbackVideoUrl,
      videoFormat: rec.videoFormat,
      width: rec.width,
      height: rec.height,
      hasAudio: Boolean(rec.hasAudio),
      hasCamera: Boolean(rec.hasCamera),
      status: rec.status,
      uploadProgress: rec.uploadProgress,
      failureReason: rec.failureReason,
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
    agentContextUrl,
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
    viewer: session?.email
      ? {
          canEdit: viewerIsOwner,
          isOwner: viewerIsOwner,
          role: viewerIsOwner ? "owner" : "viewer",
        }
      : null,
  };
});
