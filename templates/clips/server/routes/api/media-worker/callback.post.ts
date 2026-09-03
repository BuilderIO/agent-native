import {
  resolveSecret,
  runWithRequestContext,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getRequestHeader,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  MEDIA_WORKER_SIGNATURE_HEADER,
  MEDIA_WORKER_TIMESTAMP_HEADER,
  parseMediaWorkerCallback,
  verifyMediaWorkerSignature,
} from "../../../../shared/media-worker-contract.js";
import { getDb, schema } from "../../../db/index.js";
import { applyMediaWorkerCallback } from "../../../lib/builder-media-compression.js";
import {
  CLIPS_MEDIA_WORKER_SECRET,
  mediaWorkerJobRecordingId,
} from "../../../lib/media-worker.js";

export default defineEventHandler(async (event: H3Event) => {
  const rawBody = (await readRawBody(event)) ?? "";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    setResponseStatus(event, 400);
    return { ok: false, error: "Invalid JSON body" };
  }

  const callback = parseMediaWorkerCallback(parsed);
  if (!callback) {
    setResponseStatus(event, 400);
    return { ok: false, error: "Invalid media worker callback payload" };
  }

  const recordingId = mediaWorkerJobRecordingId(callback.jobId, "compress");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { ok: false, error: "Invalid media worker jobId" };
  }

  const db = getDb();
  const [recording] = await db
    .select({
      ownerEmail: schema.recordings.ownerEmail,
      orgId: schema.recordings.orgId,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  if (!recording) {
    setResponseStatus(event, 404);
    return { ok: false, error: "Recording not found" };
  }

  return runWithRequestContext(
    { userEmail: recording.ownerEmail, orgId: recording.orgId ?? undefined },
    async () => {
      const secret = await resolveSecret(CLIPS_MEDIA_WORKER_SECRET);
      const signature = verifyMediaWorkerSignature({
        rawBody,
        secret,
        timestamp: getRequestHeader(event, MEDIA_WORKER_TIMESTAMP_HEADER),
        signature: getRequestHeader(event, MEDIA_WORKER_SIGNATURE_HEADER),
      });
      if (!signature.ok) {
        setResponseStatus(event, secret ? 401 : 503);
        return {
          ok: false,
          error: secret
            ? "Invalid media worker signature"
            : "Media worker secret is not configured",
        };
      }

      const result = await applyMediaWorkerCallback(callback);
      setResponseStatus(event, result.status);
      return result;
    },
  );
});
