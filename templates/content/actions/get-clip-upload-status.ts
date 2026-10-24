import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requestClipsUpload } from "../server/lib/clips-peer.js";
import {
  CLIP_UPLOAD_ERRORS,
  type ContentClipStorage,
} from "../shared/clips-peer-contract.js";
import {
  authorizeClipUploader,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";
import { clipStorageSchema, uploaderIp } from "./_clip-upload.js";

const answerSchema = z.object({ storage: clipStorageSchema });

export default defineAction({
  description:
    "Where a video uploaded into this page would be saved as a Clip, as Clips says: storage that's ready, free clips left, free clips used up, no storage, or no Clips account yet. Checks the caller can edit the page first.",
  schema: clipEmbedArgsSchema.pick({ documentId: true }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  // A storage state goes stale the moment someone connects storage.
  persistInBrowser: false,
  run: async (
    { documentId },
    ctx,
  ): Promise<{ storage: ContentClipStorage }> => {
    const uploader = await authorizeClipUploader(documentId);
    const answer = await requestClipsUpload({
      uploader,
      documentId,
      clientIp: uploaderIp(ctx),
    });
    if (!answer.ok) failClip(answer.code);

    const parsed = answerSchema.safeParse(answer.body);
    if (answer.status !== 200 || !parsed.success) {
      console.warn("[content-clips] unreadable upload status answer", {
        status: answer.status,
      });
      failClip(CLIP_UPLOAD_ERRORS.failed);
    }
    return parsed.data;
  },
});
