/**
 * Accept one call-recording chunk. Matches the clips chunk receiver — every
 * chunk lands here base64-encoded in application_state and `finalize-call`
 * stitches them together at the end.
 *
 * Query params:
 *   index     — 0-based chunk index
 *   total     — expected total chunks (may be updated on the final chunk)
 *   isFinal   — "1" when this is the last chunk; triggers finalize-call
 *   mimeType  — optional override for the assembled blob MIME type
 *   durationMs / width / height — forwarded to finalize
 *
 * Route: POST /api/uploads/:callId/chunk?index=N&total=T&isFinal=0|1
 *
 * Auth: requires an authenticated session AND `editor` access on the call.
 * The callId comes from the URL — without re-asserting access here a guesser
 * could overwrite another tenant's recording. Each chunk request is
 * independent on serverless so the check has to happen on every chunk, not
 * once at upload-start.
 */

import {
  createError,
  defineEventHandler,
  getHeader,
  getRouterParam,
  getQuery,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db/index.js";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { writeAppState } from "@agent-native/core/application-state";
import finalizeCall from "../../../../../actions/finalize-call.js";

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export default defineEventHandler(async (event: H3Event) => {
  const callId = getRouterParam(event, "callId");
  if (!callId) {
    setResponseStatus(event, 400);
    return { error: "Missing callId" };
  }

  const query = getQuery(event);
  const index = Number(query.index ?? 0);
  const total = Number(query.total ?? 0);
  const isFinal = query.isFinal === "1" || query.isFinal === "true";
  const mimeType =
    typeof query.mimeType === "string" ? query.mimeType : "video/webm";

  if (!Number.isFinite(index) || index < 0) {
    setResponseStatus(event, 400);
    return { error: "Invalid chunk index" };
  }

  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }

  const MAX_CHUNK_BYTES = 6 * 1024 * 1024; // 6MB cap (5MB client + slack)
  const contentLength = Number(getHeader(event, "content-length") || 0);
  if (contentLength > MAX_CHUNK_BYTES) {
    setResponseStatus(event, 413);
    return { error: "Chunk too large" };
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      try {
        await assertAccess("call", callId, "editor");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          setResponseStatus(event, 403);
          return { error: "Forbidden" };
        }
        throw err;
      }

      const db = getDb();
      const raw = await readRawBody(event, false);
      const bodySize = raw ? raw.byteLength : 0;
      if (bodySize > MAX_CHUNK_BYTES) {
        setResponseStatus(event, 413);
        return { error: "Chunk too large" };
      }
      if (!isFinal && bodySize === 0) {
        setResponseStatus(event, 400);
        return { error: "Empty chunk body" };
      }

      const bytes: Uint8Array = raw ?? new Uint8Array(0);

      if (bytes.byteLength > 0) {
        const paddedIndex = String(index).padStart(6, "0");
        const chunkKey = `call-chunks-${callId}-${paddedIndex}`;

        await writeAppState(chunkKey, {
          callId,
          index,
          bytes: bytes.byteLength,
          mimeType,
          data: toBase64(bytes),
          createdAt: new Date().toISOString(),
        });
      }

      if (total > 0) {
        const progress = Math.min(100, Math.round(((index + 1) / total) * 100));
        await writeAppState(`call-upload-${callId}`, {
          callId,
          status: isFinal ? "processing" : "uploading",
          progress,
          chunksReceived: index + 1,
          totalChunks: total,
          mimeType,
          updatedAt: new Date().toISOString(),
        });

        await db
          .update(schema.calls)
          .set({
            progressPct: progress,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.calls.id, callId));
      }

      if (isFinal) {
        try {
          const result = await finalizeCall.run({
            id: callId,
            durationMs: query.durationMs ? Number(query.durationMs) : undefined,
            width: query.width ? Number(query.width) : undefined,
            height: query.height ? Number(query.height) : undefined,
            mimeType,
          });
          return { ok: true, finalized: true, ...result };
        } catch (err) {
          console.error("[calls] finalize-call failed:", err);
          await db
            .update(schema.calls)
            .set({
              status: "failed",
              failureReason:
                err instanceof Error ? err.message : "Finalize failed",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.calls.id, callId));
          await writeAppState(`call-upload-${callId}`, {
            callId,
            status: "failed",
            failureReason:
              err instanceof Error ? err.message : "Finalize failed",
            updatedAt: new Date().toISOString(),
          });
          setResponseStatus(event, 500);
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Finalize failed",
          };
        }
      }

      return {
        ok: true,
        finalized: false,
        index,
        bytes: bytes.byteLength,
      };
    },
  );
});
