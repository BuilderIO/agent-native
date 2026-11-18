import { defineAction, fail } from "@agent-native/core/action";
import { ATTACHMENT_REF_MAX_CHARS } from "@agent-native/core/private-blob";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import { openFigmaReference } from "../server/lib/figma-reference-attachment.js";
import {
  normalizeImportedHtmlDocument,
  resolveImportDesignId,
  saveImportedDesignFiles,
} from "../server/lib/import-design-files.js";
import { MAX_FIGMA_REFERENCE_FRAMES } from "../shared/figma-reference.js";
import { designOutputWriteReceipt } from "../shared/generation-output-receipt.js";

export default defineAction({
  description:
    "Place frames from a Figma design the user attached in the composer onto a design as new screens, exactly as decoded (layout, text, styles, vectors). Pass the attachment ref from the Figma reference context. Use this whenever the request is to make, recreate, or import the attached design; never retype its HTML with generate-design, create-file, or import-design-source.",
  schema: z.object({
    ref: z
      .string()
      .min(1)
      .max(ATTACHMENT_REF_MAX_CHARS)
      .describe("The attachment ref given in the Figma reference context."),
    designId: z
      .string()
      .optional()
      .describe("Design to add the screens to. Defaults to the open design."),
    frames: z
      .array(z.number().int().positive())
      .min(1)
      .max(MAX_FIGMA_REFERENCE_FRAMES)
      .optional()
      .describe(
        "1-based frame numbers from the reference context. Omit to place every frame.",
      ),
  }),
  outputSchema: z.object({
    designId: z.string(),
    files: z.array(z.object({ id: z.string(), filename: z.string() })),
    warnings: z.array(z.string()),
    urlPath: z.string().optional(),
    _receipt: z
      .object({
        changed: z.boolean(),
        verified: z.literal(true),
        summary: z.string(),
        subject: z.string(),
      })
      .optional(),
    placedFrames: z.number().int().positive(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    // Adds new screens; existing screens are never overwritten.
    destructiveHint: false,
    openWorldHint: false,
  },
  http: { method: "POST" },
  run: async ({ ref, designId, frames }, context) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to place a Figma design.", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    const reference = await openFigmaReference(ref, ownerEmail);
    const picked = frames
      ? frames.map((number) => {
          const frame = reference.frames.find(
            (_, index) => index === number - 1,
          );
          if (!frame) {
            fail(
              `Frame ${number} is not in this attachment; it has ${reference.frames.length}.`,
              { errorCode: "figma_reference_frame_not_found" },
            );
          }
          return frame;
        })
      : reference.frames;
    const resolvedDesignId = await resolveImportDesignId(designId);
    await snapshotDesignBeforeAgentEdit(resolvedDesignId, context);
    const saved = await saveImportedDesignFiles({
      designId: resolvedDesignId,
      sourceType: "figma-reference",
      files: picked.map((frame, index) => {
        const title = frame.name?.trim() || `Figma frame ${index + 1}`;
        return {
          // A .fig frame is named "Page / Frame"; filenames cannot hold slashes.
          filename: `${title.replace(/[\\/]+/g, "-").replace(/\.{2,}/g, ".")}.html`,
          fileType: "html" as const,
          // Clipboard fallbacks and browser-decoded .fig files reach here
          // unsanitized; every saved frame goes through the import sanitizer.
          content: normalizeImportedHtmlDocument(frame.html, "Figma"),
          preferredFrame: {
            title,
            ...(frame.width !== undefined ? { width: frame.width } : {}),
            ...(frame.height !== undefined ? { height: frame.height } : {}),
          },
        };
      }),
    });
    // Only what the agent needs next; per-file metadata only adds tokens.
    return {
      designId: saved.designId,
      files: saved.files.map(({ id, filename }) => ({ id, filename })),
      warnings: saved.warnings,
      urlPath: saved.urlPath,
      ...(saved.files.length
        ? {
            _receipt: designOutputWriteReceipt(
              resolvedDesignId,
              saved.files.length,
            ),
          }
        : {}),
      placedFrames: picked.length,
    };
  },
});
