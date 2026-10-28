import { defineAction } from "@agent-native/core/action";
import {
  getAppProductionUrl,
  getRequestContext,
} from "@agent-native/core/server";
import { formatUploadBytes, MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { z } from "zod";

import { getServerAppBasePath } from "../server/lib/public-agent-context.js";
import { startRecordingUpload } from "../server/lib/recording-upload-start.js";

const MAX_UPLOAD_SIZE = formatUploadBytes(MAX_UPLOAD_BYTES, "down");

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description: `Upload a local video file to Clips. Creates the recording at the visibility you choose and returns a short-lived upload URL bound to that one recording, plus the steps to POST the file in chunks. The last chunk finalizes the clip; Clips then transcribes it and, when no title is given, titles it. Returns the share link. Files can be up to ${MAX_UPLOAD_SIZE} with connected video storage, but Clips' free hosted storage takes clips up to its own limit (250 MB by default). A larger file is refused before the recording is created, with the limit that applies.`,
  // Advertised up front: an outside agent holding a file has no other way in,
  // and `mcpTool: true` would switch Clips to a connector tier that drops the
  // reads already listed here.
  mcpApp: { compactCatalog: true },
  schema: z.object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "Clip title. Omit to let Clips title it from the transcript after upload.",
      ),
    visibility: z
      .enum(["private", "org", "public"])
      .describe(
        "Who can open the share link: private (only you and people you share it with), org (members of your organization), or public (anyone with the link).",
      ),
    mimeType: z
      .enum(["video/mp4", "video/webm", "video/quicktime"])
      .describe(
        "The file's type: video/mp4, video/webm, or video/quicktime (.mov).",
      ),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_UPLOAD_BYTES)
      .describe(
        `The file's size in bytes: up to ${MAX_UPLOAD_SIZE} with connected video storage, or up to the hosted limit (250 MB by default) on Clips' free hosted storage.`,
      ),
    durationMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Video length in milliseconds, shown in the player and library.",
      ),
    width: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Video width in pixels."),
    height: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Video height in pixels."),
  }),
  run: async (args, actionContext) => {
    const upload = await startRecordingUpload(
      {
        title: args.title,
        visibility: args.visibility,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        durationMs: args.durationMs,
        width: args.width,
        height: args.height,
        recordingSource: "agent_upload",
      },
      actionContext,
    );
    const { recordingId, totalChunks } = upload;
    const appUrl = `${new URL(getRequestContext()?.requestOrigin || getAppProductionUrl()).origin}${getServerAppBasePath()}`;

    return {
      recordingId,
      visibility: args.visibility,
      shareUrl: `${appUrl}/share/${encodeURIComponent(recordingId)}`,
      method: "POST" as const,
      chunkUrl: `${appUrl}/api/uploads/${encodeURIComponent(recordingId)}/agent-chunk?${upload.chunkQuery.toString()}`,
      headers: {
        Authorization: `Bearer ${upload.ticket}`,
        "Content-Type": args.mimeType,
      },
      chunkSizeBytes: upload.chunkSizeBytes,
      totalChunks,
      expiresAt: upload.expiresAt,
      next: `Split the file into ${totalChunks} chunk(s) of chunkSizeBytes (the last may be shorter). POST them one at a time, in order, as the raw request body to chunkUrl + "&index=N&isFinal=0" with the returned headers, N counting from 0. Send the last chunk with "&isFinal=1": that request finalizes the recording, so do not call finalize-recording. Retry a failed chunk with the same index. The upload URL stops working once the last chunk is accepted (a retried last chunk then gets 409 saying so; read the clip with get-recording-player-data rather than uploading again) or at expiresAt. Then give the user shareUrl; transcription, and a title when none was given, follow in the background.`,
    };
  },
});
