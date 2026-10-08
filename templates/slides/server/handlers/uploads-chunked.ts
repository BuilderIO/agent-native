import {
  ATTACHMENT_ERROR_CODES,
  attachmentFailureDetails,
  deletePrivateBlob,
  describeAttachmentFailure,
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
  type StorageUnavailable,
} from "@agent-native/core/private-blob";
import {
  defineEventHandler,
  getHeader,
  getQuery,
  getRouterParam,
  readBody,
  readRawBody,
  setResponseStatus,
} from "h3";
import { nanoid } from "nanoid";

import {
  compareAndSetChunkedUploadSession,
  createChunkedUploadSession,
  deleteOrphanedChunkCleanup,
  deleteChunkedUploadSession,
  getChunkedUploadSession,
  listOrphanedChunkCleanups,
  listChunkedUploadSessions,
  recordOrphanedChunkCleanup,
  type ChunkedUploadSession,
} from "../lib/chunked-upload-session.js";
import { isHostedSlidesRuntime } from "../lib/tenant-files.js";
import {
  findUploadedVideoAssetForSession,
  MAX_VIDEO_ASSET_FILE_SIZE,
  uploadVideoAsset,
} from "./assets.js";
import {
  resolveSlidesRequestAuth,
  withSlidesRequestContext,
} from "./request-auth-context.js";
import { maxReferenceFileBytes, saveUploadedReferenceFile } from "./uploads.js";

const STORAGE_NOT_CONNECTED: StorageUnavailable = {
  status: "storageUnavailable",
  reason: "not_configured",
  whoCanFix: "workspace_admin",
};

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 128;
const SESSION_TTL_MS = 60 * 60 * 1000;
const FINALIZATION_LEASE_MS = 60 * 60 * 1000;
const FINALIZATION_HEARTBEAT_MS = 60 * 1000;

class UploadSessionFinalizingError extends Error {}

interface StartBody {
  filename?: unknown;
  mimetype?: unknown;
  declaredSize?: unknown;
  uploadType?: unknown;
}

async function deleteChunk(handle: ChunkedUploadSession["chunks"][string]) {
  return (await deletePrivateBlob(handle)).deleted;
}

