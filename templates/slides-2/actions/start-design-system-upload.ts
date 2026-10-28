import { defineAction, fail } from "@agent-native/core/action";
import {
  FeatureNotConfiguredError,
  startBuilderDesignSystemUpload,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { assertDesignSystemWorkflowsEnabled } from "../server/lib/design-system-workflows.js";

const MAX_FIG_BYTES = 512 * 1024 * 1024;

const attachmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Attachment name is required.")
    .describe("File name"),
  mimetype: z
    .preprocess(
      (value) =>
        typeof value === "string" && value.trim()
          ? value.trim()
          : "application/octet-stream",
      z.string(),
    )
    .describe("File MIME type; defaults to application/octet-stream"),
  declaredSize: z
    .preprocess((value) => Number(value), z.number().int().positive())
    .refine(Number.isSafeInteger, "declaredSize must be a safe integer")
    .describe("File size in bytes"),
});

export default defineAction({
  title: "Start design system file upload",
  description:
    "Create Builder upload slots for design-system files. Pass each file's name, MIME type, and byte size; then upload the binary file to its returned storage URL and pass its uploadToken to index-uploaded-design-system-files.",
  schema: z.object({
    attachments: z
      .array(attachmentSchema)
      .min(1, "No attachments provided.")
      .describe("Design-system files to upload"),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  run: async ({ attachments }) => {
    if (!getRequestUserEmail()) {
      fail("Unauthorized", { errorCode: "unauthorized", statusCode: 401 });
    }
    const oversizedAttachment = attachments.find(
      (attachment) => attachment.declaredSize > MAX_FIG_BYTES,
    );
    if (oversizedAttachment) {
      fail(
        `File too large (max ${Math.round(MAX_FIG_BYTES / 1024 / 1024)} MB).`,
        { errorCode: "file_too_large", statusCode: 413 },
      );
    }

    await assertDesignSystemWorkflowsEnabled();
    try {
      const uploads = await startBuilderDesignSystemUpload(attachments);
      return { uploads };
    } catch (error) {
      if (error instanceof FeatureNotConfiguredError) {
        fail(error.message, {
          errorCode: "builder_not_configured",
          statusCode: 412,
          ...(error.builderConnectUrl
            ? { details: { builderConnectUrl: error.builderConnectUrl } }
            : {}),
        });
      }
      throw error;
    }
  },
});
