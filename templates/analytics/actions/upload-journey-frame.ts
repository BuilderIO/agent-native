import { defineAction, fail } from "@agent-native/core/action";
import { mintAttachmentRef } from "@agent-native/core/private-blob";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getSessionReplaySummary } from "../server/lib/session-replay.js";
import { pngDimensions } from "../shared/png.js";

const MAX_PNG_BYTES = 3_500_000;

export default defineAction({
  description:
    "Store one onboarding journey frame (a PNG screenshot of a session replay) in the caller's private storage and return an opaque attachmentRef. Used by the journey:capture CLI with --upload; frames are never public and only the caller can open the ref. The caller must be able to open the recording.",
  schema: z.object({
    recordingId: z
      .string()
      .min(1)
      .max(128)
      .describe("The recording the frame shows"),
    offsetMs: z.coerce
      .number()
      .int()
      .min(0)
      .describe("Where in the recording the frame was captured"),
    png: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_PNG_BYTES * 4) / 3) + 8)
      .describe(`Base64 PNG, at most ${MAX_PNG_BYTES} bytes decoded`),
  }),
  agentTool: false,
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("Sign in to use this action.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || null;
    const recording = await getSessionReplaySummary(args.recordingId, {
      userEmail,
      orgId,
    });
    const data = Buffer.from(args.png, "base64");
    if (data.byteLength === 0 || data.byteLength > MAX_PNG_BYTES) {
      fail(`The frame must be a PNG of at most ${MAX_PNG_BYTES} bytes.`, {
        errorCode: "journey_frame_invalid",
        statusCode: 413,
      });
    }
    const dimensions = pngDimensions(data);
    if (!dimensions) {
      fail("The frame is not a PNG of a plausible screenshot size.", {
        errorCode: "journey_frame_invalid",
      });
    }
    const minted = await mintAttachmentRef({
      data,
      filename: `${recording.id}-${String(args.offsetMs).padStart(8, "0")}.png`,
      mimeType: "image/png",
      ownerEmail: userEmail,
      orgId: null,
      metadata: {
        appId: "analytics",
        resourceType: "journey-frame",
        resourceId: recording.id,
        replayId: recording.id,
        offsetMs: args.offsetMs,
      },
    });
    if (minted.status !== "ok") {
      fail(
        "Private frame storage is not available for Analytics, so the frame was not stored.",
        { errorCode: "private_storage_unavailable", statusCode: 503 },
      );
    }
    return {
      attachmentRef: minted.ref,
      width: dimensions.width,
      height: dimensions.height,
      bytes: data.byteLength,
    };
  },
});
