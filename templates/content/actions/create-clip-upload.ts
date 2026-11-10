import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  CONTENT_CLIP_UPLOAD_FILE_NAME_CHARS,
  CONTENT_CLIP_UPLOAD_KEY,
  CONTENT_CLIP_UPLOAD_MIME_TYPES,
  type CreateClipUploadResult,
} from "../shared/clips-peer-contract.js";
import { clipEmbedArgsSchema } from "./_clip-embed-access.js";
import { clipUploadResultSchema, startClipUpload } from "./_clip-upload.js";

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
  outputSchema: clipUploadResultSchema,
  agentTool: false,
  // Its ticket uploads into the caller's Clips.
  persistInBrowser: false,
  run: async (args, ctx): Promise<CreateClipUploadResult> =>
    startClipUpload(args, ctx),
});
