import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import takeDesignScreenshot from "./take-design-screenshot.js";

function suggestedPngFilename(filename: string): string {
  const base = filename
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${base || "screen"}.png`;
}

export default defineAction({
  description:
    "Export one Design screen as a PNG image. Pass fileId, or pass designId " +
    "and filename, to choose the screen. Returns a durable image URL; the " +
    "screen is rendered at 1440px wide by default and full-page height.",
  schema: z.object({
    designId: z
      .string()
      .optional()
      .describe("Design project id. Required unless fileId is provided."),
    fileId: z
      .string()
      .optional()
      .describe(
        "Specific design_files.id to export. Takes priority over designId and filename.",
      ),
    filename: z
      .string()
      .optional()
      .default("index.html")
      .describe(
        "Screen filename when fileId is not provided. Defaults to index.html.",
      ),
    width: z.coerce
      .number()
      .int()
      .min(200)
      .max(3840)
      .optional()
      .describe("Render viewport width in pixels. Defaults to 1440."),
    height: z.coerce
      .number()
      .int()
      .min(200)
      .max(4096)
      .optional()
      .describe(
        "Optional viewport height in pixels. Full-page export is not cropped to this height.",
      ),
  }),
  readOnly: true,
  http: { method: "POST" },
  run: async ({ designId, fileId, filename, width, height }, ctx) => {
    const result = await takeDesignScreenshot.run(
      {
        ...(designId ? { designId } : {}),
        ...(fileId ? { fileId } : {}),
        filename,
        widths: [width ?? 1440],
        ...(height === undefined ? {} : { heights: [height] }),
      },
      ctx,
    );

    if (result.ok !== true) return result;

    const screenshot = result.screenshots?.[0];
    if (!screenshot) {
      fail("The PNG renderer did not return an image.", {
        errorCode: "png_export_empty",
      });
    }
    if (!screenshot.url) {
      fail(
        "The PNG was rendered but could not be returned because file storage is not configured. " +
          "Connect or reconnect Builder.io in Settings → File uploads, or register a custom file provider.",
        {
          errorCode: "file_storage_not_configured",
          details: { designId: result.designId, fileId: result.fileId },
        },
      );
    }

    const screenFilename = result.filename ?? filename ?? "screen.html";

    return {
      ok: true,
      designId: result.designId,
      fileId: result.fileId,
      screenFilename,
      filename: suggestedPngFilename(screenFilename),
      mimeType: "image/png",
      url: screenshot.url,
      bytes: screenshot.bytes,
      viewport: screenshot.viewport,
      diagnostics: screenshot.diagnostics,
      capturedAt: result.capturedAt,
    };
  },
});
