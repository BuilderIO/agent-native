// guard:allow-api-route - anonymous intake is a signed upload transport, not a CRUD API.

import { createError, defineEventHandler, getQuery, type H3Event } from "h3";

import {
  completeClipIntake,
  resolveClipIntakeRequest,
} from "../../lib/clip-intake.js";
import { handleAbortRecordingUpload } from "./uploads/[recordingId]/abort.post.js";
import { handleRecordingChunk } from "./uploads/[recordingId]/chunk.post.js";

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
  if (operation !== "chunk" && operation !== "abort") {
    throw createError({
      statusCode: 405,
      statusMessage: "Unsupported operation",
    });
  }

  const access = await resolveClipIntakeRequest(event, recordingId);
  const override = {
    recordingId,
    ownerEmail: access.ownerEmail,
    orgId: access.orgId,
  };

  if (operation === "abort") {
    return handleAbortRecordingUpload(event, override);
  }

  const result = await handleRecordingChunk(event, override);
  const body =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : null;
  if (body && (body.finalized === true || body.verificationPending === true)) {
    const intakeId = queryString(event, "clip_intake_id");
    if (intakeId) await completeClipIntake(intakeId, recordingId);
  }
  return result;
});
