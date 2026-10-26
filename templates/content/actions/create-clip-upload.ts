import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requestClipsUpload } from "../server/lib/clips-peer.js";
import { isClipRecordingId } from "../shared/clip-embed-block.js";
import {
  CLIP_UPLOAD_ERRORS,
  CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS,
  CONTENT_CLIP_UPLOAD_KEY,
  CONTENT_CLIP_UPLOAD_MIME_TYPES,
  CONTENT_CLIP_UPLOAD_REFUSED,
  type CreateClipUploadResult,
} from "../shared/clips-peer-contract.js";
import {
  authorizeClipUploader,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";
import {
  clipStorageSchema,
  isClipUploadUrl,
  uploaderIp,
} from "./_clip-upload.js";

const startedSchema = z.object({
  recordingId: z.string(),
  chunkUrl: z.string(),
  cancelUrl: z.string(),
  chunkSizeBytes: z.number().int().positive(),
  totalChunks: z.number().int().positive(),
  expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
});

const storageRequiredSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.storageRequired),
  storage: clipStorageSchema,
});

const alreadyFinishedSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.alreadyFinished),
  recordingId: z.string().refine(isClipRecordingId),
});

const startingSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.uploadStarting),
});

const tooLargeSchema = z.object({
  code: z.literal(CONTENT_CLIP_UPLOAD_REFUSED.tooLarge),
  maxBytes: z.number().int().positive(),
});

function readAnswer(status: number, body: unknown): CreateClipUploadResult {
  if (status === 200) {
    const started = startedSchema.safeParse(body);
    if (
      started.success &&
      isClipUploadUrl(
        started.data.chunkUrl,
        started.data.recordingId,
        "content-chunk",
      ) &&
      isClipUploadUrl(
        started.data.cancelUrl,
        started.data.recordingId,
        "content-cancel",
      )
    ) {
      return { status: "started", ...started.data };
    }
  }
  if (status === 409) {
    const refused = storageRequiredSchema.safeParse(body);
    if (refused.success) {
      return { status: "storage_required", storage: refused.data.storage };
    }
    const finished = alreadyFinishedSchema.safeParse(body);
    if (finished.success) {
      return {
        status: "already_finished",
        recordingId: finished.data.recordingId,
      };
    }
    if (startingSchema.safeParse(body).success) return { status: "starting" };
  }
  if (status === 413) {
    const refused = tooLargeSchema.safeParse(body);
    if (refused.success) {
      return { status: "too_large", maxBytes: refused.data.maxBytes };
    }
  }
  console.warn("[content-clips] unreadable upload start answer", { status });
  failClip(CLIP_UPLOAD_ERRORS.failed);
}

export default defineAction({
  description:
    "Start uploading a video into this page as a Clip. Checks the caller can edit the page, then asks Clips for a private Clip bound to the page and a ticketed URL the browser posts the file to; the file never passes through Content. When Clips has nowhere to save it, answers with the storage state instead. A start repeated with the same uploadKey reaches the upload the first one made.",
  schema: clipEmbedArgsSchema.pick({ documentId: true }).extend({
    fileName: z
      .string()
      .trim()
      .min(1)
      .transform((name) => name.slice(0, CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS))
      .describe("The video file's name; Clips titles the Clip from it"),
    sizeBytes: z.number().int().positive().describe("The file's size"),
    mimeType: z.enum(CONTENT_CLIP_UPLOAD_MIME_TYPES),
    blockId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .describe("The id the page's Clip block will have"),
    uploadKey: z
      .string()
      .regex(CONTENT_CLIP_UPLOAD_KEY)
      .describe("Made once per picked file and sent with every start of it"),
  }),
  agentTool: false,
  // Its ticket uploads into the caller's Clips.
  persistInBrowser: false,
  run: async (
    { documentId, fileName, sizeBytes, mimeType, blockId, uploadKey },
    ctx,
  ): Promise<CreateClipUploadResult> => {
    const uploader = await authorizeClipUploader(documentId);
    const answer = await requestClipsUpload({
      uploader,
      documentId,
      clientIp: uploaderIp(ctx),
      start: { fileName, sizeBytes, mimeType, blockId, uploadKey },
    });
    if (!answer.ok) failClip(answer.code);
    return readAnswer(answer.status, answer.body);
  },
});
