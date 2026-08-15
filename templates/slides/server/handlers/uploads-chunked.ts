import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
} from "@agent-native/core/private-blob";
import {
  defineEventHandler,
  getHeader,
  getRouterParam,
  getQuery,
  readBody,
  readRawBody,
  setResponseStatus,
} from "h3";
import { nanoid } from "nanoid";

import {
  createChunkedUploadSession,
  deleteChunkedUploadSession,
  getChunkedUploadSession,
  type ChunkedUploadSession,
} from "../lib/chunked-upload-session.js";
import {
  resolveSlidesRequestAuthContext,
  withSlidesRequestContext,
} from "./request-auth-context.js";
import { maxReferenceFileBytes, saveUploadedReferenceFile } from "./uploads.js";

// Netlify functions have a 6 MB buffered request cap, but binary requests are
// base64 encoded by the gateway and effectively cap out around 4.5 MB. A
// single-shot multipart POST of a real PPTX/PDF routinely exceeds that, so
// large reference files stream here in sub-4 MB slices instead: each chunk
// lands in its own private blob, and the final chunk reassembles them into
// one buffer before running the same validation/storage path as /api/uploads.
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 128;

interface StartBody {
  filename?: unknown;
  mimetype?: unknown;
  declaredSize?: unknown;
}

export const startChunkedUpload = defineEventHandler(async (event) => {
  const authContext = await resolveSlidesRequestAuthContext(event);
  if (!authContext.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return withSlidesRequestContext(
    event,
    async () => {
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
      await createChunkedUploadSession(sessionId, {
        filename,
        mimeType: mimetype,
        declaredSize,
        chunks: {},
      });
      return { sessionId, maxChunkBytes: MAX_CHUNK_BYTES };
    },
    authContext,
  );
});

export const uploadChunkedChunk = defineEventHandler(async (event) => {
  const authContext = await resolveSlidesRequestAuthContext(event);
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

      const query = getQuery(event);
      const index = Number(query.index ?? 0);
      const isFinal = query.isFinal === "1" || query.isFinal === "true";
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
        setResponseStatus(event, 400);
        return { error: "Invalid chunk index" };
      }

      const contentLength = Number(getHeader(event, "content-length") || 0);
      if (contentLength > MAX_CHUNK_BYTES) {
        setResponseStatus(event, 413);
        return { error: "Chunk too large" };
      }

      const raw = await readRawBody(event, false);
      const bytes = raw ?? new Uint8Array(0);
      if (bytes.byteLength > MAX_CHUNK_BYTES) {
        setResponseStatus(event, 413);
        return { error: "Chunk too large" };
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
      session.chunks[String(index)] = handle;
      await createChunkedUploadSession(sessionId, session);

      if (!isFinal) {
        return { ok: true };
      }

      const orderedIndices = Object.keys(session.chunks)
        .map(Number)
        .sort((a, b) => a - b);
      const missing = orderedIndices.some((value, i) => value !== i);
      if (missing || orderedIndices.length === 0) {
        await cleanupChunks(session);
        await deleteChunkedUploadSession(sessionId);
        setResponseStatus(event, 400);
        return { error: "Upload is missing chunks" };
      }

      const parts = await Promise.all(
        orderedIndices.map(async (chunkIndex) => {
          const chunkHandle = session.chunks[String(chunkIndex)];
          const read = await readPrivateBlob(chunkHandle);
          return Buffer.from(read.data);
        }),
      );
      const combined = Buffer.concat(parts);

      let result;
      try {
        result = await saveUploadedReferenceFile({
          email,
          orgId,
          originalName: session.filename,
          data: combined,
          type: session.mimeType,
        });
      } catch (err) {
        await cleanupChunks(session);
        await deleteChunkedUploadSession(sessionId);
        const statusCode =
          typeof (err as { statusCode?: unknown })?.statusCode === "number"
            ? (err as { statusCode: number }).statusCode
            : 400;
        setResponseStatus(event, statusCode);
        return { error: err instanceof Error ? err.message : "Invalid upload" };
      }

      await cleanupChunks(session);
      await deleteChunkedUploadSession(sessionId);
      return [result];
    },
    authContext,
  );
});

async function cleanupChunks(session: ChunkedUploadSession): Promise<void> {
  await Promise.all(
    Object.values(session.chunks).map((handle) =>
      deletePrivateBlob(handle).catch(() => undefined),
    ),
  );
}
