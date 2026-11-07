import { gunzipSync } from "node:zlib";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { mintFigmaReference } from "../server/lib/figma-reference-attachment.js";
import {
  MAX_FIGMA_REFERENCE_FRAMES,
  figmaReferencePayloadSchema,
} from "../shared/figma-reference.js";

// Hosted functions reject request bodies over about 6 MB.
const MAX_COMPRESSED_CHARS = 5_500_000;
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;
const UNREADABLE =
  "The attached Figma frames could not be read. Attach the file again.";

export default defineAction({
  description:
    "Store frames decoded from a .fig in the browser as an attachment ref, so the agent can place them exactly with place-figma-frames. UI-only: the composer calls it when a .fig is attached, with the frames gzipped and base64-encoded.",
  schema: z.object({ payloadGzipBase64: z.string().min(1) }),
  outputSchema: z.object({ ref: z.string() }),
  http: { method: "POST" },
  agentTool: false,
  toolCallable: false,
  run: async ({ payloadGzipBase64 }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to attach a Figma design.", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    if (payloadGzipBase64.length > MAX_COMPRESSED_CHARS) {
      fail(
        "This Figma file is too large to attach in one go. Copy the frames you need in Figma and paste them into the prompt instead.",
        { errorCode: "figma_reference_too_large", statusCode: 413 },
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(
        gunzipSync(Buffer.from(payloadGzipBase64, "base64"), {
          maxOutputLength: MAX_DECOMPRESSED_BYTES,
        }).toString("utf8"),
      );
    } catch (error) {
      fail(UNREADABLE, {
        errorCode: "figma_reference_unreadable",
        details: {
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
    if (
      isRecord(raw) &&
      Array.isArray(raw.frames) &&
      raw.frames.length > MAX_FIGMA_REFERENCE_FRAMES
    ) {
      fail(
        `This Figma file has ${raw.frames.length} frames, more than the ${MAX_FIGMA_REFERENCE_FRAMES} one attachment holds. Copy the frames you need in Figma and paste them into the prompt instead.`,
        { errorCode: "figma_reference_too_large", statusCode: 413 },
      );
    }
    const payload = figmaReferencePayloadSchema.safeParse(raw);
    if (!payload.success) {
      fail(UNREADABLE, {
        errorCode: "figma_reference_unreadable",
        details: { issues: payload.error.issues.slice(0, 5) },
      });
    }
    return { ref: await mintFigmaReference(payload.data, ownerEmail) };
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
