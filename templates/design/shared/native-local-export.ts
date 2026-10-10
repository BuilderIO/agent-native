import { z } from "zod";

export const NATIVE_LOCAL_EXPORT_PENDING_MS = 90_000;
export const NATIVE_LOCAL_EXPORT_RUNNING_MS = 15 * 60_000;
export const NATIVE_RENDER_CONTEXT_TTL_MS = 45_000;
export const NATIVE_RENDER_CONTEXT_LIMIT = 8;
export const NATIVE_RENDER_CONTEXT_LEDGER_KEY = "native-render-contexts-v1";

export const nativeRenderContextSchema = z
  .object({
    tabId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
    designId: z.string().min(1).max(128),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();

export const nativeRenderContextLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    contexts: z
      .array(nativeRenderContextSchema)
      .max(NATIVE_RENDER_CONTEXT_LIMIT),
  })
  .strict();

export type NativeRenderContext = z.infer<typeof nativeRenderContextSchema>;

const viewportSchema = z
  .object({
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
  })
  .strict()
  .refine((value) => value.width * value.height <= 8_388_608);

const pixelRatioSchema = z.number().finite().gt(0).max(4);

export const nativeLocalExportCropSchema = z
  .object({
    nodeId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .describe(
        "Exact unique data-agent-native-node-id in the selected live HTML file",
      ),
    x: z
      .number()
      .finite()
      .min(-1_000_000)
      .max(1_000_000)
      .describe("Authored source-space left edge in CSS pixels"),
    y: z
      .number()
      .finite()
      .min(-1_000_000)
      .max(1_000_000)
      .describe("Authored source-space top edge in CSS pixels"),
    width: z
      .number()
      .int()
      .min(1)
      .max(4096)
      .describe(
        "Selected node width in CSS pixels; must equal export viewport width",
      ),
    height: z
      .number()
      .int()
      .min(1)
      .max(4096)
      .describe(
        "Selected node height in CSS pixels; must equal export viewport height",
      ),
  })
  .strict();

export type NativeLocalExportCrop = z.infer<typeof nativeLocalExportCropSchema>;

export function nativeVideoCodedDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  return {
    width: width + (width % 2),
    height: height + (height % 2),
  };
}

function validPhysicalViewport(
  viewport: { width: number; height: number },
  pixelRatio: number,
  requireEven: boolean,
): boolean {
  const sourceWidth = Math.ceil(viewport.width * pixelRatio);
  const sourceHeight = Math.ceil(viewport.height * pixelRatio);
  const { width, height } = requireEven
    ? nativeVideoCodedDimensions(sourceWidth, sourceHeight)
    : { width: sourceWidth, height: sourceHeight };
  return width <= 4096 && height <= 4096 && width * height <= 8_388_608;
}

const matteSchema = z
  .object({
    r: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    b: z.number().int().min(0).max(255),
  })
  .strict();

export const nativeLocalExportOptionsSchema = z.discriminatedUnion("format", [
  z
    .object({
      format: z.enum([
        "png",
        "jpg",
        "webp",
        "avif",
        "svg",
        "pdf",
        "html",
        "zip",
      ]),
      viewport: viewportSchema,
      pixelRatio: pixelRatioSchema,
    })
    .strict()
    .refine((value) =>
      validPhysicalViewport(value.viewport, value.pixelRatio, false),
    ),
  z
    .object({
      format: z.literal("mp4"),
      viewport: viewportSchema,
      settings: z
        .object({
          durationSeconds: z.number().finite().gt(0).max(30),
          startTimeSeconds: z.number().finite().min(0).max(3600),
          fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
          pixelRatio: pixelRatioSchema,
          quality: z.enum(["low", "medium", "high"]),
          matte: matteSchema,
        })
        .strict()
        .refine((settings) => {
          const exactFrames = settings.durationSeconds * settings.fps;
          const frames = Math.round(exactFrames);
          return (
            Math.abs(exactFrames - frames) <= 0.000001 &&
            frames >= 1 &&
            frames <= 600 &&
            settings.startTimeSeconds + (frames - 1) / settings.fps <= 3600
          );
        }),
    })
    .strict()
    .refine((value) =>
      validPhysicalViewport(value.viewport, value.settings.pixelRatio, true),
    ),
]);

export type NativeLocalExportOptions = z.infer<
  typeof nativeLocalExportOptionsSchema
>;

export const nativeLocalExportRequestSchema = z
  .object({
    designId: z.string().min(1).max(128),
    fileId: z.string().min(1).max(128),
    expectedVersionHash: z.string().min(1).max(256),
    export: nativeLocalExportOptionsSchema,
    crop: nativeLocalExportCropSchema
      .optional()
      .describe(
        "Optional exact selected authored node crop for raster, SVG, PDF, MP4, HTML, or ZIP",
      ),
    sourceViewport: viewportSchema
      .optional()
      .describe(
        "Full authored scene viewport in CSS pixels; required for cropped raster/MP4, omitted for other exports",
      ),
  })
  .strict();

export function nativeLocalExportCropMatchesOptions(
  crop: NativeLocalExportCrop | undefined,
  options: NativeLocalExportOptions,
  sourceViewport?: { width: number; height: number },
): boolean {
  if (!crop) return sourceViewport === undefined;
  if (["svg", "pdf", "html", "zip"].includes(options.format))
    return (
      sourceViewport === undefined &&
      options.viewport.width === crop.width &&
      options.viewport.height === crop.height
    );
  const source = viewportSchema.safeParse(sourceViewport);
  if (
    !source.success ||
    !nativeLocalExportCropSchema.safeParse(crop).success ||
    !nativeLocalExportOptionsSchema.safeParse(options).success
  )
    return false;
  const pixelRatio =
    options.format === "mp4" ? options.settings.pixelRatio : options.pixelRatio;
  return (
    options.viewport.width === crop.width &&
    options.viewport.height === crop.height &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.x + crop.width <= source.data.width &&
    crop.y + crop.height <= source.data.height &&
    [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height].every((edge) =>
      Number.isInteger(edge * pixelRatio),
    ) &&
    validPhysicalViewport(source.data, pixelRatio, false)
  );
}

export const nativeLocalExportFailureCodeSchema = z.enum([
  "source-stale",
  "scene-unavailable",
  "render-failed",
  "encode-failed",
  "download-failed",
  "canceled",
  "client-unavailable",
  "navigation-unreadable",
  "editor-left",
]);

export const nativeLocalExportStateSchema = nativeLocalExportRequestSchema
  .extend({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    tabId: z.string().min(1).max(128),
    status: z.enum([
      "pending",
      "running",
      "cancel-requested",
      "canceled",
      "download-initiated",
      "failed",
      "expired",
    ]),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    ownerDocumentId: z.string().uuid().optional(),
    failure: z
      .object({
        code: nativeLocalExportFailureCodeSchema,
        message: z.string().max(300),
      })
      .strict()
      .optional(),
  })
  .strict();

export type NativeLocalExportState = z.infer<
  typeof nativeLocalExportStateSchema
>;

export function nativeLocalExportStateKey(
  designId: string,
  tabId: string,
): string {
  return `native-local-export:${designId}:${tabId}`;
}

export function parseNativeLocalExportState(
  value: unknown,
): NativeLocalExportState | null {
  if (value === null) return null;
  return nativeLocalExportStateSchema.parse(value);
}
