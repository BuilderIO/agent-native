import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { clipEmbedBlockRaw } from "../shared/clip-embed-block.js";
import {
  CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS,
  CONTENT_CLIP_UPLOAD_KEY,
  CONTENT_CLIP_UPLOAD_MIME_TYPES,
} from "../shared/clips-peer-contract.js";
import { clipEmbedArgsSchema } from "./_clip-embed-access.js";
import { clipStorageSchema, startClipUpload } from "./_clip-upload.js";

/**
 * The id the page's Clip block has for one file. Clips binds the Clip to it
 * and refuses a repeated start that names another, so every start of the
 * same upload key must name the same id.
 */
function blockIdFor(uploadKey: string): string {
  return `clip-embed-${uploadKey}`;
}

function clipEmbedTag(blockId: string, recordingId: string): string {
  return clipEmbedBlockRaw(blockId, { recordingId, origin: "upload" });
}

const next = z.string();

const outputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("started"),
    recordingId: z.string(),
    uploadKey: z.string(),
    clipEmbedTag: z.string(),
    method: z.literal("POST"),
    chunkUrl: z.string(),
    cancelUrl: z.string(),
    chunkSizeBytes: z.number().int().positive(),
    totalChunks: z.number().int().positive(),
    expiresAt: z.string(),
    next,
  }),
  z.object({
    status: z.literal("already_finished"),
    recordingId: z.string(),
    uploadKey: z.string(),
    clipEmbedTag: z.string(),
    next,
  }),
  z.object({ status: z.literal("starting"), uploadKey: z.string(), next }),
  z.object({ status: z.literal("key_used"), next }),
  z.object({
    status: z.literal("storage_required"),
    storage: clipStorageSchema,
    next,
  }),
  z.object({
    status: z.literal("too_large"),
    maxBytes: z.number().int().positive(),
    next,
  }),
]);

const PLACE_TAG =
  "Put clipEmbedTag in the page where the video belongs with edit-document, as its own line, and leave the tag as it is.";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Upload a local video file into a page as a Clip, the way an editor's upload does. Checks you can edit the page, then has Clips make a private Clip bound to the page, so who can watch it follows the page's sharing. Returns a short-lived upload URL for that one Clip, the steps to POST the file to it in chunks, and the ClipEmbed tag to put in the page with edit-document. The file goes straight to Clips, never through Content. To link a Clip that already exists instead, write its ClipEmbed tag with origin=\"link\".",
  schema: clipEmbedArgsSchema.pick({ documentId: true }).extend({
    fileName: z
      .string()
      .trim()
      .min(1)
      .transform((name) => name.slice(0, CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS))
      .describe(
        "The video file's name, such as demo.mp4; Clips titles the Clip from it",
      ),
    sizeBytes: z.number().int().positive().describe("The file's size in bytes"),
    mimeType: z
      .enum(CONTENT_CLIP_UPLOAD_MIME_TYPES)
      .describe(
        "The file's type: video/mp4, video/webm, or video/quicktime (.mov)",
      ),
    uploadKey: z
      .string()
      .regex(CONTENT_CLIP_UPLOAD_KEY)
      .optional()
      .describe(
        "Omit on the first start. To start the same file again, as after a failed call or an answer of starting, send the uploadKey the first start returned: Clips then answers with that upload instead of making a second Clip.",
      ),
  }),
  outputSchema,
  agentTool: false,
  // An outside agent holding a file has no other way to put it in a page as
  // a Clip. The app's own agent has no local files to send.
  mcpTool: true,
  // Its ticket uploads into the caller's Clips.
  persistInBrowser: false,
  run: async (args, ctx) => {
    const uploadKey = args.uploadKey ?? randomUUID();
    const blockId = blockIdFor(uploadKey);
    const answer = await startClipUpload(
      {
        documentId: args.documentId,
        fileName: args.fileName,
        sizeBytes: args.sizeBytes,
        mimeType: args.mimeType,
        blockId,
        uploadKey,
      },
      ctx,
    );
    switch (answer.status) {
      case "started":
        return {
          status: answer.status,
          recordingId: answer.recordingId,
          uploadKey,
          clipEmbedTag: clipEmbedTag(blockId, answer.recordingId),
          method: "POST" as const,
          chunkUrl: answer.chunkUrl,
          cancelUrl: answer.cancelUrl,
          chunkSizeBytes: answer.chunkSizeBytes,
          totalChunks: answer.totalChunks,
          expiresAt: answer.expiresAt,
          next: `Split the file into ${answer.totalChunks} chunk(s) of chunkSizeBytes (the last may be shorter). POST them one at a time, in order, each as the raw request body with no other headers, to chunkUrl + "&index=N&isFinal=0", N counting from 0. Send the last chunk with "&isFinal=1": it finishes the upload, and Clips then makes the Clip. If its answer has waitingForStorage true, Clips holds the file but has nowhere to save it yet: tell the user to connect video storage in Clips. Retry a chunk that failed with a 429 or 5xx with the same index. The upload URL stops working once the last chunk is accepted or at expiresAt. To give the upload up before then, POST to cancelUrl. Then: ${PLACE_TAG}`,
        };
      case "already_finished":
        return {
          status: answer.status,
          recordingId: answer.recordingId,
          uploadKey,
          clipEmbedTag: clipEmbedTag(blockId, answer.recordingId),
          next: `Clips already has this whole file from an earlier start, so send nothing. ${PLACE_TAG} Skip that if the page already has it.`,
        };
      case "starting":
        return {
          status: answer.status,
          uploadKey,
          next: "An earlier start of this file is still setting up its upload. Call create-video-upload again in a few seconds with the same uploadKey.",
        };
      case "key_used":
        return {
          status: answer.status,
          next: "This uploadKey's upload ended, so it can't continue. Call create-video-upload again without uploadKey to upload the file from the start.",
        };
      case "storage_required":
        return {
          status: answer.status,
          storage: answer.storage,
          next: "Clips has nowhere to save this video for you, so nothing was uploaded: tell the user, and ask them to connect video storage in Clips, then try again.",
        };
      case "too_large":
        return {
          status: answer.status,
          maxBytes: answer.maxBytes,
          next: `The file is larger than the ${answer.maxBytes} bytes Clips takes, so nothing was uploaded. Tell the user, or upload a smaller file.`,
        };
    }
  },
});
