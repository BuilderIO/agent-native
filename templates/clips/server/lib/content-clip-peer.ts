/**
 * The Clips side of a Clip placed in an Agent-Native Content document.
 * Content vouches, with a short A2A token, for who is reading which document;
 * Clips decides what that reader may do with the one Clip the token names.
 * The token contract is in `shared/content-clip-contract.ts`.
 */
import { verifyA2AToken } from "@agent-native/core/a2a";
import {
  getAppProductionUrl,
  readBodyWithSizeLimit,
  runWithRequestContext,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { ForbiddenError, resolveAccess } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getQuery, getRequestHeader, getRouterParam, type H3Event } from "h3";
import { z } from "zod";

import addComment from "../../actions/add-comment.js";
import deleteComment from "../../actions/delete-comment.js";
import reactToComment from "../../actions/react-to-comment.js";
import replyToComment from "../../actions/reply-to-comment.js";
import resolveComment from "../../actions/resolve-comment.js";
import updateComment from "../../actions/update-comment.js";
import { canReadRecordingComments } from "../../shared/comment-access.js";
import {
  CONTENT_CLIP_AUDIENCE_PATH,
  CONTENT_CLIP_CLAIMS,
  CONTENT_CLIP_COMMENT_AUTHOR_CHARS,
  CONTENT_CLIP_COMMENT_PREVIEW_CHARS,
  CONTENT_CLIP_MAX_COMMENT_THREADS,
  CONTENT_CLIP_MAX_TOKEN_SECONDS,
  CONTENT_CLIP_PUBLIC_READER,
  CONTENT_CLIP_RECORDING_TITLE_CHARS,
  CONTENT_CLIP_SCOPES,
  type ContentClipScope,
} from "../../shared/content-clip-contract.js";
import { recordingEmbedProvider } from "../../shared/embed-provider.js";
import { getDb, schema } from "../db/index.js";
import { assertCommentAccess } from "./comment-access.js";
import {
  contentDocGrantFor,
  findContentBinding,
  type ContentClipBinding,
} from "./content-clip-bindings.js";
import { runWithContentDocGrant } from "./content-doc-grant.js";
import { readContentPeerSecret } from "./content-peer-secret.js";
import {
  contentReaderOrgId,
  signContentPlaybackGrant,
  withContentPlaybackGrant,
} from "./content-playback-grant.js";
import { contextClipIdForFootage } from "./context-footage.js";
import {
  isHeldForRedaction,
  REDACTION_HOLD_MESSAGE,
} from "./pending-redactions.js";
import { resolvePlayerThumbnailUrl } from "./player-thumbnail-url.js";
import { resolvePlayerVideoUrl } from "./player-video-url.js";
import {
  isRecordingExpiredForViewer,
  isRecordingTrashedForViewer,
} from "./recording-page-access.js";
import { hydrateCommentAuthorNames } from "./user-identities.js";

type Recording = typeof schema.recordings.$inferSelect;

interface ContentClipPeer {
  /** The Content app's URL, from the token's issuer. */
  contentApp: string;
  documentId: string;
  recordingId: string;
  /** Null for a signed-out reader of a public document. */
  viewerEmail: string | null;
  viewerName: string | null;
}

interface OpenedClip {
  recording: Recording;
  role: string;
  binding: ContentClipBinding | null;
}

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const BEARER = /^Bearer ([^\s]+)$/;
const MAX_DOCUMENT_ID_CHARS = 256;
const MAX_ISSUER_CHARS = 2048;
const MAX_VIEWER_NAME_CHARS = 200;
const ISSUED_AT_SKEW_SECONDS = 60;
const MAX_COMMENT_CHARS = 10_000;
const MAX_COMMENT_ID_CHARS = 128;
const MAX_EMOJI_CHARS = 32;
const MAX_VIDEO_TIMESTAMP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const viewerEmailSchema = z.string().email().max(320);

const RATE_LIMIT_WINDOW_MS = 60_000;
// Also how often a reader may name, on one page, a Clip that doesn't open for
// them there. Each Clip keeps its own count, so made-up ids can't spend a real
// Clip's, and a Clip that opened once and then went away stays bounded.
const RATE_LIMITS = { read: 600, write: 30 } as const;
const RATE_LIMIT_MAX_BUCKETS = 5000;
let rateBucketLimit = RATE_LIMIT_MAX_BUCKETS;
let missLimitForTests: number | null = null;
type RateBucket = { count: number; reset: number };
/** One per reader, page and Clip that opened. */
const rateBuckets = new Map<string, RateBucket>();
/** One per reader, page and Clip that didn't open. */
const missBuckets = new Map<string, RateBucket>();

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

