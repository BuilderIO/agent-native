// guard:allow-api-route - anonymous intake is a signed upload transport, not a CRUD API.

import { createError, defineEventHandler, getQuery, type H3Event } from "h3";

import {
  abandonClipIntake,
  completeClipIntake,
  resolveClipIntakeRequest,
} from "../../lib/clip-intake.js";
import { handleAbortRecordingUpload } from "./uploads/[recordingId]/abort.post.js";
import { handleRecordingChunk } from "./uploads/[recordingId]/chunk.post.js";
import { handleResetRecordingChunks } from "./uploads/[recordingId]/reset-chunks.post.js";

function queryString(event: H3Event, key: string): string | null {
  const value = getQuery(event)[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = queryString(event, "recordingId");
  if (!recordingId || recordingId.length > 200 || /[\r\n]/.test(recordingId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing recordingId",
    });
  }

  const operation = queryString(event, "operation");
  if (operation !== "chunk" && operation !== "abort" && operation !== "reset") {
    throw createError({
      statusCode: 405,
      statusMessage: "Unsupported operation",
    });
  }

  const access = await resolveClipIntakeRequest(event, recordingId);
  const intakeId = queryString(event, "clip_intake_id");
  const override = {
    recordingId,
    ownerEmail: access.ownerEmail,
    orgId: access.orgId,
  };

  if (operation === "reset") {
    return handleResetRecordingChunks(event, override);
  }

  if (operation === "abort") {
    const result = await handleAbortRecordingUpload(event, override);
    const body =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : null;
    if (body?.ok === true) {
      if (body.alreadyReady === true || body.verificationPending === true) {
        if (intakeId) await completeClipIntake(intakeId, recordingId);
      } else if (intakeId) {
        await abandonClipIntake(intakeId, recordingId);
      }
    }
    return result;
  }

  const result = await handleRecordingChunk(event, override);
  const body =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : null;
  if (body?.status === "failed" || body?.aborted === true) {
    if (intakeId) await abandonClipIntake(intakeId, recordingId);
  } else if (
    body &&
    (body.finalized === true ||
      body.verificationPending === true ||
      body.waitingForStorage === true)
  ) {
    if (intakeId) await completeClipIntake(intakeId, recordingId);
  }

  if (!body) return result;
  const {
    videoUrl: _videoUrl,
    thumbnailUrl: _thumbnailUrl,
    animatedThumbnailUrl: _animatedThumbnailUrl,
    filmstripUrl: _filmstripUrl,
    ...safeResult
  } = body;
  return safeResult;
});