async function cleanupConflictedChunk(args: {
  sessionId: string;
  chunkIndex: number;
  ownerEmail: string;
  orgId: string | undefined;
  handle: PrivateBlobHandle;
}): Promise<boolean> {
  let cleanupKey: string | undefined;
  try {
    cleanupKey = await recordOrphanedChunkCleanup({
      version: 1,
      ownerEmail: args.ownerEmail,
      orgId: args.orgId ?? null,
      uploadSessionId: args.sessionId,
      chunkIndex: args.chunkIndex,
      handle: args.handle,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[slides-upload] could not record orphaned chunk", {
      sessionId: args.sessionId,
      chunkIndex: args.chunkIndex,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (await deleteChunk(args.handle)) {
      if (cleanupKey) {
        try {
          await deleteOrphanedChunkCleanup(cleanupKey);
        } catch (error) {
          console.warn("[slides-upload] orphaned chunk record cleanup failed", {
            sessionId: args.sessionId,
            chunkIndex: args.chunkIndex,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return true;
    }
  } catch (error) {
    console.warn("[slides-upload] chunk cleanup after conflict failed", {
      sessionId: args.sessionId,
      chunkIndex: args.chunkIndex,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return cleanupKey !== undefined;
}

async function reapOrphanedChunkBlobs(
  ownerEmail: string,
  orgId: string | undefined,
): Promise<void> {
  const cleanups = await listOrphanedChunkCleanups();
  await Promise.all(
    cleanups.map(async ({ key, cleanup }) => {
      if (
        cleanup.version !== 1 ||
        cleanup.ownerEmail !== ownerEmail ||
        (cleanup.orgId ?? null) !== (orgId ?? null) ||
        !cleanup.handle ||
        typeof cleanup.handle.id !== "string" ||
        typeof cleanup.handle.provider !== "string" ||
        cleanup.handle.opaque !== true
      ) {
        return;
      }
      try {
        if (await deleteChunk(cleanup.handle)) {
          await deleteOrphanedChunkCleanup(key);
        }
      } catch (error) {
        console.warn("[slides-upload] orphaned chunk retry failed", {
          sessionId: cleanup.uploadSessionId,
          chunkIndex: cleanup.chunkIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

async function cleanupChunks(session: ChunkedUploadSession): Promise<boolean> {
  const results = await Promise.all(
    Object.values(session.chunks).map(deleteChunk),
  );
  return results.every(Boolean);
}

function sessionBelongsToRequest(
  session: ChunkedUploadSession,
  email: string,
  orgId: string | undefined,
): boolean {
  return (
    (!session.ownerEmail ||
      (session.ownerEmail === email &&
        (session.orgId ?? null) === (orgId ?? null))) &&
    (session.uploadType !== "video" || Boolean(session.ownerEmail))
  );
}

async function markSessionForCleanup(
  sessionId: string,
  initialSession: ChunkedUploadSession,
  allowFinalizing = false,
): Promise<ChunkedUploadSession | null> {
  let session = initialSession;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (session.cleanupState === "aborting") return session;
    if (session.finalizingAt && !allowFinalizing) {
      throw new UploadSessionFinalizingError();
    }
    const cleanupSession = { ...session, cleanupState: "aborting" as const };
    if (
      await compareAndSetChunkedUploadSession(
        sessionId,
        session,
        cleanupSession,
      )
    ) {
      return cleanupSession;
    }
    const latest = await getChunkedUploadSession(sessionId);
    if (!latest) return null;
    session = latest;
  }
  throw new Error("Could not claim the upload session for cleanup");
}

async function discardSession(
  sessionId: string,
  session: ChunkedUploadSession,
  { allowFinalizing = false }: { allowFinalizing?: boolean } = {},
): Promise<boolean> {
  const cleanupSession = await markSessionForCleanup(
    sessionId,
    session,
    allowFinalizing,
  );
  if (!cleanupSession) return true;
  const cleaned = await cleanupChunks(cleanupSession);
  if (cleaned) await deleteChunkedUploadSession(sessionId);
  return cleaned;
}

async function reapExpiredChunkedUploads(
  ownerEmail: string,
  orgId: string | undefined,
): Promise<void> {
  await reapOrphanedChunkBlobs(ownerEmail, orgId);
  const now = Date.now();
  const sessions = await listChunkedUploadSessions();
  await Promise.all(
    sessions.map(async ({ sessionId, session }) => {
      const expiresAt = Date.parse(session.expiresAt);
      const finalizationExpiresAt = session.finalizingAt
        ? Date.parse(session.finalizationLeaseExpiresAt ?? "")
        : Number.NaN;
      const finalizationExpired =
        session.finalizingAt !== undefined &&
        (!Number.isFinite(finalizationExpiresAt) ||
          finalizationExpiresAt <= now);
      if (session.finalizingAt && session.cleanupState !== "aborting") {
        if (!finalizationExpired) return;
        try {
          await discardExpiredFinalization(sessionId, session);
        } catch (error) {
          console.warn("[slides-upload] expired finalization cleanup failed", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (
        session.cleanupState !== "aborting" &&
        Number.isFinite(expiresAt) &&
        expiresAt > now
      ) {
        return;
      }
      try {
        const cleaned = await discardSession(sessionId, session);
        if (!cleaned) {
          console.warn("[slides-upload] expired session cleanup incomplete", {
            sessionId,
          });
        }
      } catch (error) {
        console.warn("[slides-upload] expired session cleanup failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

async function cleanupCommittedSession(
  sessionId: string,
  session: ChunkedUploadSession,
): Promise<void> {
  try {
    const cleaned = await discardSession(sessionId, session, {
      allowFinalizing: true,
    });
    if (!cleaned) {
      console.warn("[slides-upload] committed session cleanup incomplete", {
        sessionId,
      });
    }
  } catch (error) {
    console.warn("[slides-upload] committed session cleanup failed", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function startFinalizationLease(
  sessionId: string,
  initialSession: ChunkedUploadSession,
) {
  let session = initialSession;
  let failure: Error | undefined;
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    renewal = renewal
      .then(async () => {
        if (failure) return;
        const nextSession = {
          ...session,
          finalizationLeaseExpiresAt: new Date(
            Date.now() + FINALIZATION_LEASE_MS,
          ).toISOString(),
        };
        if (
          !(await compareAndSetChunkedUploadSession(
            sessionId,
            session,
            nextSession,
          ))
        ) {
          throw new Error("Upload session finalization lease was lost");
        }
        session = nextSession;
      })
      .catch((error) => {
        failure = error instanceof Error ? error : new Error(String(error));
      });
  }, FINALIZATION_HEARTBEAT_MS);
  timer.unref?.();

  return {
    async assertActive() {
      await renewal;
      if (failure) throw failure;
    },
    async stop() {
      clearInterval(timer);
      await renewal;
      return failure;
    },
  };
}

async function discardExpiredFinalization(
  sessionId: string,
  session: ChunkedUploadSession,
): Promise<boolean> {
  const cleanupSession = { ...session, cleanupState: "aborting" as const };
  if (
    !(await compareAndSetChunkedUploadSession(
      sessionId,
      session,
      cleanupSession,
    ))
  ) {
    return true;
  }
  const cleaned = await cleanupChunks(cleanupSession);
  if (cleaned) await deleteChunkedUploadSession(sessionId);
  return cleaned;
}

export const startChunkedUpload = defineEventHandler(async (event) => {
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { error: auth.error };
  }
  const authContext = auth.context;
  if (!authContext.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return withSlidesRequestContext(
    event,
    async ({ orgId }) => {
      if (!isHostedSlidesRuntime()) {
        return { uploadMode: "multipart" as const };
      }
      await reapExpiredChunkedUploads(authContext.email!, orgId);
      const body = (await readBody(event).catch(
        () => null,
      )) as StartBody | null;
      const filename =
        typeof body?.filename === "string" ? body.filename.trim() : "";
      const mimetype =
        typeof body?.mimetype === "string" && body.mimetype.trim()
          ? body.mimetype.trim()
          : "application/octet-stream";
      const declaredSize = Number(body?.declaredSize);
      const uploadType = body?.uploadType ?? "reference";
      if (!filename) {
        setResponseStatus(event, 400);
        return { error: "filename is required" };
      }
      if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
        setResponseStatus(event, 400);
        return { error: "declaredSize must be a positive integer" };
      }
      if (uploadType !== "reference" && uploadType !== "video") {
        setResponseStatus(event, 400);
        return { error: "Unsupported upload type" };
      }
      if (uploadType === "video" && !/\.(mp4|webm)$/i.test(filename)) {
        setResponseStatus(event, 400);
        return { error: "Only MP4 and WebM videos are allowed" };
      }
      const limit =
        uploadType === "video"
          ? MAX_VIDEO_ASSET_FILE_SIZE
          : maxReferenceFileBytes(filename);
      if (declaredSize > limit) {
        setResponseStatus(event, 413);
        return {
          error:
            uploadType === "video"
              ? "Video too large (max 50 MB)"
              : `File too large (max ${Math.round(limit / 1024 / 1024)} MB)`,
        };
      }

      const sessionId = nanoid();
      const now = Date.now();
      await createChunkedUploadSession(sessionId, {
        uploadType,
        ownerEmail: authContext.email,
        orgId: orgId ?? null,
        filename,
        mimeType: mimetype,
        declaredSize,
        chunks: {},
        chunkSizes: {},
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      });
      return { sessionId, maxChunkBytes: MAX_CHUNK_BYTES };
    },
    authContext,
  );
});

export const uploadChunkedChunk = defineEventHandler(async (event) => {
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { error: auth.error };
  }
  const authContext = auth.context;
  const email = authContext.email;
  if (!email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return withSlidesRequestContext(
    event,
    async ({ orgId }) => {
      const sessionId = getRouterParam(event, "sessionId");
      if (!sessionId) {
        setResponseStatus(event, 400);
        return { error: "Missing sessionId" };
      }
      let session = await getChunkedUploadSession(sessionId);
      if (session && !sessionBelongsToRequest(session, email, orgId)) {
        setResponseStatus(event, 403);
        return { error: "Upload session belongs to another user" };
      }
      if (
        !session ||
        session.cleanupState === "aborting" ||
        session.finalizingAt
      ) {
        const completedVideo = await findUploadedVideoAssetForSession(
          email,
          sessionId,
        );
        if (completedVideo) return completedVideo;
      }
      if (!session) {
        setResponseStatus(event, 404);
        return { error: "Upload session not found or expired" };
      }
      if (session.cleanupState === "aborting") {
        setResponseStatus(event, 410);
        return { error: "Upload session was cancelled" };
      }
      if (session.finalizingAt) {
        setResponseStatus(event, 409);
        return { error: "Upload session is already finalizing" };
      }
      if (Date.parse(session.expiresAt) <= Date.now()) {
        try {
          await discardSession(sessionId, session);
        } catch (error) {
          if (error instanceof UploadSessionFinalizingError) {
            setResponseStatus(event, 409);
            return { error: "Upload session is already finalizing" };
          }
          throw error;
        }
        setResponseStatus(event, 410);
        return { error: "Upload session expired" };
      }

      const query = getQuery(event);
      const index = Number(query.index ?? 0);
      const isFinal = query.isFinal === "1" || query.isFinal === "true";
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
        setResponseStatus(event, 400);
        return { error: "Invalid chunk index" };
      }

      const contentLengthHeader = getHeader(event, "content-length");
      if (!contentLengthHeader || !/^\d+$/.test(contentLengthHeader)) {
        setResponseStatus(event, 411);
        return { error: "Valid Content-Length header required" };
      }
      const contentLength = Number(contentLengthHeader);
      if (contentLength <= 0) {
        setResponseStatus(event, 400);
        return { error: "Empty chunk body" };
      }
      if (contentLength > MAX_CHUNK_BYTES) {
        setResponseStatus(event, 413);
        return { error: "Chunk too large" };
      }

      const chunkKey = String(index);
      const previousSize = session.chunkSizes[chunkKey] ?? 0;
      const receivedBefore = Object.values(session.chunkSizes).reduce(
        (total, size) => total + size,
        0,
      );
      const nextSize = receivedBefore - previousSize + contentLength;
      const fileLimit =
        session.uploadType === "video"
          ? MAX_VIDEO_ASSET_FILE_SIZE
          : maxReferenceFileBytes(session.filename);
      if (nextSize > session.declaredSize || nextSize > fileLimit) {
        try {
          await discardSession(sessionId, session);
        } catch (error) {
          if (error instanceof UploadSessionFinalizingError) {
            setResponseStatus(event, 409);
            return { error: "Upload session is already finalizing" };
          }
          throw error;
        }
        setResponseStatus(event, 413);
        return { error: "Uploaded bytes exceed the declared file size" };
      }

      const raw = await readRawBody(event, false);
      const bytes = raw ?? new Uint8Array(0);
      if (bytes.byteLength !== contentLength) {
        setResponseStatus(event, 400);
        return { error: "Chunk size does not match Content-Length" };
      }

      const previousHandle = session.chunks[chunkKey];
      const handle = await putPrivateBlob({
        data: bytes,
        filename: `${sessionId}-${index}`,
        mimeType: "application/octet-stream",
        ownerEmail: email,
      });
      if (!handle) {
        setResponseStatus(event, 503);
        return {
          error: describeAttachmentFailure(STORAGE_NOT_CONNECTED, "save")
            .message,
          errorCode: ATTACHMENT_ERROR_CODES.storageUnavailable,
          details: attachmentFailureDetails(STORAGE_NOT_CONNECTED),
        };
      }
      const nextSession = {
        ...session,
        chunks: { ...session.chunks, [chunkKey]: handle },
        chunkSizes: { ...session.chunkSizes, [chunkKey]: bytes.byteLength },
        ...(isFinal
          ? {
              finalizingAt: new Date().toISOString(),
              finalizationLeaseExpiresAt: new Date(
                Date.now() + FINALIZATION_LEASE_MS,
              ).toISOString(),
            }
          : {}),
      };
      if (
        !(await compareAndSetChunkedUploadSession(
          sessionId,
          session,
          nextSession,
        ))
      ) {
        const cleanupTracked = await cleanupConflictedChunk({
          sessionId,
          chunkIndex: index,
          ownerEmail: email,
          orgId,
          handle,
        });
        if (!cleanupTracked) {
          setResponseStatus(event, 503);
          return {
            error: "Conflicted upload chunk cleanup could not be recorded",
          };
        }
        setResponseStatus(event, 409);
        return { error: "Upload session changed while saving the chunk" };
      }
      session = nextSession;

      if (previousHandle) {
        try {
          if (!(await deleteChunk(previousHandle))) {
            console.warn("[slides-upload] replaced chunk cleanup incomplete", {
              sessionId,
            });
          }
        } catch (error) {
          console.warn("[slides-upload] replaced chunk cleanup failed", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!isFinal) return { ok: true };

      const orderedIndices = Object.keys(session.chunks)
        .map(Number)
        .sort((a, b) => a - b);
      const missing = orderedIndices.some((value, i) => value !== i);
      const receivedSize = Object.values(session.chunkSizes).reduce(
        (total, size) => total + size,
        0,
      );
      if (
        missing ||
        orderedIndices.length === 0 ||
        receivedSize !== session.declaredSize
      ) {
        await discardSession(sessionId, session, { allowFinalizing: true });
        setResponseStatus(event, 400);
        return { error: "Upload is incomplete or has an invalid size" };
      }

      const finalizationLease = startFinalizationLease(sessionId, session);
      let result;
      try {
        const parts = await Promise.all(
          orderedIndices.map(async (chunkIndex) => {
            const chunkHandle = session.chunks[String(chunkIndex)];
            const read = await readPrivateBlob(chunkHandle);
            return Buffer.from(read.data);
          }),
        );
        const combined = Buffer.concat(parts);
        if (combined.byteLength !== session.declaredSize) {
          throw new Error("Assembled upload size does not match declaredSize");
        }
        await finalizationLease.assertActive();
        result =
          session.uploadType === "video"
            ? await uploadVideoAsset({
                email,
                orgId,
                originalName: session.filename,
                data: combined,
                uploadSessionId: sessionId,
              })
            : await saveUploadedReferenceFile({
                email,
                orgId,
                originalName: session.filename,
                data: combined,
                type: session.mimeType,
              });
      } catch (err) {
        await finalizationLease.stop();
        try {
          const cleaned = await discardSession(sessionId, session, {
            allowFinalizing: true,
          });
          if (!cleaned) {
            console.warn(
              "[slides-upload] failed finalization cleanup incomplete",
              {
                sessionId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        } catch (cleanupError) {
          console.error("[slides-upload] failed finalization cleanup failed", {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
            cleanupError:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          });
        }
        const statusCode =
          typeof (err as { statusCode?: unknown })?.statusCode === "number"
            ? (err as { statusCode: number }).statusCode
            : 500;
        setResponseStatus(event, statusCode);
        return { error: err instanceof Error ? err.message : "Invalid upload" };
      }

      const leaseFailure = await finalizationLease.stop();
      if (leaseFailure) {
        console.warn("[slides-upload] finalization lease ended during commit", {
          sessionId,
          error: leaseFailure.message,
        });
      }
      await cleanupCommittedSession(sessionId, session);
      return session.uploadType === "video" ? result : [result];
    },
    authContext,
  );
});

export const abortChunkedUpload = defineEventHandler(async (event) => {
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { error: auth.error };
  }
  const authContext = auth.context;
  const email = authContext.email;
  if (!email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return withSlidesRequestContext(
    event,
    async ({ orgId }) => {
      const sessionId = getRouterParam(event, "sessionId");
      if (!sessionId) {
        setResponseStatus(event, 400);
        return { error: "Missing sessionId" };
      }
      const session = await getChunkedUploadSession(sessionId);
      if (!session) return { ok: true };
      if (!sessionBelongsToRequest(session, email, orgId)) {
        setResponseStatus(event, 403);
        return { error: "Upload session belongs to another user" };
      }

      try {
        const cleaned = await discardSession(sessionId, session);
        if (cleaned) return { ok: true };
      } catch (error) {
        if (error instanceof UploadSessionFinalizingError) {
          setResponseStatus(event, 409);
          return { error: "Upload session is already finalizing" };
        }
        console.warn("[slides-upload] aborted session cleanup failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      setResponseStatus(event, 503);
      return { error: "Could not clean up upload session" };
    },
    authContext,
  );
});