function errorResponse(status: number, error: string, code?: string) {
  return json({ error, ...(code ? { code } : {}) }, status);
}

const unauthorized = () => errorResponse(401, "Unauthorized");
const notFound = () => errorResponse(404, "Not found");

function contentAppFromIssuer(issuer: unknown): string | null {
  if (
    typeof issuer !== "string" ||
    issuer.length > MAX_ISSUER_CHARS ||
    !URL.canParse(issuer)
  ) {
    return null;
  }
  const url = new URL(issuer);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function isDocumentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DOCUMENT_ID_CHARS &&
    value.trim() === value &&
    !/[\s\p{Cc}]/u.test(value)
  );
}

/**
 * The reader Content vouched for, or the response refusing the request. Every
 * refusal is the same bare 401, so a caller learns nothing about the Clip.
 */
async function verifyPeer(
  event: H3Event,
  recordingId: string,
  scopes: readonly ContentClipScope[],
): Promise<ContentClipPeer | Response> {
  const peerSecret = readContentPeerSecret();
  if (peerSecret.refused) {
    return json(peerSecret.refused.body, peerSecret.refused.status);
  }
  const token = BEARER.exec(
    getRequestHeader(event, "authorization") ?? "",
  )?.[1];
  if (!token) return unauthorized();

  let verified: Awaited<ReturnType<typeof verifyA2AToken>>;
  try {
    verified = await verifyA2AToken(token, event, {
      routePrefix: CONTENT_CLIP_AUDIENCE_PATH,
      verificationSecret: peerSecret.secret,
      includeClaims: true,
      requireAudience: true,
    });
  } catch (error) {
    // Thrown only when a credential could not be read, which is not a refusal.
    if (
      error instanceof Error &&
      error.name === "A2AIdentityVerificationUnavailableError"
    ) {
      return errorResponse(503, "Identity verification is unavailable");
    }
    throw error;
  }

  const claims = verified.claims;
  const subject = verified.email;
  if (!claims || !subject) return unauthorized();
  if (!scopes.includes(claims.scope as ContentClipScope)) return unauthorized();

  const contentApp = contentAppFromIssuer(claims.iss);
  const documentId = claims[CONTENT_CLIP_CLAIMS.documentId];
  if (!contentApp || !isDocumentId(documentId)) return unauthorized();
  if (claims[CONTENT_CLIP_CLAIMS.recordingId] !== recordingId) {
    return unauthorized();
  }

  // Content mints a token per call; a long-lived one would outlast the
  // document access Content checked when it signed it.
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number" ||
    claims.iat > now + ISSUED_AT_SKEW_SECONDS ||
    claims.exp - claims.iat > CONTENT_CLIP_MAX_TOKEN_SECONDS
  ) {
    return unauthorized();
  }

  const isPublicReader = claims.scope === CONTENT_CLIP_SCOPES.publicRead;
  if (isPublicReader !== (subject === CONTENT_CLIP_PUBLIC_READER)) {
    return unauthorized();
  }
  let viewerEmail: string | null = null;
  if (!isPublicReader) {
    viewerEmail = subject.toLowerCase();
    if (!viewerEmailSchema.safeParse(viewerEmail).success) {
      return unauthorized();
    }
  }
  const name = claims[CONTENT_CLIP_CLAIMS.viewerName];
  const viewerName =
    viewerEmail && typeof name === "string"
      ? name.trim().slice(0, MAX_VIEWER_NAME_CHARS) || null
      : null;

  return { contentApp, documentId, recordingId, viewerEmail, viewerName };
}

function pruneExpired(buckets: Map<string, RateBucket>, now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.reset < now) buckets.delete(key);
  }
}

type RateKind = keyof typeof RATE_LIMITS;

function clipKey(peer: ContentClipPeer, kind: RateKind): string {
  return [
    kind,
    peer.contentApp,
    peer.documentId,
    peer.viewerEmail ?? CONTENT_CLIP_PUBLIC_READER,
    peer.recordingId,
  ].join("\n");
}

function isFull(bucket: RateBucket | undefined, limit: number, now: number) {
  return Boolean(bucket && bucket.reset >= now && bucket.count >= limit);
}

function missLimit(kind: RateKind): number {
  return missLimitForTests ?? RATE_LIMITS[kind];
}

function tooManyRequests(): Response {
  return errorResponse(429, "Too many requests");
}

/**
 * Refuses before Clips reads anything: a reader who has used up this Clip's
 * requests on this page, either those that opened it or those that didn't.
 */
