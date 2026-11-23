import { defineAction, fail } from "@agent-native/core/action";
import { uploadFile } from "@agent-native/core/file-upload";
import { z } from "zod";

/** 8 MB keeps an inline action payload sane; a larger file is refused, not truncated. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/**
 * Stores one file the task prompt carries.
 *
 * The source's task composer attaches files to the prompt (its `+` control), and
 * the run then sees them. This uses the framework's own upload registry rather
 * than a store of our own, and hands back the stored id and URL so the task can
 * name the file it carries. A workspace with no file storage configured gets a
 * clear refusal instead of a silent no-op, and the composer does not offer `+`
 * in that case.
 */
export default defineAction({
  description:
    "Attach a file to a scheduled task's prompt. Stores the file with the workspace's file storage and returns its id and URL.",
  agentTool: false,
  schema: z.object({
    filename: z.string().trim().min(1).max(200),
    mimeType: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .default("application/octet-stream"),
    /** Base64 of the file's bytes. */
    dataBase64: z.string().min(1),
  }),
  run: async (input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const bytes = Buffer.from(input.dataBase64, "base64");
    if (bytes.byteLength === 0) {
      fail("That file is empty.", {
        statusCode: 400,
        errorCode: "attachment_empty",
      });
    }
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      fail("That file is larger than 8 MB.", {
        statusCode: 413,
        errorCode: "attachment_too_large",
      });
    }
    let stored: Awaited<ReturnType<typeof uploadFile>>;
    try {
      stored = await uploadFile({
        data: bytes,
        filename: input.filename,
        mimeType: input.mimeType,
        ownerEmail: userEmail,
        recordAsset: true,
        stableUrl: true,
      });
    } catch (error) {
      fail(
        `The file could not be stored: ${
          error instanceof Error ? error.message : "file storage is unavailable"
        }`,
        { statusCode: 503, errorCode: "attachment_storage_unavailable" },
      );
    }
    if (!stored) {
      fail(
        "This workspace has no file storage configured, so a file cannot be attached.",
        {
          statusCode: 503,
          errorCode: "attachment_storage_unconfigured",
        },
      );
    }
    return {
      id: stored.id ?? stored.url,
      url: stored.url,
      label: input.filename,
      mimeType: input.mimeType,
      bytes: bytes.byteLength,
    };
  },
});
