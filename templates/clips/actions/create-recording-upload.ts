import { defineAction } from "@agent-native/core/action";
import {
  getAppProductionUrl,
  getRequestContext,
} from "@agent-native/core/server";
import { UPLOAD_SLICE_BYTES } from "@shared/recording-core.js";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { z } from "zod";

import { getServerAppBasePath } from "../server/lib/public-agent-context.js";
import {
  createRecordingUploadTicket,
  releaseRecordingUploadTicket,
} from "../server/lib/recording-upload-ticket.js";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";
import createRecording from "./create-recording.js";

export default defineAction({
  description:
    "Upload a local video file to Clips. Creates the recording at the visibility you choose and returns a short-lived upload URL bound to that one recording, plus the steps to POST the file in chunks. The last chunk finalizes the clip; Clips then transcribes it and, when no title is given, titles it. Returns the share link.",
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
      .describe("The file's size in bytes, up to 2 GiB."),
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
    const ownerEmail = getCurrentOwnerEmail();
    // The ticket comes first: if it is refused or fails to save, no recording
    // is left stranded in "uploading" with nothing able to finish it.
    const recordingId = nanoid();
    const ticket = await createRecordingUploadTicket(ownerEmail, recordingId);
    let created: Awaited<ReturnType<typeof createRecording.run>>;
    try {
      created = await createRecording.run(
        {
          id: recordingId,
          title: args.title,
          visibility: args.visibility,
          mimeType: args.mimeType,
          width: args.width,
          height: args.height,
          hasAudio: true,
          hasCamera: false,
          recordingSource: "agent_upload",
          requestStreaming: true,
        },
        actionContext,
      );
    } catch (error) {
      // create-recording fails its own half-made row, or the lease reaper does;
      // only the ticket, which the agent never received, is ours to release.
      await releaseRecordingUploadTicket(ownerEmail, recordingId).catch(
        (releaseError) => {
          console.warn("[create-recording-upload] ticket release failed", {
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

    const appUrl = `${new URL(getRequestContext()?.requestOrigin || getAppProductionUrl()).origin}${getServerAppBasePath()}`;
    const totalChunks = Math.max(
      1,
      Math.ceil(args.sizeBytes / UPLOAD_SLICE_BYTES),
    );
    const query = new URLSearchParams({
      mimeType: args.mimeType,
      total: String(totalChunks),
      hasAudio: "1",
      hasCamera: "0",
    });
    if (args.durationMs) query.set("durationMs", String(args.durationMs));
    if (args.width) query.set("width", String(args.width));
    if (args.height) query.set("height", String(args.height));

    return {
      recordingId: created.id,
      visibility: args.visibility,
      shareUrl: `${appUrl}/share/${encodeURIComponent(created.id)}`,
      method: "POST" as const,
      chunkUrl: `${appUrl}/api/uploads/${encodeURIComponent(created.id)}/agent-chunk?${query.toString()}`,
      headers: {
        Authorization: `Bearer ${ticket.token}`,
        "Content-Type": args.mimeType,
      },
      chunkSizeBytes: UPLOAD_SLICE_BYTES,
      totalChunks,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      next: `Split the file into ${totalChunks} chunk(s) of chunkSizeBytes (the last may be shorter). POST them one at a time, in order, as the raw request body to chunkUrl + "&index=N&isFinal=0" with the returned headers, N counting from 0. Send the last chunk with "&isFinal=1": that request finalizes the recording, so do not call finalize-recording. Retry a failed chunk with the same index. The upload URL stops working once the last chunk is accepted (a retried last chunk then gets 409 saying so; read the clip with get-recording-player-data rather than uploading again) or at expiresAt. Then give the user shareUrl; transcription, and a title when none was given, follow in the background.`,
    };
  },
});