function overRateLimit(peer: ContentClipPeer, kind: RateKind) {
  const key = clipKey(peer, kind);
  const now = Date.now();
  return isFull(rateBuckets.get(key), RATE_LIMITS[kind], now) ||
    isFull(missBuckets.get(key), missLimit(kind), now)
    ? tooManyRequests()
    : null;
}

/**
 * Starts a new window for `key`. A full map drops its oldest bucket rather
 * than refuse anyone: refusing would turn away every new reader on every page
 * in this process, while dropping only gives one reader, page and Clip a fresh
 * window.
 */
function startWindow(
  buckets: Map<string, RateBucket>,
  key: string,
  now: number,
): void {
  buckets.delete(key);
  if (buckets.size >= rateBucketLimit) pruneExpired(buckets, now);
  const oldest = buckets.keys().next();
  if (buckets.size >= rateBucketLimit && !oldest.done) {
    buckets.delete(oldest.value);
  }
  buckets.set(key, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
}

/**
 * Counts a request against a Clip it opened. Content mints a token for any
 * recording id a page reader names, so a bucket made before the Clip opened
 * would let a reader name made-up ids until their own spent bucket dropped
 * out of the map.
 */
function rateLimited(peer: ContentClipPeer, kind: RateKind) {
  const key = clipKey(peer, kind);
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || existing.reset < now) {
    startWindow(rateBuckets, key, now);
    return null;
  }
  if (existing.count >= RATE_LIMITS[kind]) {
    return tooManyRequests();
  }
  existing.count += 1;
  return null;
}

/** Counts a request whose Clip didn't open against that Clip's misses. */
function countMiss(peer: ContentClipPeer, kind: RateKind): void {
  const key = clipKey(peer, kind);
  const now = Date.now();
  const existing = missBuckets.get(key);
  if (existing && existing.reset >= now) {
    existing.count += 1;
    return;
  }
  startWindow(missBuckets, key, now);
}

export function __resetContentClipRateLimitsForTests(
  limits: { buckets?: number; misses?: number } = {},
): void {
  rateBuckets.clear();
  missBuckets.clear();
  rateBucketLimit = limits.buckets ?? RATE_LIMIT_MAX_BUCKETS;
  missLimitForTests = limits.misses ?? null;
}

async function authorize(
  event: H3Event,
  scopes: readonly ContentClipScope[],
  kind: RateKind,
): Promise<ContentClipPeer | Response> {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) return notFound();
  const peer = await verifyPeer(event, recordingId, scopes);
  if (peer instanceof Response) return peer;
  return overRateLimit(peer, kind) ?? peer;
}

/**
 * Runs `fn` on the Clip if it opens for the reader, counted against that
 * Clip's bucket; a request whose Clip doesn't open counts as a miss.
 */
async function withOpenedClip(
  peer: ContentClipPeer,
  kind: RateKind,
  fn: (opened: OpenedClip) => Promise<Response>,
): Promise<Response> {
  const outcome = { opened: false };
  const response = await openClip(peer, async (clip) => {
    outcome.opened = true;
    return rateLimited(peer, kind) ?? fn(clip);
  });
  if (!outcome.opened) countMiss(peer, kind);
  return response;
}

/**
 * Opens the Clip as the vouched reader, with the document's binding in scope
 * so an active upload binding counts as a share. The Clip's own Trash,
 * takedown, expiry and password rules then apply exactly as they do on a
 * share link, with the owner's exceptions.
 */
async function openClip(
  peer: ContentClipPeer,
  fn: (opened: OpenedClip) => Promise<Response>,
): Promise<Response> {
  // Earlier-screen-time footage plays only through the Clip it is attached
  // to, under that Clip's rules; a document never holds it on its own.
  if (await contextClipIdForFootage(peer.recordingId)) return notFound();
  const binding = await findContentBinding(peer);
  const orgId = await contentReaderOrgId(peer.viewerEmail);
  const open = () =>
    runWithRequestContext(
      {
        ...(peer.viewerEmail !== null ? { userEmail: peer.viewerEmail } : {}),
        ...(peer.viewerName !== null ? { userName: peer.viewerName } : {}),
        ...(orgId !== undefined ? { orgId } : {}),
      },
      async () => {
        const access = await resolveAccess("recording", peer.recordingId);
        if (!access) return notFound();
        const recording = access.resource as Recording;
        const viewerIsOwner = access.role === "owner";
        if (
          isRecordingTrashedForViewer({
            trashedAt: recording.trashedAt,
            viewerIsOwner,
          }) ||
          recording.failureCode === "taken_down"
        ) {
          return notFound();
        }
        if (
          isRecordingExpiredForViewer({
            expiresAt: recording.expiresAt,
            viewerIsOwner,
          })
        ) {
          return errorResponse(410, "Recording has expired", "expired");
        }
        // A password only tightens access, and a document cannot supply one.
        if (recording.password && !viewerIsOwner) {
          return errorResponse(
            403,
            "This Clip is password protected",
            "password_required",
          );
        }
        return fn({ recording, role: access.role, binding });
      },
    );
  return binding
    ? runWithContentDocGrant(
        contentDocGrantFor(binding, peer.viewerEmail),
        open,
      )
    : open();
}

