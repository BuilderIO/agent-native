import { z } from "zod";

import { RECORDING_TITLE_SOURCES } from "./title-source.js";

const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export const createRecordingSchema = z.object({
  id: z
    .string()
    .optional()
    .describe("Pre-generated recording ID (for optimistic UI)"),
  title: z
    .string()
    .optional()
    .describe("Recording title (defaults to 'Untitled recording')"),
  titleSource: z
    .enum(RECORDING_TITLE_SOURCES)
    .optional()
    .describe("How the initial title was chosen"),
  sourceAppName: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .describe("Captured application name, when known"),
  sourceWindowTitle: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .describe("Captured window or browser tab title, when known"),
  folderId: z.string().nullish().describe("Optional folder ID"),
  spaceIds: z
    .array(z.string().min(1))
    .nullish()
    .describe(
      "Space IDs the recording should belong to (used when recording from a space)",
    ),
  organizationId: z
    .string()
    .optional()
    .describe(
      "Organization the recording belongs to (defaults to the caller's active org)",
    ),
  hasCamera: z
    .union([z.boolean(), cliBoolean])
    .optional()
    .describe("Whether the recording includes a camera track"),
  hasAudio: z
    .union([z.boolean(), cliBoolean])
    .optional()
    .describe("Whether the recording includes an audio track"),
  width: z.coerce
    .number()
    .optional()
    .describe("Width of the recording in pixels (may be 0 until finalized)"),
  height: z.coerce
    .number()
    .optional()
    .describe("Height of the recording in pixels (may be 0 until finalized)"),
  visibility: z
    .enum(["private", "org", "public"])
    .optional()
    .describe("Initial share visibility for the recording"),
  mimeType: z
    .string()
    .optional()
    .describe(
      "MIME type the browser will record (e.g. video/webm, video/mp4). Used to initialize the resumable session with the correct content type.",
    ),
  requestStreaming: z
    .boolean()
    .optional()
    .describe(
      "Request the resumable streaming upload path. Deployments must also set CLIPS_ENABLE_STREAMING_UPLOAD; otherwise recordings use the buffered fallback.",
    ),
  streamingUploadClient: z
    .enum(["desktop-native"])
    .optional()
    .describe(
      "Optional client implementation marker for diagnostics and compatibility decisions.",
    ),
});
