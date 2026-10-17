import { defineAction, fail } from "@agent-native/core/action";
import { MAX_TOOL_RESULT_IMAGE_BASE64_CHARS } from "@agent-native/core/agent/tool-result-images";
import { z } from "zod";

import {
  trackDesignExported,
  withDesignExportFailureTracking,
} from "../server/lib/design-export-tracking.js";
import takeDesignScreenshot, {
  getScreenshotPngData,
} from "./take-design-screenshot.js";

function suggestedPngFilename(filename: string): string {
  const base = filename
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${base || "screen"}.png`;
}

const trackPngExportFailures = withDesignExportFailureTracking<{
  designId?: string;
  fileId?: string;
  filename: string;
  width?: number;
  height?: number;
}>("png");

export default defineAction({
  description:
    "Export one Design screen as a PNG image. Pass fileId, or pass designId " +
    "and filename, to choose the screen. Returns a durable image URL; MCP " +
    "callers also receive an inline PNG preview when it fits the image limit. " +
    "The screen is rendered " +
    "at 1440px wide by default and full-page height.",
  schema: z
    .object({
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
    })
    .refine(({ designId, fileId }) => Boolean(designId || fileId), {
      message: "Provide designId or fileId to select a screen.",
      path: ["designId"],
    }),
  readOnly: false,
  http: { method: "POST" },
  run: trackPngExportFailures(async (args, ctx, facts) => {
    const { designId, fileId, filename, width, height } = args;
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

    if (result.ok !== true) {
      // The screenshot only reports an unavailable renderer after it found the
      // file through the caller's access filter. That lookup goes by fileId
      // when one is given, so a design id is verified only without one.
      trackDesignExported(
        {
          ...(designId && !fileId ? { designId } : {}),
          exportFormat: "png",
          status: "failed",
          errorType: "chromium_unavailable",
        },
        ctx,
      );
      return result;
    }
    facts.designId = result.designId;
    facts.fileId = result.fileId;

    const screenshot = result.screenshots?.[0];
    if (!screenshot) {
      fail("The PNG renderer did not return an image.", {
        errorCode: "png_export_empty",
      });
    }
    if (!screenshot.url) {
      if (screenshot.uploadError?.code === "file_upload_failed") {
        fail(
          "The PNG was rendered but its upload failed. Check the configured file storage provider and retry.",
          {
            errorCode: "file_upload_failed",
            details: { designId: result.designId, fileId: result.fileId },
          },
        );
      }
      fail(
        "The PNG was rendered but could not be returned because file storage is not configured. " +
          "Use Builder.io in Settings → File uploads, or register a custom file provider.",
        {
          errorCode: "file_storage_not_configured",
          details: { designId: result.designId, fileId: result.fileId },
        },
      );
    }

    const screenFilename = result.filename ?? filename ?? "screen.html";
    const png =
      ctx?.caller === "mcp" ? getScreenshotPngData(screenshot) : undefined;
    const maxInlinePngBytes =
      Math.floor(MAX_TOOL_RESULT_IMAGE_BASE64_CHARS / 4) * 3;
    const imageData =
      png && Buffer.byteLength(png) <= maxInlinePngBytes
        ? png.toString("base64")
        : undefined;
    const agentImages = imageData
      ? [
          {
            data: imageData,
            mediaType: "image/png" as const,
            label: `${screenFilename} (${screenshot.viewport.label})`,
          },
        ]
      : undefined;
    const message =
      ctx?.caller === "mcp" && png && !imageData
        ? "The PNG exceeds the inline image limit; use its durable URL to view it."
        : undefined;

    trackDesignExported(
      { ...facts, exportFormat: "png", status: "completed" },
      ctx,
    );

    return {
      ok: true,
      designId: result.designId,
      fileId: result.fileId,
      screenFilename,
      filename: suggestedPngFilename(screenFilename),
      mimeType: "image/png",
      url: screenshot.url,
      bytes: screenshot.bytes,
      ...(agentImages ? { _agentImages: agentImages } : {}),
      ...(message ? { message } : {}),
      viewport: screenshot.viewport,
      diagnostics: screenshot.diagnostics,
      capturedAt: result.capturedAt,
    };
  }),
});