function forbiddenResponse(error: unknown): Response {
  if (error instanceof ForbiddenError) {
    return errorResponse(403, error.message || "Forbidden", "forbidden");
  }
  throw error;
}

export async function handleContentClipPlayback(
  event: H3Event,
): Promise<Response> {
  const peer = await authorize(
    event,
    [CONTENT_CLIP_SCOPES.read, CONTENT_CLIP_SCOPES.publicRead],
    "read",
  );
  if (peer instanceof Response) return peer;

  return withOpenedClip(peer, "read", async ({ recording, role, binding }) => {
    if (isHeldForRedaction(recording.editsJson, role)) {
      return errorResponse(409, REDACTION_HOLD_MESSAGE, "redaction_pending");
    }
    const grant = signContentPlaybackGrant({
      recordingId: recording.id,
      bindingId: binding?.id ?? null,
      viewerEmail: peer.viewerEmail,
    });
    const base = withConfiguredAppBasePath(getAppProductionUrl());
    // Clips' own media routes come back as paths and carry the grant; an
    // embedded provider's player URL goes out as it is.
    const playable = (url: string | null) =>
      url?.startsWith("/")
        ? withContentPlaybackGrant(`${base}${url}`, grant.params)
        : url;

    return json({
      recording: {
        id: recording.id,
        title: recording.title.slice(0, CONTENT_CLIP_RECORDING_TITLE_CHARS),
        kind: recording.kind,
        status: recording.status,
        durationMs: recording.durationMs,
        width: recording.width,
        height: recording.height,
        enableComments: Boolean(recording.enableComments),
        embedProvider: recordingEmbedProvider(recording),
      },
      playback: {
        videoUrl: playable(
          resolvePlayerVideoUrl(recording, { proxyRemoteMedia: true }),
        ),
        posterUrl: playable(resolvePlayerThumbnailUrl(recording)),
        expiresAt: grant.expiresAt,
      },
      viewer: {
        isOwner: role === "owner",
        canComment:
          peer.viewerEmail !== null && Boolean(recording.enableComments),
      },
    });
  });
}

const commentListQuerySchema = z.object({
  // A Content from before the bound sends none; it gets the most there is.
  limit: z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(CONTENT_CLIP_MAX_COMMENT_THREADS))
    .default(CONTENT_CLIP_MAX_COMMENT_THREADS),
});

/**
 * The first `limit` thread starts by video time, as `list-comments` orders
 * them, reading one more to tell a full page from the whole list. Text and
 * names are cut to the contract's lengths.
 */
async function listCommentThreads(recordingId: string, limit: number) {
  await assertCommentAccess(recordingId, "read");
  const comments = schema.recordingComments;
  const rows = await getDb()
    .select({
      id: comments.id,
      authorEmail: comments.authorEmail,
      authorName: comments.authorName,
      content: sql<string>`left(${comments.content}, ${CONTENT_CLIP_COMMENT_PREVIEW_CHARS})`,
      videoTimestampMs: comments.videoTimestampMs,
    })
    .from(comments)
    .where(
      and(eq(comments.recordingId, recordingId), isNull(comments.parentId)),
    )
    .orderBy(asc(comments.videoTimestampMs), asc(comments.createdAt))
    .limit(limit + 1);
  const threads = await hydrateCommentAuthorNames(rows.slice(0, limit));
  return {
    comments: threads.map((thread) => ({
      ...thread,
      authorEmail: thread.authorEmail.slice(
        0,
        CONTENT_CLIP_COMMENT_AUTHOR_CHARS,
      ),
      authorName:
        thread.authorName?.slice(0, CONTENT_CLIP_COMMENT_AUTHOR_CHARS) ?? null,
    })),
    truncated: rows.length > limit,
  };
}

