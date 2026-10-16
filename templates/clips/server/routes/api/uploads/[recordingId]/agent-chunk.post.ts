// guard:allow-api-route - agent uploads are a ticketed byte transport, not a CRUD API.

import { createError, defineEventHandler, getRouterParam } from "h3";

import { requireRecordingUploadTicketOwner } from "../../../../lib/recording-upload-ticket.js";
import { handleRecordingChunk } from "./chunk.post.js";

export default defineEventHandler(async (event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    throw createError({ statusCode: 400, message: "Missing recordingId" });
  }
  const owner = await requireRecordingUploadTicketOwner(event, recordingId);
  return handleRecordingChunk(event, owner);
});
