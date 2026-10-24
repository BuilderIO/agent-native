import type { ActionRunContext } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server";
import { UPLOAD_SLICE_BYTES } from "@shared/recording-core.js";
import type { z } from "zod";

import createRecording from "../../actions/create-recording.js";
import type { createRecordingSchema } from "../../actions/lib/create-recording-schema.js";
import {
  createRecordingUploadTicket,
  releaseRecordingUploadTicket,
} from "./recording-upload-ticket.js";
import { getCurrentOwnerEmail, nanoid } from "./recordings.js";

type CreateRecordingArgs = z.input<typeof createRecordingSchema>;

export interface RecordingUploadStart {
  recordingId: string;
  /** The upload ticket: the only thing a chunk request needs. */
  ticket: string;
  expiresAt: string;
  chunkSizeBytes: number;
  totalChunks: number;
  /** The chunk route's query, without `index` and `isFinal`. */
  chunkQuery: URLSearchParams;
}

/**
 * Makes a recording in "uploading" for the signed-in owner and the ticket that
 * uploads its file in chunks, the way an agent's upload starts.
 */
export async function startRecordingUpload(
  input: {
    /** Made up when absent. */
    recordingId?: string;
    title?: string;
    visibility: NonNullable<CreateRecordingArgs["visibility"]>;
    mimeType: string;
    sizeBytes: number;
    durationMs?: number;
    width?: number;
    height?: number;
    recordingSource: NonNullable<CreateRecordingArgs["recordingSource"]>;
  },
  actionContext?: ActionRunContext,
): Promise<RecordingUploadStart> {
  const ownerEmail = getCurrentOwnerEmail();
  // The ticket comes first: if it is refused or fails to save, no recording
  // is left stranded in "uploading" with nothing able to finish it.
  const recordingId = input.recordingId ?? nanoid();
  const ticket = await createRecordingUploadTicket(
    ownerEmail,
    recordingId,
    getRequestContext()?.authUserId,
  );
  try {
    await createRecording.run(
      {
        id: recordingId,
        title: input.title,
        visibility: input.visibility,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        hasAudio: true,
        hasCamera: false,
        recordingSource: input.recordingSource,
        requestStreaming: true,
      },
      actionContext,
    );
  } catch (error) {
    // create-recording fails its own half-made row, or the lease reaper does;
    // only the ticket, which the caller never received, is ours to release.
    await releaseRecordingUploadTicket(ownerEmail, recordingId).catch(
      (releaseError) => {
        console.warn("[recording-upload] ticket release failed", {
          recordingId,
          error:
            releaseError instanceof Error
              ? releaseError.message
              : String(releaseError),
        });
      },
    );
    throw error;
  }

  const totalChunks = Math.max(
    1,
    Math.ceil(input.sizeBytes / UPLOAD_SLICE_BYTES),
  );
  const chunkQuery = new URLSearchParams({
    mimeType: input.mimeType,
    total: String(totalChunks),
    hasAudio: "1",
    hasCamera: "0",
  });
  if (input.durationMs) chunkQuery.set("durationMs", String(input.durationMs));
  if (input.width) chunkQuery.set("width", String(input.width));
  if (input.height) chunkQuery.set("height", String(input.height));

  return {
    recordingId,
    ticket: ticket.token,
    expiresAt: new Date(ticket.expiresAt).toISOString(),
    chunkSizeBytes: UPLOAD_SLICE_BYTES,
    totalChunks,
    chunkQuery,
  };
}
