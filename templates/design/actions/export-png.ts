import { defineAction, fail, NoWriteError } from "@agent-native/core/action";
import { MAX_TOOL_RESULT_IMAGE_BASE64_CHARS } from "@agent-native/core/agent/tool-result-images";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  trackDesignExported,
  withDesignExportFailureTracking,
} from "../server/lib/design-export-tracking.js";
import {
  sampleContactValuesSchema,
  type SampleContactValues,
} from "../server/lib/hubspot-email-preview.js";
import { parseCanvasFrameGeometryById } from "../shared/canvas-frames.js";
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

const DEFAULT_WIDTH_PX = 1440;
const MIN_WIDTH_PX = 200;
const MAX_WIDTH_PX = 3840;

function unreadableDesignData(): NoWriteError {
  return new NoWriteError(
    "The design's stored data could not be read, so the screen's authored frame width is unknown. " +
      "Pass width to export at an explicit width.",
    { errorCode: "design_data_unreadable", statusCode: 422 },
  );
}

function frameWidthPx(row: { fileId: string; data: string }) {
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch {
    throw unreadableDesignData();
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw unreadableDesignData();
  }
  const width = parseCanvasFrameGeometryById(
    (data as Record<string, unknown>).canvasFrames,
  )[row.fileId]?.width;
  return width !== undefined && width > 0
    ? Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, Math.round(width)))
    : undefined;
}

// A screen the caller cannot read is also undefined here: the screenshot does
// its own access-filtered lookup and reports it as not found.
async function authoredFrameWidthPx({
  designId,
  fileId,
  filename,
}: {
  designId: string | undefined;
  fileId: string | undefined;
  filename: string;
}): Promise<number | undefined> {
  const rows = await getDb()
    .select({ fileId: schema.designFiles.id, data: schema.designs.data })
    .from(schema.designFiles)
    .innerJoin(
      schema.designs,
      eq(schema.designFiles.designId, schema.designs.id),
    )
    .where(
      and(
        accessFilter(schema.designs, schema.designShares, undefined, "viewer", {
          includePublic: true,
        }),
        fileId
          ? eq(schema.designFiles.id, fileId)
          : and(
              eq(schema.designFiles.designId, designId ?? ""),
              eq(schema.designFiles.filename, filename),
            ),
      ),
    )
    .limit(1);
  return rows.map(frameWidthPx)[0];
}

const trackPngExportFailures = withDesignExportFailureTracking<{
  designId?: string;
  fileId?: string;
  filename: string;
  width?: number;
  height?: number;
  templatePreview?: "hubspot-email";
  sampleContactValues?: SampleContactValues;
}>("png");

export default defineAction({
  description:
    "Export one Design screen as a PNG image. Pass fileId, or pass designId " +
    "and filename, to choose the screen. Returns a durable image URL; MCP " +
    "callers also receive an inline PNG preview when it fits the image limit. " +
    "Screens with enabled native WebGPU effects require the foreground " +
    "request-native-local-export action in an open editor tab; this " +
    "headless action fails typed for those screens rather than returning " +
    "pixels without the effect. Other screens render at the screen's " +
    "authored frame width by default (1440px when it has none), 2x pixel " +
    "density and full-page height. Optional templatePreview=hubspot-email uses fake sample template values for browser-layout proof, not HubSpot compilation or inbox rendering; source and HTML export remain unchanged.",
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
      templatePreview: z
        .literal("hubspot-email")
        .optional()
        .describe(
          "Optional hubspot-email sample preview using supported template tokens/contact defaults. Omit to render raw HTML unchanged.",
        ),
      sampleContactValues: sampleContactValuesSchema
        .optional()
        .describe(
          "Optional in-memory recipient samples, only with templatePreview=hubspot-email: an array of at most 8 unique {field, value} entries, with contact.field names and 500 characters per value. Fields must match supported personalization_token calls; unknown or unused fields fail. Omit fields to use literal defaults; saved HTML is unchanged.",
        ),
      width: z.coerce
        .number()
        .int()
        .min(MIN_WIDTH_PX)
        .max(MAX_WIDTH_PX)
        .optional()
        .describe(
          "Render viewport width in pixels. Defaults to the screen's authored frame width, else 1440. An explicit width always wins.",
        ),
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
    })
    .refine(
      ({ templatePreview, sampleContactValues }) =>
        sampleContactValues === undefined ||
        templatePreview === "hubspot-email",
      {
        message:
          'sampleContactValues requires templatePreview="hubspot-email".',
        path: ["sampleContactValues"],
      },
    ),
  readOnly: false,
  http: { method: "POST" },
  run: trackPngExportFailures(async (args, ctx, facts) => {
    const {
      designId,
      fileId,
      filename,
      width,
      height,
      templatePreview,
      sampleContactValues,
    } = args;
    const widthPx =
      width ??
      (await authoredFrameWidthPx({ designId, fileId, filename })) ??
      DEFAULT_WIDTH_PX;
    const result = await takeDesignScreenshot.run(
      {
        ...(designId ? { designId } : {}),
        ...(fileId ? { fileId } : {}),
        filename,
        widths: [widthPx],
        ...(templatePreview ? { templatePreview } : {}),
        ...(sampleContactValues === undefined ? {} : { sampleContactValues }),
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
      throw new NoWriteError("The PNG renderer did not return an image.", {
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
      throw new NoWriteError(
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
      captureTimings: result.captureTimings,
      ...(result.preview ? { preview: result.preview } : {}),
    };
  }),
});