export async function handleContentClipComments(
  event: H3Event,
): Promise<Response> {
  const peer = await authorize(
    event,
    [CONTENT_CLIP_SCOPES.read, CONTENT_CLIP_SCOPES.publicRead],
    "read",
  );
  if (peer instanceof Response) return peer;
  const query = commentListQuerySchema.safeParse(getQuery(event));
  if (!query.success) return errorResponse(400, "Invalid comment request");

  return withOpenedClip(peer, "read", async ({ recording, role }) => {
    if (
      !canReadRecordingComments({
        enableComments: Boolean(recording.enableComments),
        viewerIsOwner: role === "owner",
      })
    ) {
      return errorResponse(
        403,
        "Comments are turned off for this Clip",
        "comments_disabled",
      );
    }
    try {
      return json(await listCommentThreads(peer.recordingId, query.data.limit));
    } catch (error) {
      return forbiddenResponse(error);
    }
  });
}

const commentText = z.string().trim().min(1).max(MAX_COMMENT_CHARS);
const commentId = z.string().trim().min(1).max(MAX_COMMENT_ID_CHARS);
const commentWriteSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("add"),
      content: commentText,
      videoTimestampMs: z.number().int().min(0).max(MAX_VIDEO_TIMESTAMP_MS),
    })
    .strict(),
  z
    .object({
      operation: z.literal("reply"),
      commentId,
      content: commentText,
    })
    .strict(),
  z
    .object({ operation: z.literal("edit"), commentId, content: commentText })
    .strict(),
  z.object({ operation: z.literal("delete"), commentId }).strict(),
  z
    .object({
      operation: z.literal("resolve"),
      commentId,
      resolved: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("react"),
      commentId,
      emoji: z.string().trim().min(1).max(MAX_EMOJI_CHARS),
    })
    .strict(),
]);
type CommentWrite = z.infer<typeof commentWriteSchema>;

async function isCommentOnRecording(
  id: string,
  recordingId: string,
): Promise<boolean> {
  const [comment] = await getDb()
    .select({ id: schema.recordingComments.id })
    .from(schema.recordingComments)
    .where(
      and(
        eq(schema.recordingComments.id, id),
        eq(schema.recordingComments.recordingId, recordingId),
      ),
    )
    .limit(1);
  return Boolean(comment);
}

async function writeComment(write: CommentWrite, recordingId: string) {
  switch (write.operation) {
    case "add": {
      const { id, threadId } = await addComment.run({
        recordingId,
        content: write.content,
        videoTimestampMs: write.videoTimestampMs,
      });
      return { id, threadId };
    }
    case "reply": {
      const { id, threadId, parentId } = await replyToComment.run({
        commentId: write.commentId,
        content: write.content,
      });
      return { id, threadId, parentId };
    }
    case "edit": {
      const { id, content, updatedAt } = await updateComment.run({
        id: write.commentId,
        content: write.content,
      });
      return { id, content, updatedAt };
    }
    case "delete":
      return deleteComment.run({ id: write.commentId });
    case "resolve":
      return resolveComment.run({
        id: write.commentId,
        resolved: write.resolved,
      });
    case "react": {
      const { id, emoji, reacted, reactions } = await reactToComment.run({
        commentId: write.commentId,
        emoji: write.emoji,
      });
      return { id, emoji, reacted, reactions };
    }
  }
}

export async function handleContentClipCommentWrite(
  event: H3Event,
): Promise<Response> {
  const peer = await authorize(event, [CONTENT_CLIP_SCOPES.comment], "write");
  if (peer instanceof Response) return peer;

  let body: unknown;
  try {
    body = await readBodyWithSizeLimit(event, MAX_BODY_BYTES);
  } catch (error) {
    const tooLarge =
      (error as { statusCode?: number } | null)?.statusCode === 413;
    return errorResponse(
      tooLarge ? 413 : 400,
      tooLarge ? "Request body too large" : "Invalid request body",
    );
  }
  const parsed = commentWriteSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Invalid comment request");
  const write = parsed.data;

  return withOpenedClip(peer, "write", async ({ recording }) => {
    // Stricter than Clips' own `delete-comment`, which lets an author delete
    // with comments off: through a document, comments off means no writes.
    if (!recording.enableComments) {
      return errorResponse(
        403,
        "Comments are turned off for this Clip",
        "comments_disabled",
      );
    }
    if (
      write.operation !== "add" &&
      !(await isCommentOnRecording(write.commentId, peer.recordingId))
    ) {
      return notFound();
    }
    try {
      return json(await writeComment(write, peer.recordingId));
    } catch (error) {
      return forbiddenResponse(error);
    }
  });
}
