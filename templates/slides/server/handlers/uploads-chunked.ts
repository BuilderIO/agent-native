import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
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
  createChunkedUploadSession,
  deleteChunkedUploadSession,
  getChunkedUploadSession,
  listChunkedUploadSessions,
  type ChunkedUploadSession,
} from "../lib/chunked-upload-session.js";
import { isHostedSlidesRuntime } from "../lib/tenant-files.js";
import {
  resolveSlidesRequestAuth,
  withSlidesRequestContext,
} from "./request-auth-context.js";
import { maxReferenceFileBytes, saveUploadedReferenceFile } from "./uploads.js";

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 128;
const SESSION_TTL_MS = 60 * 60 * 1000;

interface StartBody {
  filename?: unknown;
  mimetype?: unknown;
  declaredSize?: unknown;
}

async function deleteChunk(handle: ChunkedUploadSession["chunks"][string]) {
  return (await deletePrivateBlob(handle)).deleted;
}

async function cleanupChunks(session: ChunkedUploadSession): Promise<boolean> {
  const results = await Promise.all(
    Object.values(session.chunks).map(deleteChunk),
  );
  return results.every(Boolean);
}

async function discardSession(
  sessionId: string,
  session: ChunkedUploadSession,
): Promise<boolean> {
  const cleaned = await cleanupChunks(session);
  if (cleaned) await deleteChunkedUploadSession(sessionId);
  return cleaned;
}

async function reapExpiredChunkedUploads(): Promise<void> {
  const now = Date.now();
  const sessions = await listChunkedUploadSessions();
  await Promise.all(
    sessions.map(async ({ sessionId, session }) => {
      const expiresAt = Date.parse(session.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt > now) return;
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
    const cleaned = await discardSession(sessionId, session);
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
    async () => {
      if (!isHostedSlidesRuntime()) {
        return { uploadMode: "multipart" as const };
      }
      await reapExpiredChunkedUploads();
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
      if (!filename) {
        setResponseStatus(event, 400);
        return { error: "filename is required" };
      }
      if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
        setResponseStatus(event, 400);
        return { error: "declaredSize must be a positive integer" };
      }
      const limit = maxReferenceFileBytes(filename);
      if (declaredSize > limit) {
        setResponseStatus(event, 413);
        return {
          error: `File too large (max ${Math.round(limit / 1024 / 1024)} MB)`,
        };
      }

      const sessionId = nanoid();
      const now = Date.now();
      await createChunkedUploadSession(sessionId, {
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
      const session = await getChunkedUploadSession(sessionId);
      if (!session) {
        setResponseStatus(event, 404);
        return { error: "Upload session not found or expired" };
      }
      if (Date.parse(session.expiresAt) <= Date.now()) {
        await discardSession(sessionId, session);
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
      const fileLimit = maxReferenceFileBytes(session.filename);
      if (nextSize > session.declaredSize || nextSize > fileLimit) {
        await discardSession(sessionId, session);
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
      if (previousHandle && !(await deleteChunk(previousHandle))) {
        setResponseStatus(event, 503);
        return { error: "Could not replace the previously uploaded chunk" };
      }

      const handle = await putPrivateBlob({
        data: bytes,
        filename: `${sessionId}-${index}`,
        mimeType: "application/octet-stream",
        ownerEmail: email,
      });
      if (!handle) {
        setResponseStatus(event, 503);
        return { error: "Upload storage is not available" };
      }
      session.chunks[chunkKey] = handle;
      session.chunkSizes[chunkKey] = bytes.byteLength;
      await createChunkedUploadSession(sessionId, session);

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
        await discardSession(sessionId, session);
        setResponseStatus(event, 400);
        return { error: "Upload is incomplete or has an invalid size" };
      }

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
        result = await saveUploadedReferenceFile({
          email,
          orgId,
          originalName: session.filename,
          data: combined,
          type: session.mimeType,
        });
      } catch (err) {
        await discardSession(sessionId, session);
        const statusCode =
          typeof (err as { statusCode?: unknown })?.statusCode === "number"
            ? (err as { statusCode: number }).statusCode
            : 400;
        setResponseStatus(event, statusCode);
        return { error: err instanceof Error ? err.message : "Invalid upload" };
      }

      await cleanupCommittedSession(sessionId, session);
      return [result];
    },
    authContext,
  );
});
